import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, type DemoState } from '../../packages/contracts/src/index.js';
import {
  JobRepository,
  ProductRepository,
  SettingsRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import { DemoCoreService } from '../../apps/desktop/src/main/demo-core-service.js';
import { registerIpc, type DesktopIpcBoundaryV1 } from '../../apps/desktop/src/main/ipc.js';

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }));
type Database = Awaited<ReturnType<typeof openDatabase>>['db'];
type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const frame = { url: 'file:///desktop/index.html' };
const event = {
  sender: { id: 7, mainFrame: frame },
  senderFrame: frame,
} as unknown as IpcMainInvokeEvent;
let database: Database;
let boundary: DesktopIpcBoundaryV1;
const invoke = (channel: string, input: unknown, sender = event) => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error('HANDLER_MISSING');
  return handler(sender, input);
};
function intent(state: DemoState) {
  const candidate = state.candidate;
  return {
    candidate_id: candidate.candidate_id,
    candidate_revision: candidate.candidate_revision,
    source_document_id: candidate.source_document_id,
    source_document_version: candidate.source_document_version,
    source_document_hash: candidate.source_document_hash,
  };
}
beforeEach(async () => {
  handlers.clear();
  database = (
    await openDatabase({
      dbPath: join(mkdtempSync(join(tmpdir(), 'demo-ipc-')), 'fresh.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    })
  ).db;
  const service = new DemoCoreService({ database });
  boundary = registerIpc({
    ipcMain: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as IpcMain,
    window: { webContents: { id: 7 } } as unknown as BrowserWindow,
    products: new ProductRepository(database),
    jobs: new JobRepository(database),
    settings: new SettingsRepository(database),
    copywriting: {} as Parameters<typeof registerIpc>[0]['copywriting'],
    render: {} as Parameters<typeof registerIpc>[0]['render'],
    renderTimelineHandoff: {} as Parameters<typeof registerIpc>[0]['renderTimelineHandoff'],
    demo: {
      propose: async (input) => service.propose(input),
      confirm: async (input) => service.confirm(input),
      get: async (input) => service.get(input),
    },
  });
});
afterEach(() => database.close());
describe('Demo IPC with real fresh database authority', () => {
  it('requires separate bound confirmation and reads persisted state through IPC', async () => {
    const state = (await invoke(IPC_CHANNELS.demoPropose, {
      text: '猪群活动。记录变化。',
      route: 'ANIMAL',
    })) as DemoState;
    expect(state.stage).toBe('PROPOSED');
    expect(state.confirmed).toBeNull();
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
    const confirmed = (await invoke(IPC_CHANNELS.demoConfirm, intent(state))) as DemoState;
    expect(confirmed.stage).toBe('CONFIRMED');
    expect(
      await invoke(IPC_CHANNELS.demoGet, { candidate_id: state.candidate.candidate_id }),
    ).toEqual(confirmed);
    expect(database.prepare('SELECT COUNT(*) FROM provider_call_summaries').pluck().get()).toBe(0);
  });
  it('rejects extra fields, invalid routes, empty input and stale confirmation without writes', async () => {
    for (const input of [
      { text: '动物', route: 'ANIMAL', auto_confirm: true },
      { text: '动物', route: 'NO_MATCH' },
      { text: ' ', route: 'ANIMAL' },
    ])
      await expect(invoke(IPC_CHANNELS.demoPropose, input)).rejects.toThrow();
    expect(database.prepare('SELECT COUNT(*) FROM scripts').pluck().get()).toBe(0);
    const state = (await invoke(IPC_CHANNELS.demoPropose, {
      text: '产品包装。展示细节。',
      route: 'PRODUCT',
    })) as DemoState;
    await expect(
      invoke(IPC_CHANNELS.demoConfirm, { ...intent(state), candidate_revision: 2 }),
    ).rejects.toThrow('STALE');
    await expect(
      invoke(IPC_CHANNELS.demoConfirm, { ...intent(state), source_document_hash: '0'.repeat(64) }),
    ).rejects.toThrow('HASH_MISMATCH');
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
  });
  it('blocks other senders and origins before creating scripts', async () => {
    const badFrame = { url: 'https://example.org/' };
    for (const bad of [
      { sender: { id: 8, mainFrame: frame }, senderFrame: frame },
      { sender: { id: 7, mainFrame: badFrame }, senderFrame: badFrame },
      { sender: { id: 7, mainFrame: frame }, senderFrame: { ...frame } },
    ])
      await expect(
        invoke(
          IPC_CHANNELS.demoPropose,
          { text: '动物。', route: 'ANIMAL' },
          bad as unknown as IpcMainInvokeEvent,
        ),
      ).rejects.toThrow('UNTRUSTED_IPC');
    expect(database.prepare('SELECT COUNT(*) FROM scripts').pluck().get()).toBe(0);
  });
  it('quiesces before any new work or confirmation', async () => {
    const state = (await invoke(IPC_CHANNELS.demoPropose, {
      text: '动物。',
      route: 'ANIMAL',
    })) as DemoState;
    boundary.quiesce();
    expect(await invoke(IPC_CHANNELS.demoConfirm, intent(state))).toBeUndefined();
    expect(
      await invoke(IPC_CHANNELS.demoPropose, { text: '另一条。', route: 'ANIMAL' }),
    ).toBeUndefined();
    expect(database.prepare('SELECT COUNT(*) FROM scripts').pluck().get()).toBe(1);
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
  });
});
