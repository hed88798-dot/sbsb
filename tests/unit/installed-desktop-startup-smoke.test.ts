import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInstalledDesktopStartupSmokeRecorder } from '../../apps/desktop/src/main/installed-desktop-startup-smoke.js';

async function recorder() {
  const root = await mkdtemp(join(tmpdir(), 'r1c-b-startup-smoke-'));
  const evidencePath = join(root, 'r1c-b-installed-desktop-smoke.json');
  return {
    evidencePath,
    value: createInstalledDesktopStartupSmokeRecorder({
      evidencePath,
      headSha: 'head-test',
      processResourcesPath: 'C:\\Program Files\\AiVideo\\resources',
    }),
  };
}

describe('R1C-B normal installed Desktop smoke evidence', () => {
  it('fails closed until every post-event milestone is recorded', async () => {
    const smoke = await recorder();
    const initial = await smoke.value.write();
    expect(initial.result).toBe('FAIL');

    smoke.value.markRenderCompositionInitialized(true);
    smoke.value.markRecoveryCompleted();
    smoke.value.markBrowserWindowCreated();
    smoke.value.markShutdownRequested();
    smoke.value.markShutdownCompleted(true);
    const complete = await smoke.value.write();
    expect(complete.result).toBe('PASS');
    expect(JSON.parse(await readFile(smoke.evidencePath, 'utf8'))).toMatchObject({
      record_kind: 'R1C_B_INSTALLED_DESKTOP_STARTUP_SMOKE',
      head_sha: 'head-test',
      process_resources_path: 'C:\\Program Files\\AiVideo\\resources',
      render_composition_initialized: true,
      render_execution_recovery_completed: true,
      render_preparation_recovery_completed: true,
      generic_non_render_recovery_completed: true,
      browser_window_created: true,
      shutdown_requested: true,
      graceful_shutdown_completed: true,
      database_closed_after_settlement: true,
      main_startup_failure_observed: false,
      result: 'PASS',
    });
  });

  it('turns an observed unhandled Main failure into a fail-closed result', async () => {
    const smoke = await recorder();
    smoke.value.markRenderCompositionInitialized(true);
    smoke.value.markRecoveryCompleted();
    smoke.value.markBrowserWindowCreated();
    smoke.value.markShutdownRequested();
    smoke.value.markShutdownCompleted(true);
    smoke.value.markUnhandledMainRejection();
    await expect(smoke.value.write()).resolves.toMatchObject({
      unhandled_main_rejection_observed: true,
      result: 'FAIL',
    });
  });
});
