import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface InstalledDesktopStartupSmokeEvidenceV1 {
  schema_version: '1.0';
  record_kind: 'R1C_B_INSTALLED_DESKTOP_STARTUP_SMOKE';
  head_sha: string;
  process_resources_path: string;
  render_composition_initialized: boolean;
  render_execution_recovery_completed: boolean;
  render_preparation_recovery_completed: boolean;
  generic_non_render_recovery_completed: boolean;
  browser_window_created: boolean;
  unhandled_main_rejection_observed: boolean;
  uncaught_main_exception_observed: boolean;
  main_startup_failure_observed: boolean;
  runtime_fallback_observed: boolean;
  shutdown_requested: boolean;
  graceful_shutdown_completed: boolean;
  database_closed_after_settlement: boolean;
  result: 'PASS' | 'FAIL';
}

export interface InstalledDesktopStartupSmokeRecorderV1 {
  markRenderCompositionInitialized(available: boolean): void;
  markRecoveryCompleted(): void;
  markBrowserWindowCreated(): void;
  markShutdownRequested(): void;
  markShutdownCompleted(databaseClosedAfterSettlement: boolean): void;
  markRuntimeFallbackObserved(): void;
  markUnhandledMainRejection(): void;
  markUncaughtMainException(): void;
  markMainStartupFailure(): void;
  write(): Promise<InstalledDesktopStartupSmokeEvidenceV1>;
}

function passable(state: InstalledDesktopStartupSmokeEvidenceV1): boolean {
  return (
    state.render_composition_initialized &&
    state.render_execution_recovery_completed &&
    state.render_preparation_recovery_completed &&
    state.generic_non_render_recovery_completed &&
    state.browser_window_created &&
    !state.unhandled_main_rejection_observed &&
    !state.uncaught_main_exception_observed &&
    !state.main_startup_failure_observed &&
    !state.runtime_fallback_observed &&
    state.shutdown_requested &&
    state.graceful_shutdown_completed &&
    state.database_closed_after_settlement
  );
}

export function createInstalledDesktopStartupSmokeRecorder(options: {
  evidencePath: string;
  headSha: string;
  processResourcesPath: string;
}): InstalledDesktopStartupSmokeRecorderV1 {
  const state: InstalledDesktopStartupSmokeEvidenceV1 = {
    schema_version: '1.0',
    record_kind: 'R1C_B_INSTALLED_DESKTOP_STARTUP_SMOKE',
    head_sha: options.headSha,
    process_resources_path: options.processResourcesPath,
    render_composition_initialized: false,
    render_execution_recovery_completed: false,
    render_preparation_recovery_completed: false,
    generic_non_render_recovery_completed: false,
    browser_window_created: false,
    unhandled_main_rejection_observed: false,
    uncaught_main_exception_observed: false,
    main_startup_failure_observed: false,
    runtime_fallback_observed: false,
    shutdown_requested: false,
    graceful_shutdown_completed: false,
    database_closed_after_settlement: false,
    result: 'FAIL',
  };

  const write = async (): Promise<InstalledDesktopStartupSmokeEvidenceV1> => {
    state.result = passable(state) ? 'PASS' : 'FAIL';
    await mkdir(dirname(options.evidencePath), { recursive: true });
    await writeFile(options.evidencePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return structuredClone(state);
  };

  return {
    markRenderCompositionInitialized(available) {
      state.render_composition_initialized = available;
    },
    markRecoveryCompleted() {
      state.render_execution_recovery_completed = true;
      state.render_preparation_recovery_completed = true;
      state.generic_non_render_recovery_completed = true;
    },
    markBrowserWindowCreated() {
      state.browser_window_created = true;
    },
    markShutdownRequested() {
      state.shutdown_requested = true;
    },
    markShutdownCompleted(databaseClosedAfterSettlement) {
      state.graceful_shutdown_completed = true;
      state.database_closed_after_settlement = databaseClosedAfterSettlement;
    },
    markRuntimeFallbackObserved() {
      state.runtime_fallback_observed = true;
    },
    markUnhandledMainRejection() {
      state.unhandled_main_rejection_observed = true;
    },
    markUncaughtMainException() {
      state.uncaught_main_exception_observed = true;
    },
    markMainStartupFailure() {
      state.main_startup_failure_observed = true;
    },
    write() {
      return write();
    },
  };
}
