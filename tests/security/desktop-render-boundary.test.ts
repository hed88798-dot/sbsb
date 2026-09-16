import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../packages/contracts/src/index.js';

const root = resolve(import.meta.dirname, '../..');
const ipcSource = readFileSync(join(root, 'apps/desktop/src/main/ipc.ts'), 'utf8');
const preloadSource = readFileSync(join(root, 'apps/desktop/src/preload/index.ts'), 'utf8');
const lifecycleSource = readFileSync(
  join(root, 'apps/desktop/src/main/desktop-lifecycle-owner.ts'),
  'utf8',
);
const orchestratorSource = readFileSync(
  join(root, 'apps/desktop/src/main/desktop-render-orchestrator.ts'),
  'utf8',
);

describe('Desktop Render execution boundary', () => {
  it('uses the exact narrow Render IPC allowlist and preserves trusted sender checks', () => {
    expect([
      IPC_CHANNELS.renderPrepare,
      IPC_CHANNELS.renderExecute,
      IPC_CHANNELS.renderCancel,
      IPC_CHANNELS.renderGet,
    ]).toEqual(['render:prepare', 'render:execute', 'render:cancel', 'render:get']);
    expect(ipcSource).toContain('assertTrustedSender(event, options.window)');
    expect(ipcSource).toContain('RENDER_CANCEL_REQUIRES_RENDER_API');
    expect(ipcSource).toContain("job.job_type !== 'COPYWRITING'");
  });

  it('validates Render preload inputs and outputs without path or process authority', () => {
    expect(preloadSource).toContain('renderPrepareRequestV1Schema.parse(request)');
    expect(preloadSource).toContain('renderJobRequestV1Schema.parse');
    expect(preloadSource).toContain('renderJobDtoV1Schema');
    expect(preloadSource).toContain('renderCancelResultV1Schema');
    expect(preloadSource).not.toMatch(/(?:runtime_root|ffmpeg_path|output_path|source_path)/u);
    expect(preloadSource).not.toMatch(/(?:child_process|shell\.openPath|showItemInFolder)/u);
  });

  it('adds no Desktop process termination or execution lock authority', () => {
    const desktopBoundary = `${lifecycleSource}\n${orchestratorSource}`;
    expect(desktopBoundary).not.toMatch(/(?:taskkill|process\.kill|child\.kill|spawn\s*\()/u);
    expect(desktopBoundary).not.toMatch(/(?:Mutex|LockManager|executionLock)/u);
    expect(orchestratorSource).toContain('cancelPreparedRender');
  });
});
