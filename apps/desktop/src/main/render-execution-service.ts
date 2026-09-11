import { randomUUID } from 'node:crypto';
import type {
  RenderExecutionRepository,
  RenderPreparationRepository,
  RenderPolicyRepository,
  RenderExecutionAttemptRecordV1,
} from '@app/local-db';
import {
  buildFfmpegInvocationV1,
  buildFfprobeInvocationV1,
  buildRenderReceiptV1,
  parseLogicalRenderPlanV1,
  parseRenderExecutionSnapshotV1,
  verifyFfprobeOutputV1,
  type RenderOutputArtifactV1,
  type RenderReceiptV1,
} from '@app/render';
import type { RenderExecutionFilePortV1 } from './render-execution-file-service.js';
import type { RenderProcessAdapterV1, RenderProcessResultV1 } from './render-process-adapter.js';

export interface ExecutedRenderResultV1 {
  recovered_existing_success: boolean;
  execution_attempt_id: string;
  output_path: string;
  output_sha256: string;
  receipt: RenderReceiptV1;
}

class RenderExecutionFailure extends Error {
  readonly terminalState: 'FAILED' | 'CANCELLED';

  constructor(code: string, terminalState: 'FAILED' | 'CANCELLED' = 'FAILED') {
    super(code);
    this.terminalState = terminalState;
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,255}$/u.test(error.message)) {
    return error.message;
  }
  return 'RENDER_EXECUTION_FAILED';
}

function processFailure(result: RenderProcessResultV1, kind: 'FFMPEG' | 'FFPROBE'): void {
  const prefix = kind === 'FFMPEG' ? 'FFMPEG' : 'FFPROBE';
  if (result.termination_reason === 'CANCELLED') {
    throw new RenderExecutionFailure(`${prefix}_CANCELLED`, 'CANCELLED');
  }
  if (result.termination_reason === 'OVERALL_TIMEOUT') {
    throw new RenderExecutionFailure(`${prefix}_OVERALL_TIMEOUT`);
  }
  if (result.termination_reason === 'NO_PROGRESS_TIMEOUT') {
    throw new RenderExecutionFailure(`${prefix}_NO_PROGRESS_TIMEOUT`);
  }
  if (result.exit_code !== 0) throw new RenderExecutionFailure(`${prefix}_NONZERO_EXIT`);
}

export class RenderExecutionServiceV1 {
  readonly #preparations: RenderPreparationRepository;
  readonly #policies: RenderPolicyRepository;
  readonly #executions: RenderExecutionRepository;
  readonly #files: RenderExecutionFilePortV1;
  readonly #processes: RenderProcessAdapterV1;
  readonly #clock: () => string;
  readonly #id: () => string;

  constructor(options: {
    preparations: RenderPreparationRepository;
    policies: RenderPolicyRepository;
    executions: RenderExecutionRepository;
    files: RenderExecutionFilePortV1;
    processes: RenderProcessAdapterV1;
    clock?: () => string;
    id?: () => string;
  }) {
    this.#preparations = options.preparations;
    this.#policies = options.policies;
    this.#executions = options.executions;
    this.#files = options.files;
    this.#processes = options.processes;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#id = options.id ?? (() => randomUUID());
  }

  async executePreparedRender(jobId: string): Promise<ExecutedRenderResultV1> {
    const prepared = this.#preparations.require(jobId);
    if (
      prepared.state !== 'READY_FOR_EXECUTION' ||
      !prepared.logical_plan ||
      !prepared.current_execution_snapshot_hash
    ) {
      throw new Error('RENDER_EXECUTION_NOT_READY');
    }
    const plan = parseLogicalRenderPlanV1(prepared.logical_plan);
    const snapshotValue = this.#preparations.getReadySnapshot(jobId);
    if (!snapshotValue) throw new Error('RENDER_READY_SNAPSHOT_MISSING');
    const snapshot = parseRenderExecutionSnapshotV1(snapshotValue);
    if (
      snapshot.execution_snapshot_hash !== prepared.current_execution_snapshot_hash ||
      snapshot.logical_render_hash !== plan.logical_render_hash
    ) {
      throw new Error('RENDER_EXECUTION_SNAPSHOT_BINDING_MISMATCH');
    }
    const policy = this.#policies.require(plan.render_policy_id, plan.render_policy_version);
    if (policy.policy_hash !== plan.render_policy_hash) {
      throw new Error('RENDER_EXECUTION_POLICY_BINDING_MISMATCH');
    }

    const existing = this.#executions.findSucceeded(jobId);
    if (existing) {
      const output = existing.receipt.output_artifact;
      if (!output) throw new Error('RENDER_EXECUTION_SUCCESS_RECEIPT_INVALID');
      await this.#files.verifyExistingOutput(
        existing.attempt.final_output_path,
        output.output_sha256,
        output.size_bytes,
      );
      return {
        recovered_existing_success: true,
        execution_attempt_id: existing.attempt.execution_attempt_id,
        output_path: existing.attempt.final_output_path,
        output_sha256: output.output_sha256,
        receipt: existing.receipt,
      };
    }

    const attemptToken = `attempt_${this.#id()}`.replaceAll('-', '_');
    const paths = await this.#files.createAttemptPaths({
      job_id: jobId,
      attempt_token: attemptToken,
      logical_render_hash: plan.logical_render_hash,
    });
    const reservation = this.#executions.reserve({
      job_id: jobId,
      execution_snapshot_hash: snapshot.execution_snapshot_hash,
      partial_output_path: paths.partial_output_path,
      final_output_path: paths.final_output_path,
    });
    if ('receipt' in reservation) {
      const output = reservation.receipt.output_artifact;
      if (!output) throw new Error('RENDER_EXECUTION_SUCCESS_RECEIPT_INVALID');
      await this.#files.verifyExistingOutput(
        reservation.attempt.final_output_path,
        output.output_sha256,
        output.size_bytes,
      );
      return {
        recovered_existing_success: true,
        execution_attempt_id: reservation.attempt.execution_attempt_id,
        output_path: reservation.attempt.final_output_path,
        output_sha256: output.output_sha256,
        receipt: reservation.receipt,
      };
    }
    let attempt = reservation;
    let promoted = false;
    try {
      await this.#files.reverifyPreparedSnapshot(snapshot);
      const invocation = buildFfmpegInvocationV1({
        plan,
        snapshot,
        policy,
        partial_output_path: paths.partial_output_path,
      });
      attempt = this.#executions.markRunning(attempt.execution_attempt_id);
      const ffmpegResult = await this.#processes.run({
        execution_attempt_id: attempt.execution_attempt_id,
        kind: 'FFMPEG',
        executable: invocation.executable,
        arguments: invocation.arguments,
        shell: false,
        timeout_ms: policy.execution.ffmpeg_timeout_ms,
        no_progress_timeout_ms: policy.execution.no_progress_timeout_ms,
        graceful_cancel_timeout_ms: policy.execution.graceful_cancel_timeout_ms,
        forced_cancel_timeout_ms: policy.execution.forced_cancel_timeout_ms,
        max_log_bytes: policy.execution.max_log_bytes,
        on_progress: (progress) => {
          const frame = progress.frame ?? 0;
          const percent = Math.min(0.99, (Math.max(0, frame) / plan.total_output_frames) * 0.9);
          this.#executions.recordProgress(attempt.execution_attempt_id, {
            frame: progress.frame,
            out_time_ms: progress.out_time_ms,
            percent,
          });
        },
      });
      processFailure(ffmpegResult, 'FFMPEG');
      if (!ffmpegResult.progress_end_observed) {
        throw new RenderExecutionFailure('FFMPEG_PROGRESS_END_MISSING');
      }
      attempt = this.#executions.markVerifying(attempt.execution_attempt_id);
      const beforeProbe = await this.#files.assertStableFile(paths.partial_output_path);
      const probeInvocation = buildFfprobeInvocationV1({
        snapshot,
        output_path: paths.partial_output_path,
      });
      const ffprobeResult = await this.#processes.run({
        execution_attempt_id: attempt.execution_attempt_id,
        kind: 'FFPROBE',
        executable: probeInvocation.executable,
        arguments: probeInvocation.arguments,
        shell: false,
        timeout_ms: policy.execution.ffmpeg_timeout_ms,
        no_progress_timeout_ms: null,
        graceful_cancel_timeout_ms: policy.execution.graceful_cancel_timeout_ms,
        forced_cancel_timeout_ms: policy.execution.forced_cancel_timeout_ms,
        max_log_bytes: policy.execution.max_log_bytes,
      });
      processFailure(ffprobeResult, 'FFPROBE');
      const afterProbe = await this.#files.assertStableFile(
        paths.partial_output_path,
        beforeProbe.sha256,
      );
      if (afterProbe.size_bytes !== beforeProbe.size_bytes) {
        throw new RenderExecutionFailure('RENDER_OUTPUT_CHANGED_DURING_VERIFICATION');
      }
      const verification = verifyFfprobeOutputV1({
        probe_json: ffprobeResult.stdout,
        plan,
        policy,
        observed_size_bytes: afterProbe.size_bytes,
        progress_end_observed: ffmpegResult.progress_end_observed,
      });
      const finalizeProtocol = await this.#files.promoteAtomic({
        partial_output_path: paths.partial_output_path,
        final_output_path: paths.final_output_path,
        expected_sha256: afterProbe.sha256,
        expected_size_bytes: afterProbe.size_bytes,
      });
      promoted = true;
      const outputArtifact: RenderOutputArtifactV1 = {
        artifact_id: `${attempt.execution_attempt_id}:verified-output`,
        output_sha256: afterProbe.sha256,
        size_bytes: afterProbe.size_bytes,
        managed_relative_path: paths.managed_relative_path,
      };
      const receipt = buildRenderReceiptV1({
        receipt_id: `render_receipt_${this.#id()}`,
        job_id: jobId,
        plan,
        snapshot,
        terminal_state: 'SUCCEEDED',
        output_artifact: outputArtifact,
        verification_facts: { ...verification, finalize_protocol: finalizeProtocol },
        error_id: null,
        created_at: this.#clock(),
      });
      this.#executions.commitSuccess({
        execution_attempt_id: attempt.execution_attempt_id,
        receipt,
        output_artifact: outputArtifact,
        managed_path: paths.final_output_path,
        finalize_protocol: finalizeProtocol,
      });
      return {
        recovered_existing_success: false,
        execution_attempt_id: attempt.execution_attempt_id,
        output_path: paths.final_output_path,
        output_sha256: afterProbe.sha256,
        receipt,
      };
    } catch (error) {
      let terminalError = error;
      try {
        await this.#files.removePartial(
          promoted ? paths.final_output_path : paths.partial_output_path,
        );
      } catch (cleanupError) {
        terminalError = cleanupError;
      }
      const code = errorCode(terminalError);
      const terminalState =
        terminalError === error && error instanceof RenderExecutionFailure
          ? error.terminalState
          : 'FAILED';
      const receipt = buildRenderReceiptV1({
        receipt_id: `render_receipt_${this.#id()}`,
        job_id: jobId,
        plan,
        snapshot,
        terminal_state: terminalState,
        output_artifact: null,
        verification_facts: null,
        error_id: code,
        created_at: this.#clock(),
      });
      this.#executions.commitNonSuccess({
        execution_attempt_id: attempt.execution_attempt_id,
        receipt,
        error_message: code,
      });
      throw terminalError;
    }
  }

  async cancelPreparedRender(jobId: string): Promise<boolean> {
    const active = this.#executions.findActive(jobId);
    if (!active) return false;
    return this.#processes.cancel(active.execution_attempt_id);
  }

  async recoverInterruptedExecutions(): Promise<RenderExecutionAttemptRecordV1[]> {
    const recovered: RenderExecutionAttemptRecordV1[] = [];
    for (const attempt of this.#executions.listActive()) {
      let cleanupFailed = false;
      for (const path of [attempt.partial_output_path, attempt.final_output_path]) {
        try {
          await this.#files.removePartial(path);
        } catch {
          cleanupFailed = true;
        }
      }
      const prepared = this.#preparations.require(attempt.job_id);
      const plan = prepared.logical_plan;
      const snapshot = this.#preparations.getReadySnapshot(attempt.job_id);
      if (!plan || !snapshot) throw new Error('RENDER_INTERRUPTED_AUTHORITY_MISSING');
      const receipt = buildRenderReceiptV1({
        receipt_id: `render_receipt_${this.#id()}`,
        job_id: attempt.job_id,
        plan,
        snapshot,
        terminal_state: 'INTERRUPTED',
        output_artifact: null,
        verification_facts: null,
        error_id: cleanupFailed ? 'APP_INTERRUPTED_OUTPUT_CLEANUP_FAILED' : 'APP_INTERRUPTED',
        created_at: this.#clock(),
      });
      recovered.push(
        this.#executions.commitNonSuccess({
          execution_attempt_id: attempt.execution_attempt_id,
          receipt,
          error_message: receipt.error_id!,
        }),
      );
    }
    return recovered;
  }
}
