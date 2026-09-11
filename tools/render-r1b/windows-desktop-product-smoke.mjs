import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  RenderExecutionRepository,
  RenderPolicyRepository,
  RenderPreparationRepository,
  openDatabase,
} from '../../packages/local-db/dist/index.js';
import { RenderExecutionFileService } from '../../apps/desktop/dist-electron/main/render-execution-file-service.js';
import { RenderExecutionServiceV1 } from '../../apps/desktop/dist-electron/main/render-execution-service.js';
import { NodeRenderProcessAdapterV1 } from '../../apps/desktop/dist-electron/main/render-process-adapter.js';

const expectedKeys = [
  'schema_version',
  'authority_mode',
  'job_id',
  'db_path',
  'migrations_directory',
  'staging_root',
  'output_root',
  'runtime_root',
  'approval_receipt_path',
  'expected_timeline_id',
  'expected_timeline_version',
  'expected_timeline_commit_receipt_hash',
  'expected_logical_render_hash',
  'smoke_bundle_manifest_hash',
  'smoke_bundle_hash',
];

function fail(code) {
  throw new Error(code);
}

function exactConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('R1B_SMOKE_CONFIG_INVALID');
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...expectedKeys].sort())) {
    fail('R1B_SMOKE_CONFIG_KEYS_INVALID');
  }
  if (value.schema_version !== '1.0') fail('R1B_SMOKE_CONFIG_VERSION_INVALID');
  if (value.authority_mode !== 'HISTORICAL_ACCEPTED_CHAIN') {
    fail('R1B_SMOKE_HISTORICAL_AUTHORITY_REQUIRED');
  }
  for (const key of ['job_id', 'expected_timeline_id']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      fail('R1B_SMOKE_CONFIG_INVALID');
    }
  }
  for (const key of [
    'expected_timeline_commit_receipt_hash',
    'expected_logical_render_hash',
    'smoke_bundle_manifest_hash',
    'smoke_bundle_hash',
  ]) {
    if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(value[key])) {
      fail('R1B_SMOKE_AUTHORITY_HASH_INVALID');
    }
  }
  if (
    !Number.isSafeInteger(value.expected_timeline_version) ||
    value.expected_timeline_version < 1
  ) {
    fail('R1B_SMOKE_CONFIG_INVALID');
  }
  for (const key of [
    'db_path',
    'migrations_directory',
    'staging_root',
    'output_root',
    'runtime_root',
    'approval_receipt_path',
  ]) {
    if (typeof value[key] !== 'string' || !isAbsolute(value[key])) {
      fail('R1B_SMOKE_MAIN_PATH_INVALID');
    }
  }
  return value;
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  fail('R1B_SMOKE_REQUIRES_WINDOWS_11_X64_DESKTOP');
}
const configArgument = process.argv[2];
if (!configArgument) fail('R1B_SMOKE_CONFIG_PATH_REQUIRED');
const configPath = resolve(configArgument);
const config = exactConfig(JSON.parse(await readFile(configPath, 'utf8')));
const { db } = await openDatabase({
  dbPath: config.db_path,
  migrationsDirectory: config.migrations_directory,
});

try {
  const preparations = new RenderPreparationRepository(db);
  const prepared = preparations.require(config.job_id);
  if (
    prepared.state !== 'READY_FOR_EXECUTION' ||
    !prepared.logical_plan ||
    prepared.logical_plan.timeline_id !== config.expected_timeline_id ||
    prepared.logical_plan.timeline_version !== config.expected_timeline_version ||
    prepared.logical_plan.timeline_commit_receipt_hash !==
      config.expected_timeline_commit_receipt_hash ||
    prepared.logical_plan.logical_render_hash !== config.expected_logical_render_hash
  ) {
    fail('R1B_SMOKE_HISTORICAL_AUTHORITY_BINDING_MISMATCH');
  }
  const executions = new RenderExecutionRepository(db);
  const lifecycle = [];
  const processes = new NodeRenderProcessAdapterV1({
    onLifecycle: (event) => lifecycle.push(event),
  });
  const service = new RenderExecutionServiceV1({
    preparations,
    policies: new RenderPolicyRepository(db),
    executions,
    files: new RenderExecutionFileService({
      stagingRoot: config.staging_root,
      outputRoot: config.output_root,
      runtimeRoot: config.runtime_root,
      approvalReceiptPath: config.approval_receipt_path,
    }),
    processes,
  });
  const interrupted = await service.recoverInterruptedExecutions();
  if (interrupted.length > 0) fail('R1B_SMOKE_INTERRUPTED_ATTEMPT_RECOVERED_RETRY_REQUIRED');

  const cancellationExecution = service.executePreparedRender(config.job_id);
  let earlyCancellationError = null;
  let earlyCancellationCompletion = false;
  void cancellationExecution.then(
    () => {
      earlyCancellationCompletion = true;
    },
    (error) => {
      earlyCancellationError = error;
    },
  );
  const deadline = Date.now() + 30_000;
  let cancellationAttempt = null;
  while (Date.now() < deadline) {
    if (earlyCancellationError) throw earlyCancellationError;
    if (earlyCancellationCompletion) fail('R1B_SMOKE_FFMPEG_COMPLETED_BEFORE_CANCELLATION');
    const active = executions.findActive(config.job_id);
    if (
      active?.state === 'RUNNING' &&
      lifecycle.some(
        (event) =>
          event.execution_attempt_id === active.execution_attempt_id &&
          event.kind === 'FFMPEG' &&
          event.event === 'PROCESS_STARTED',
      )
    ) {
      cancellationAttempt = active;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!cancellationAttempt) fail('R1B_SMOKE_FFMPEG_PROCESS_DID_NOT_START_FOR_CANCELLATION');
  if (!(await service.cancelPreparedRender(config.job_id))) fail('R1B_SMOKE_CANCEL_NOT_ACCEPTED');
  let cancellationError = null;
  try {
    await cancellationExecution;
  } catch (error) {
    cancellationError = error;
  }
  if (!(cancellationError instanceof Error) || cancellationError.message !== 'FFMPEG_CANCELLED') {
    fail('R1B_SMOKE_CANCELLATION_RESULT_INVALID');
  }
  const cancelledAttempt = executions.require(cancellationAttempt.execution_attempt_id);
  if (
    cancelledAttempt.state !== 'CANCELLED' ||
    cancelledAttempt.output_artifact_record_id !== null ||
    !cancelledAttempt.receipt_id ||
    existsSync(cancelledAttempt.partial_output_path) ||
    existsSync(cancelledAttempt.final_output_path)
  ) {
    fail('R1B_SMOKE_CANCELLED_ATTEMPT_INTEGRITY_INVALID');
  }
  const cancelledReceipt = JSON.parse(
    db
      .prepare('SELECT receipt_json FROM render_receipts WHERE receipt_id = ?')
      .pluck()
      .get(cancelledAttempt.receipt_id),
  );
  if (
    cancelledReceipt.terminal_state !== 'CANCELLED' ||
    cancelledReceipt.output_artifact !== null ||
    cancelledReceipt.verification_facts !== null
  ) {
    fail('R1B_SMOKE_CANCELLED_RECEIPT_INVALID');
  }
  const cancellationEvents = lifecycle.filter(
    (event) => event.execution_attempt_id === cancelledAttempt.execution_attempt_id,
  );
  const startedEvent = cancellationEvents.find((event) => event.event === 'PROCESS_STARTED');
  const gracefulEvent = cancellationEvents.find(
    (event) => event.event === 'WINDOWS_TREE_GRACEFUL_REQUESTED',
  );
  const forcedEvent = cancellationEvents.find(
    (event) => event.event === 'WINDOWS_TREE_FORCED_REQUESTED',
  );
  const closedEvent = cancellationEvents.find((event) => event.event === 'PROCESS_CLOSED');
  if (!startedEvent?.pid || !gracefulEvent || !closedEvent) {
    fail('R1B_SMOKE_WINDOWS_PROCESS_TREE_EVIDENCE_MISSING');
  }
  let processAlive = false;
  try {
    process.kill(startedEvent.pid, 0);
    processAlive = true;
  } catch {
    processAlive = false;
  }
  if (processAlive) fail('R1B_SMOKE_ORPHAN_FFMPEG_PROCESS');
  const cancellationElapsedMs =
    Date.parse(closedEvent.observed_at) - Date.parse(gracefulEvent.observed_at);
  const policy = new RenderPolicyRepository(db).require(
    prepared.logical_plan.render_policy_id,
    prepared.logical_plan.render_policy_version,
  );
  if (
    cancellationElapsedMs < 0 ||
    cancellationElapsedMs >
      policy.execution.graceful_cancel_timeout_ms +
        policy.execution.forced_cancel_timeout_ms +
        2_000
  ) {
    fail('R1B_SMOKE_CANCELLATION_BOUND_EXCEEDED');
  }

  const result = await service.executePreparedRender(config.job_id);
  const attempt = executions.require(result.execution_attempt_id);
  console.log(
    JSON.stringify({
      CODE_G_R1B_WINDOWS_11_PRODUCT_SMOKE: 'PASS',
      PRODUCT_SERVICE_PATH: 'RenderExecutionServiceV1.executePreparedRender',
      HISTORICAL_UPSTREAM_AUTHORITY_REUSED: 'PASS',
      job_id: config.job_id,
      timeline_id: prepared.logical_plan.timeline_id,
      timeline_version: prepared.logical_plan.timeline_version,
      timeline_commit_receipt_hash: prepared.logical_plan.timeline_commit_receipt_hash,
      logical_render_hash: prepared.logical_plan.logical_render_hash,
      execution_snapshot_hash: prepared.current_execution_snapshot_hash,
      execution_attempt_id: result.execution_attempt_id,
      terminal_state: attempt.state,
      finalize_protocol: attempt.finalize_protocol,
      output_sha256: result.output_sha256,
      receipt_hash: result.receipt.receipt_hash,
      actual_video_frames: result.receipt.verification_facts?.frame_count,
      source_video_audio: 'DROP',
      narration: 'ONLY',
      subtitle: 'OFF',
      smoke_bundle_manifest_hash: config.smoke_bundle_manifest_hash,
      smoke_bundle_hash: config.smoke_bundle_hash,
      WINDOWS_CANCELLATION_PRODUCT_HARNESS: 'PASS',
      cancellation_attempt_id: cancelledAttempt.execution_attempt_id,
      cancellation_receipt_hash: cancelledReceipt.receipt_hash,
      cancellation_terminal_state: cancelledAttempt.state,
      ffmpeg_process_started: true,
      windows_taskkill_tree_path_exercised: true,
      graceful_bounded_stage_observed: true,
      forced_stage_exercised: Boolean(forcedEvent),
      forced_stage_required: Boolean(forcedEvent),
      no_orphan_ffmpeg_process: true,
      cancellation_partial_promoted: false,
      cancellation_verified_output_created: false,
    }),
  );
} finally {
  db.close();
}
