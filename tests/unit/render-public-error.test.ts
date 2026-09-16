import { describe, expect, it } from 'vitest';
import type { JobDTOv1 } from '../../packages/contracts/src/index.js';
import {
  PUBLIC_RENDER_ERROR_MAP,
  PublicRenderIpcError,
  RENDER_DESKTOP_OPERATION_FAILED,
  mapPersistedRenderError,
  mapPublicRenderError,
  runRendererSafeRenderOperation,
  toRendererSafeJobDto,
} from '../../apps/desktop/src/main/render-public-error.js';

const fallbackMessage = '渲染操作失败，请稍后重试';
const hostileDiagnostics = [
  'C:\\Users\\test\\secret-source\\pig-farm.mp4',
  "ENOENT: no such file or directory, lstat 'C:\\Users\\test\\secret-source\\pig-farm.mp4'",
  'C:\\Users\\test\\AppData\\Local\\Company\\AiVideoDesktop\\render\\staging\\attempt-1',
  'C:\\Users\\test\\AppData\\Local\\Company\\AiVideoDesktop\\render\\output\\result.mp4',
  'C:\\Program Files\\Company\\AiVideoDesktop\\resources\\runtime\\ffmpeg-render-v2\\ffmpeg.exe',
  'C:\\Users\\test\\AppData\\Local\\Company\\AiVideoDesktop\\settings.json',
  'RENDER_INTERNAL_SECRET_PATH_FAILURE',
] as const;

function job(overrides: Partial<JobDTOv1>): JobDTOv1 {
  return {
    schema_version: '1.0',
    job_id: 'job_1',
    job_type: 'RENDER',
    state: 'FAILED',
    progress: 0.5,
    created_at: '2026-09-16T00:00:00.000Z',
    started_at: '2026-09-16T00:00:01.000Z',
    finished_at: '2026-09-16T00:00:02.000Z',
    error_code: 'RENDER_INTERNAL_SECRET_PATH_FAILURE',
    error_message: hostileDiagnostics[1],
    request_snapshot_hash: 'a'.repeat(64),
    ...overrides,
  };
}

describe('Desktop public Render error contract', () => {
  it.each(hostileDiagnostics)(
    'maps hostile or unknown diagnostic through the fallback: %s',
    (raw) => {
      const safe = mapPublicRenderError(raw);
      expect(safe).toEqual({
        code: RENDER_DESKTOP_OPERATION_FAILED,
        message: fallbackMessage,
      });
      expect(JSON.stringify(safe)).not.toContain(raw);
    },
  );

  it('uses an explicit positive allowlist with deterministic public messages', () => {
    expect(mapPublicRenderError('RENDER_EXECUTION_ALREADY_ACTIVE')).toEqual({
      code: 'RENDER_EXECUTION_ALREADY_ACTIVE',
      message: '该渲染任务正在执行',
    });
    expect(mapPublicRenderError(new Error('RENDER_SUBSYSTEM_UNAVAILABLE'))).toEqual({
      code: 'RENDER_SUBSYSTEM_UNAVAILABLE',
      message: '渲染功能当前不可用',
    });
    expect(PUBLIC_RENDER_ERROR_MAP.RENDER_INTERNAL_SECRET_PATH_FAILURE).toBeUndefined();
  });

  it('never reuses a persisted Render error message, including for a known code', () => {
    expect(mapPersistedRenderError('RENDER_EXECUTION_NOT_READY', hostileDiagnostics[2])).toEqual({
      error_code: 'RENDER_EXECUTION_NOT_READY',
      error_message: '该渲染任务尚未准备完成',
    });
    expect(mapPersistedRenderError(null, hostileDiagnostics[3])).toEqual({
      error_code: RENDER_DESKTOP_OPERATION_FAILED,
      error_message: fallbackMessage,
    });
  });

  it('sanitizes only RENDER jobs and leaves COPYWRITING presentation unchanged', () => {
    const render = toRendererSafeJobDto(job({}));
    expect(render.error_code).toBe(RENDER_DESKTOP_OPERATION_FAILED);
    expect(render.error_message).toBe(fallbackMessage);
    expect(JSON.stringify(render)).not.toContain('secret-source');

    const copywriting = job({ job_type: 'COPYWRITING' });
    expect(toRendererSafeJobDto(copywriting)).toBe(copywriting);
    expect(toRendererSafeJobDto(copywriting).error_message).toBe(hostileDiagnostics[1]);
  });

  it.each(hostileDiagnostics)(
    'throws only a safe public IPC error for hostile lower-layer diagnostic: %s',
    async (raw) => {
      const thrown = await runRendererSafeRenderOperation(() => {
        throw new Error(raw, { cause: new Error(`cause: ${raw}`) });
      }).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(PublicRenderIpcError);
      expect(thrown).toMatchObject({
        code: RENDER_DESKTOP_OPERATION_FAILED,
        publicMessage: fallbackMessage,
        message: `${RENDER_DESKTOP_OPERATION_FAILED}: ${fallbackMessage}`,
        stack: undefined,
      });
      expect('cause' in (thrown as object)).toBe(false);
      expect(JSON.stringify(thrown)).not.toContain(raw);
    },
  );
});
