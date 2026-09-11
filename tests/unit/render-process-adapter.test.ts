import { describe, expect, it } from 'vitest';
import {
  NodeRenderProcessAdapterV1,
  windowsTaskkillInvocationV1,
} from '../../apps/desktop/src/main/render-process-adapter.js';

const baseRequest = {
  executable: process.execPath,
  shell: false as const,
  graceful_cancel_timeout_ms: 25,
  forced_cancel_timeout_ms: 100,
  max_log_bytes: 128,
};

describe('Code G R1B direct process supervision', () => {
  it('rejects executable PATH lookup at the process boundary', async () => {
    const adapter = new NodeRenderProcessAdapterV1({ platform: process.platform });
    await expect(
      adapter.run({
        ...baseRequest,
        execution_attempt_id: 'attempt_path_lookup',
        kind: 'FFPROBE',
        executable: 'ffprobe',
        arguments: [],
        timeout_ms: 2_000,
        no_progress_timeout_ms: null,
      }),
    ).rejects.toThrowError('RENDER_PROCESS_PATH_LOOKUP_FORBIDDEN');
  });

  it('uses absolute shell-free Windows process-tree termination invocations', () => {
    expect(
      windowsTaskkillInvocationV1({ pid: 123, forced: false, systemRoot: 'C:\\Windows' }),
    ).toEqual({
      executable: 'C:\\Windows\\System32\\taskkill.exe',
      arguments: ['/PID', '123', '/T'],
      shell: false,
    });
    expect(
      windowsTaskkillInvocationV1({ pid: 123, forced: true, systemRoot: 'C:\\Windows' }).arguments,
    ).toEqual(['/PID', '123', '/T', '/F']);
  });

  it('enforces no-progress timeout and terminates the process', async () => {
    const adapter = new NodeRenderProcessAdapterV1({ platform: process.platform });
    const result = await adapter.run({
      ...baseRequest,
      execution_attempt_id: 'attempt_no_progress',
      kind: 'FFMPEG',
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
      timeout_ms: 2_000,
      no_progress_timeout_ms: 50,
    });
    expect(result.termination_reason).toBe('NO_PROGRESS_TIMEOUT');
    expect(result.progress_end_observed).toBe(false);
    expect(result.exit_code === null || result.exit_code !== 0).toBe(true);
  });

  it('supports caller-owned cancellation with bounded graceful/forced stages', async () => {
    const adapter = new NodeRenderProcessAdapterV1({ platform: process.platform });
    const promise = adapter.run({
      ...baseRequest,
      execution_attempt_id: 'attempt_cancel',
      kind: 'FFMPEG',
      arguments: [
        '-e',
        "process.stdout.write('frame=1\\nprogress=continue\\n'); setInterval(() => {}, 1000)",
      ],
      timeout_ms: 2_000,
      no_progress_timeout_ms: 1_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await adapter.cancel('attempt_cancel')).toBe(true);
    const result = await promise;
    expect(result.termination_reason).toBe('CANCELLED');
    expect(result.progress_end_observed).toBe(false);
    expect(await adapter.cancel('attempt_cancel')).toBe(false);
  });

  it('captures ffprobe JSON with a hard byte bound', async () => {
    const adapter = new NodeRenderProcessAdapterV1({ platform: process.platform });
    const result = await adapter.run({
      ...baseRequest,
      execution_attempt_id: 'attempt_probe',
      kind: 'FFPROBE',
      arguments: ['-e', "process.stdout.write('x'.repeat(512))"],
      timeout_ms: 2_000,
      no_progress_timeout_ms: null,
    });
    expect(result.exit_code).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBe(128);
    expect(result.logs_truncated).toBe(true);
  });
});
