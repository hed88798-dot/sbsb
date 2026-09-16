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
import { registerIpc } from '../../apps/desktop/src/main/ipc.js';
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
  const jobs = {
    list: vi.fn(),
    require: vi.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: InvokeHandler) => handlers.set(channel, handler)),
    } as unknown as IpcMain;
    registerIpc({
      ipcMain,
      window,
      products: {} as ProductRepository,
      jobs: jobs as unknown as JobRepository,
      settings: {} as SettingsRepository,
      copywriting: {} as CopywritingService,
      render: render as unknown as DesktopRenderOrchestratorV1,
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
});
