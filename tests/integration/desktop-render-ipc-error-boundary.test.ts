import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, type JobDTOv1 } from '../../packages/contracts/src/index.js';
import type {
  JobRepository,
  ProductRepository,
  SettingsRepository,
} from '../../packages/local-db/src/index.js';
import type { CopywritingService } from '../../apps/desktop/src/main/copywriting-service.js';
import type { DesktopRenderOrchestratorV1 } from '../../apps/desktop/src/main/desktop-render-orchestrator.js';
import type { DesktopRenderTimelineHandoffV1 } from '../../apps/desktop/src/main/desktop-render-timeline-handoff.js';
import { registerIpc, type DesktopIpcBoundaryV1 } from '../../apps/desktop/src/main/ipc.js';
import { RENDER_DESKTOP_OPERATION_FAILED } from '../../apps/desktop/src/main/render-public-error.js';

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}));

type InvokeHandler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>;

const prepareRequest = {
  schema_version: '1.0',
  timeline_id: 'timeline_1',
  timeline_version: 1,
  expected_timeline_commit_receipt_hash: 'a'.repeat(64),
  render_policy_id: 'render-policy-v1',
  render_policy_version: 1,
  render_policy_hash: 'b'.repeat(64),
} as const;
const jobRequest = { schema_version: '1.0', job_id: 'render_job_1' } as const;
const fallbackMessage = '渲染操作失败，请稍后重试';
const renderJobDto = {
  schema_version: '1.0',
  job_id: 'render_job_1',
  job_state: 'QUEUED',
  progress: 0,
  preparation_state: 'READY_FOR_EXECUTION',
  active_execution_state: null,
  timeline_id: 'timeline_1',
  timeline_version: 1,
  logical_render_hash: '1'.repeat(64),
  execution_snapshot_hash: '2'.repeat(64),
  cancellation_requested: false,
  error_code: null,
  error_message: null,
  created_at: '2026-09-17T00:00:00.000Z',
  started_at: null,
  finished_at: null,
  result: null,
} as const;

function job(jobType: string, errorCode: string, errorMessage: string): JobDTOv1 {
  return {
    schema_version: '1.0',
    job_id: `${jobType.toLowerCase()}_job`,
    job_type: jobType,
    state: 'FAILED',
    progress: 0.5,
    created_at: '2026-09-16T00:00:00.000Z',
    started_at: '2026-09-16T00:00:01.000Z',
    finished_at: '2026-09-16T00:00:02.000Z',
    error_code: errorCode,
    error_message: errorMessage,
    request_snapshot_hash: 'c'.repeat(64),
  };
}

describe('Desktop Render IPC public error boundary', () => {
  const handlers = new Map<string, InvokeHandler>();
  const frame = { url: 'file:///desktop/index.html' };
  const event = {
    sender: { id: 7, mainFrame: frame },
    senderFrame: frame,
  } as unknown as IpcMainInvokeEvent;
  const window = { webContents: { id: 7 } } as unknown as BrowserWindow;
  const render = {
    prepare: vi.fn(),
    execute: vi.fn(),
    cancel: vi.fn(),
    get: vi.fn(),
  };
  const renderTimelineHandoff = {
    listTimelineSources: vi.fn(),
    prepareFromTimeline: vi.fn(),
  };
  const jobs = {
    list: vi.fn(),
    require: vi.fn(),
  };
  const products = { list: vi.fn() };
  let ipcBoundary: DesktopIpcBoundaryV1;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: InvokeHandler) => handlers.set(channel, handler)),
    } as unknown as IpcMain;
    ipcBoundary = registerIpc({
      ipcMain,
      window,
      products: products as unknown as ProductRepository,
      jobs: jobs as unknown as JobRepository,
      settings: {} as SettingsRepository,
      copywriting: {} as CopywritingService,
      render: render as unknown as DesktopRenderOrchestratorV1,
      renderTimelineHandoff: renderTimelineHandoff as unknown as DesktopRenderTimelineHandoffV1,
    });
  });

  async function invoke(channel: string, input: unknown): Promise<unknown> {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`missing handler: ${channel}`);
    return handler(event, input);
  }

  it('sanitizes render:prepare and render:execute lower-layer path diagnostics', async () => {
    const sourceDiagnostic =
      "ENOENT: no such file or directory, lstat 'C:\\Users\\test\\secret-source\\pig-farm.mp4'";
    const outputDiagnostic =
      'C:\\Users\\test\\AppData\\Local\\Company\\AiVideoDesktop\\render\\output\\result.mp4';
    render.prepare.mockRejectedValueOnce(new Error(sourceDiagnostic));
    render.execute.mockRejectedValueOnce(new Error(outputDiagnostic));

    for (const [channel, input, raw] of [
      [IPC_CHANNELS.renderPrepare, prepareRequest, sourceDiagnostic],
      [IPC_CHANNELS.renderExecute, jobRequest, outputDiagnostic],
    ] as const) {
      const thrown = await invoke(channel, input).catch((error: unknown) => error);
      expect(thrown).toMatchObject({
        code: RENDER_DESKTOP_OPERATION_FAILED,
        publicMessage: fallbackMessage,
        stack: undefined,
      });
      expect(String((thrown as Error).message)).not.toContain(raw);
      expect('cause' in (thrown as object)).toBe(false);
    }
  });

  it('sanitizes render:cancel and render:get and preserves allowlisted identities', async () => {
    const stagingDiagnostic =
      'C:\\Users\\test\\AppData\\Local\\Company\\AiVideoDesktop\\render\\staging\\attempt-1';
    render.cancel.mockRejectedValueOnce(new Error(stagingDiagnostic));
    render.get.mockImplementationOnce(() => {
      throw new Error('RENDER_SUBSYSTEM_UNAVAILABLE');
    });

    const cancelError = await invoke(IPC_CHANNELS.renderCancel, jobRequest).catch(
      (error: unknown) => error,
    );
    expect(cancelError).toMatchObject({
      code: RENDER_DESKTOP_OPERATION_FAILED,
      publicMessage: fallbackMessage,
    });
    expect(String((cancelError as Error).message)).not.toContain(stagingDiagnostic);

    const getError = await invoke(IPC_CHANNELS.renderGet, jobRequest).catch(
      (error: unknown) => error,
    );
    expect(getError).toMatchObject({
      code: 'RENDER_SUBSYSTEM_UNAVAILABLE',
      publicMessage: '渲染功能当前不可用',
    });
  });

  it('sanitizes Timeline discovery and product prepare internal failures', async () => {
    const receiptDiagnostic = `TIMELINE_INTEGRITY_FAILURE:${'a'.repeat(64)}`;
    const sqliteDiagnostic =
      'SQLITE_CORRUPT: C:\\Users\\test\\AppData\\Local\\Company\\AiVideoDesktop\\app.db';
    renderTimelineHandoff.listTimelineSources.mockImplementationOnce(() => {
      throw new Error(receiptDiagnostic);
    });
    renderTimelineHandoff.prepareFromTimeline.mockRejectedValueOnce(new Error(sqliteDiagnostic));

    for (const [channel, input, raw] of [
      [IPC_CHANNELS.renderListTimelineSources, undefined, receiptDiagnostic],
      [
        IPC_CHANNELS.renderPrepareFromTimeline,
        { schema_version: '1.0', timeline_id: 'timeline_1', timeline_version: 1 },
        sqliteDiagnostic,
      ],
    ] as const) {
      const thrown = await invoke(channel, input).catch((error: unknown) => error);
      expect(thrown).toMatchObject({
        code: RENDER_DESKTOP_OPERATION_FAILED,
        publicMessage: fallbackMessage,
        stack: undefined,
      });
      expect(JSON.stringify(thrown)).not.toContain(raw);
      expect('cause' in (thrown as object)).toBe(false);
    }
  });

  it('exposes only validated source DTOs and a selector-only product prepare request', async () => {
    const source = {
      schema_version: '1.0',
      timeline_id: 'timeline_1',
      timeline_version: 1,
      committed_at: '2026-09-17T00:00:00.000Z',
      total_duration_ms: 30_000,
      segment_count: 3,
    } as const;
    renderTimelineHandoff.listTimelineSources.mockReturnValueOnce([source]);
    renderTimelineHandoff.prepareFromTimeline.mockResolvedValueOnce(renderJobDto);

    await expect(invoke(IPC_CHANNELS.renderListTimelineSources, undefined)).resolves.toEqual([
      source,
    ]);
    const selector = { schema_version: '1.0', timeline_id: 'timeline_1', timeline_version: 1 };
    await expect(invoke(IPC_CHANNELS.renderPrepareFromTimeline, selector)).resolves.toEqual(
      renderJobDto,
    );
    expect(renderTimelineHandoff.prepareFromTimeline).toHaveBeenCalledWith(selector);

    const callsBeforeInvalid = renderTimelineHandoff.prepareFromTimeline.mock.calls.length;
    const invalid = { ...selector, render_policy_hash: 'a'.repeat(64) };
    const rejected = await invoke(IPC_CHANNELS.renderPrepareFromTimeline, invalid).catch(
      (error: unknown) => error,
    );
    expect(rejected).toMatchObject({
      code: RENDER_DESKTOP_OPERATION_FAILED,
      publicMessage: fallbackMessage,
    });
    expect(renderTimelineHandoff.prepareFromTimeline).toHaveBeenCalledTimes(callsBeforeInvalid);
  });

  it('sanitizes only RENDER entries returned by jobs:list', async () => {
    const diagnostic =
      'C:\\Program Files\\Company\\AiVideoDesktop\\resources\\runtime\\ffmpeg-render-v2\\ffmpeg.exe';
    const renderJob = job('RENDER', 'RENDER_INTERNAL_SECRET_PATH_FAILURE', diagnostic);
    const copywritingJob = job('COPYWRITING', 'COPYWRITING_FAILED', diagnostic);
    jobs.list.mockReturnValueOnce([renderJob, copywritingJob]);

    const result = (await invoke(IPC_CHANNELS.jobsList, undefined)) as JobDTOv1[];
    expect(result[0]).toMatchObject({
      error_code: RENDER_DESKTOP_OPERATION_FAILED,
      error_message: fallbackMessage,
    });
    expect(JSON.stringify(result[0])).not.toContain(diagnostic);
    expect(result[1]).toEqual(copywritingJob);
  });

  it('rejects products:list and jobs:list before repository access after quiescence', async () => {
    products.list.mockReturnValueOnce([]);
    jobs.list.mockReturnValueOnce([]);
    await expect(invoke(IPC_CHANNELS.productsList, undefined)).resolves.toEqual([]);
    await expect(invoke(IPC_CHANNELS.jobsList, undefined)).resolves.toEqual([]);
    expect(products.list).toHaveBeenCalledTimes(1);
    expect(jobs.list).toHaveBeenCalledTimes(1);

    ipcBoundary.quiesce();
    await expect(invoke(IPC_CHANNELS.productsList, undefined)).resolves.toBeUndefined();
    await expect(invoke(IPC_CHANNELS.jobsList, undefined)).resolves.toBeUndefined();
    expect(products.list).toHaveBeenCalledTimes(1);
    expect(jobs.list).toHaveBeenCalledTimes(1);
  });
});
