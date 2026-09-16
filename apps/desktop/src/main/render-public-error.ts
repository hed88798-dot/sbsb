import type { JobDTOv1 } from '@app/contracts';

export const RENDER_DESKTOP_OPERATION_FAILED = 'RENDER_DESKTOP_OPERATION_FAILED';

export interface PublicRenderErrorV1 {
  code: string;
  message: string;
}

const PUBLIC_RENDER_ERROR_FALLBACK: PublicRenderErrorV1 = Object.freeze({
  code: RENDER_DESKTOP_OPERATION_FAILED,
  message: '渲染操作失败，请稍后重试',
});

export const PUBLIC_RENDER_ERROR_MAP: Readonly<Record<string, PublicRenderErrorV1>> = Object.freeze(
  {
    RENDER_SUBSYSTEM_UNAVAILABLE: Object.freeze({
      code: 'RENDER_SUBSYSTEM_UNAVAILABLE',
      message: '渲染功能当前不可用',
    }),
    RENDER_DESKTOP_SHUTTING_DOWN: Object.freeze({
      code: 'RENDER_DESKTOP_SHUTTING_DOWN',
      message: '应用正在退出，暂不接受新的渲染任务',
    }),
    RENDER_EXECUTION_ALREADY_ACTIVE: Object.freeze({
      code: 'RENDER_EXECUTION_ALREADY_ACTIVE',
      message: '该渲染任务正在执行',
    }),
    RENDER_EXECUTION_NOT_READY: Object.freeze({
      code: 'RENDER_EXECUTION_NOT_READY',
      message: '该渲染任务尚未准备完成',
    }),
    RENDER_EXECUTION_CANCELLATION_REQUESTED: Object.freeze({
      code: 'RENDER_EXECUTION_CANCELLATION_REQUESTED',
      message: '该渲染任务已请求取消',
    }),
    RENDER_STAGED_INPUT_HASH_MISMATCH: Object.freeze({
      code: 'RENDER_STAGED_INPUT_HASH_MISMATCH',
      message: '渲染素材校验失败，请重新准备任务',
    }),
    RENDER_RUNTIME_SNAPSHOT_AUTHORITY_MISMATCH: Object.freeze({
      code: 'RENDER_RUNTIME_SNAPSHOT_AUTHORITY_MISMATCH',
      message: '渲染运行环境校验失败',
    }),
    RENDER_JOB_NOT_FOUND: Object.freeze({
      code: 'RENDER_JOB_NOT_FOUND',
      message: '未找到该渲染任务',
    }),
    JOB_NOT_FOUND: Object.freeze({
      code: 'RENDER_JOB_NOT_FOUND',
      message: '未找到该渲染任务',
    }),
    RENDER_JOB_TYPE_MISMATCH: Object.freeze({
      code: 'RENDER_JOB_TYPE_MISMATCH',
      message: '任务类型不是渲染任务',
    }),
  },
);

function internalErrorIdentity(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return null;
}

export function mapPublicRenderError(value: unknown): PublicRenderErrorV1 {
  const identity = internalErrorIdentity(value);
  return (
    (identity === null ? undefined : PUBLIC_RENDER_ERROR_MAP[identity]) ??
    PUBLIC_RENDER_ERROR_FALLBACK
  );
}

export function mapPersistedRenderError(
  errorCode: string | null,
  errorMessage: string | null,
): { error_code: string | null; error_message: string | null } {
  if (errorCode === null && errorMessage === null) {
    return { error_code: null, error_message: null };
  }
  const safe = mapPublicRenderError(errorCode);
  return { error_code: safe.code, error_message: safe.message };
}

export function toRendererSafeJobDto(job: JobDTOv1): JobDTOv1 {
  if (job.job_type !== 'RENDER') return job;
  return { ...job, ...mapPersistedRenderError(job.error_code, job.error_message) };
}

export class PublicRenderIpcError extends Error {
  readonly code: string;
  readonly publicMessage: string;

  constructor(error: unknown) {
    const safe = mapPublicRenderError(error);
    super(`${safe.code}: ${safe.message}`);
    this.name = 'PublicRenderIpcError';
    this.code = safe.code;
    this.publicMessage = safe.message;
    Object.defineProperty(this, 'stack', { value: undefined, configurable: true });
  }
}

export async function runRendererSafeRenderOperation<T>(
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new PublicRenderIpcError(error);
  }
}
