import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { win32 } from 'node:path';
import type { Readable } from 'node:stream';
import {
  BoundedLogBufferV1,
  FfmpegProgressParserV1,
  type FfmpegProgressSnapshotV1,
} from '@app/render';

export type RenderProcessTerminationReasonV1 =
  | 'CANCELLED'
  | 'OVERALL_TIMEOUT'
  | 'NO_PROGRESS_TIMEOUT'
  | 'PROGRESS_PROTOCOL_INVALID'
  | null;

export interface RenderProcessRequestV1 {
  execution_attempt_id: string;
  kind: 'FFMPEG' | 'FFPROBE';
  executable: string;
  arguments: readonly string[];
  shell: false;
  timeout_ms: number;
  no_progress_timeout_ms: number | null;
  graceful_cancel_timeout_ms: number;
  forced_cancel_timeout_ms: number;
  max_log_bytes: number;
  on_progress?: (progress: FfmpegProgressSnapshotV1) => void;
}

export interface RenderProcessResultV1 {
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  logs_truncated: boolean;
  progress_end_observed: boolean;
  termination_reason: RenderProcessTerminationReasonV1;
}

export interface RenderProcessAdapterV1 {
  run(request: RenderProcessRequestV1): Promise<RenderProcessResultV1>;
  cancel(executionAttemptId: string): Promise<boolean>;
}

export interface RenderProcessLifecycleEventV1 {
  execution_attempt_id: string;
  kind: 'FFMPEG' | 'FFPROBE';
  event:
    | 'PROCESS_STARTED'
    | 'WINDOWS_TREE_GRACEFUL_REQUESTED'
    | 'WINDOWS_TREE_FORCED_REQUESTED'
    | 'PROCESS_CLOSED';
  pid: number | null;
  observed_at: string;
}

interface ActiveProcess {
  child: ChildProcessByStdio<null, Readable, Readable>;
  request: RenderProcessRequestV1;
  terminationReason: RenderProcessTerminationReasonV1;
  forcedTimer: NodeJS.Timeout | null;
  finalTimer: NodeJS.Timeout | null;
}

export function windowsTaskkillInvocationV1(input: {
  pid: number;
  forced: boolean;
  systemRoot: string;
}): { executable: string; arguments: string[]; shell: false } {
  if (!Number.isSafeInteger(input.pid) || input.pid < 1) throw new Error('PROCESS_PID_INVALID');
  if (!/^[A-Za-z]:[\\/]/u.test(input.systemRoot)) throw new Error('WINDOWS_SYSTEM_ROOT_INVALID');
  return {
    executable: win32.join(input.systemRoot, 'System32', 'taskkill.exe'),
    arguments: ['/PID', String(input.pid), '/T', ...(input.forced ? ['/F'] : [])],
    shell: false,
  };
}

export class NodeRenderProcessAdapterV1 implements RenderProcessAdapterV1 {
  readonly #active = new Map<string, ActiveProcess>();
  readonly #platform: NodeJS.Platform;
  readonly #systemRoot: string;
  readonly #onLifecycle: ((event: RenderProcessLifecycleEventV1) => void) | null;

  constructor(
    options: {
      platform?: NodeJS.Platform;
      windowsSystemRoot?: string;
      onLifecycle?: (event: RenderProcessLifecycleEventV1) => void;
    } = {},
  ) {
    this.#platform = options.platform ?? process.platform;
    this.#systemRoot = options.windowsSystemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
    this.#onLifecycle = options.onLifecycle ?? null;
  }

  async run(request: RenderProcessRequestV1): Promise<RenderProcessResultV1> {
    if (request.shell !== false) throw new Error('RENDER_PROCESS_SHELL_FORBIDDEN');
    if (!request.executable.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(request.executable)) {
      throw new Error('RENDER_PROCESS_PATH_LOOKUP_FORBIDDEN');
    }
    if (this.#active.has(request.execution_attempt_id)) {
      throw new Error('RENDER_PROCESS_ATTEMPT_ALREADY_ACTIVE');
    }
    const stdout = new BoundedLogBufferV1(request.max_log_bytes);
    const stderr = new BoundedLogBufferV1(request.max_log_bytes);
    const progress = request.kind === 'FFMPEG' ? new FfmpegProgressParserV1() : null;
    const child = spawn(request.executable, [...request.arguments], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const active: ActiveProcess = {
      child,
      request,
      terminationReason: null,
      forcedTimer: null,
      finalTimer: null,
    };
    this.#active.set(request.execution_attempt_id, active);
    this.#emit(active, 'PROCESS_STARTED');

    return new Promise<RenderProcessResultV1>((resolve, reject) => {
      let settled = false;
      let protocolError: unknown = null;
      let noProgressTimer: NodeJS.Timeout | null = null;
      const overallTimer = setTimeout(() => {
        void this.#requestTermination(active, 'OVERALL_TIMEOUT');
      }, request.timeout_ms);
      const armNoProgress = (): void => {
        if (request.no_progress_timeout_ms === null) return;
        if (noProgressTimer) clearTimeout(noProgressTimer);
        noProgressTimer = setTimeout(() => {
          void this.#requestTermination(active, 'NO_PROGRESS_TIMEOUT');
        }, request.no_progress_timeout_ms);
      };
      if (progress) armNoProgress();
      const cleanup = (): void => {
        clearTimeout(overallTimer);
        if (noProgressTimer) clearTimeout(noProgressTimer);
        if (active.forcedTimer) clearTimeout(active.forcedTimer);
        if (active.finalTimer) clearTimeout(active.finalTimer);
        this.#active.delete(request.execution_attempt_id);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        stdout.append(chunk);
        if (!progress) return;
        try {
          for (const snapshot of progress.push(chunk.toString('utf8'))) {
            armNoProgress();
            request.on_progress?.(snapshot);
          }
        } catch (error) {
          protocolError = error;
          void this.#requestTermination(active, 'PROGRESS_PROTOCOL_INVALID');
        }
      });
      child.stderr.on('data', (chunk: Buffer) => stderr.append(chunk));
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (protocolError) {
          reject(new Error('FFMPEG_PROGRESS_PROTOCOL_INVALID', { cause: protocolError }));
          return;
        }
        reject(new Error('RENDER_PROCESS_SPAWN_FAILED', { cause: error }));
      });
      child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        this.#emit(active, 'PROCESS_CLOSED');
        cleanup();
        let progressEnd = false;
        if (progress) {
          try {
            progress.finish();
            progressEnd = progress.ended;
          } catch {
            progressEnd = false;
          }
        }
        resolve({
          exit_code: exitCode,
          signal,
          stdout: stdout.text,
          stderr: stderr.text,
          logs_truncated: stdout.truncated || stderr.truncated,
          progress_end_observed: progressEnd,
          termination_reason: active.terminationReason,
        });
      });
    });
  }

  async cancel(executionAttemptId: string): Promise<boolean> {
    const active = this.#active.get(executionAttemptId);
    if (!active) return false;
    await this.#requestTermination(active, 'CANCELLED');
    return true;
  }

  async #requestTermination(
    active: ActiveProcess,
    reason: Exclude<RenderProcessTerminationReasonV1, null>,
  ): Promise<void> {
    if (active.terminationReason !== null || active.child.exitCode !== null) return;
    active.terminationReason = reason;
    void this.#terminate(active, false);
    active.forcedTimer = setTimeout(() => {
      void this.#terminate(active, true);
    }, active.request.graceful_cancel_timeout_ms);
    active.finalTimer = setTimeout(() => {
      if (active.child.exitCode === null) active.child.kill();
    }, active.request.graceful_cancel_timeout_ms + active.request.forced_cancel_timeout_ms);
  }

  async #terminate(active: ActiveProcess, forced: boolean): Promise<void> {
    const pid = active.child.pid;
    if (!pid || active.child.exitCode !== null) return;
    if (this.#platform === 'win32') {
      this.#emit(
        active,
        forced ? 'WINDOWS_TREE_FORCED_REQUESTED' : 'WINDOWS_TREE_GRACEFUL_REQUESTED',
      );
      const invocation = windowsTaskkillInvocationV1({
        pid,
        forced,
        systemRoot: this.#systemRoot,
      });
      await new Promise<void>((resolve) => {
        const terminator = spawn(invocation.executable, invocation.arguments, {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        terminator.once('error', () => resolve());
        terminator.once('close', () => resolve());
      });
      return;
    }
    active.child.kill(forced ? 'SIGKILL' : 'SIGTERM');
  }

  #emit(active: ActiveProcess, event: RenderProcessLifecycleEventV1['event']): void {
    try {
      this.#onLifecycle?.({
        execution_attempt_id: active.request.execution_attempt_id,
        kind: active.request.kind,
        event,
        pid: active.child.pid ?? null,
        observed_at: new Date().toISOString(),
      });
    } catch {
      // Observability cannot alter process ownership or termination semantics.
    }
  }
}
