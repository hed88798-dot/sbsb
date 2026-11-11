import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [operation, configArgument] = process.argv.slice(2);
const operations = ['preflight', 'timeline', 'render', 'captions'];

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

try {
  if (!operations.includes(operation) || !configArgument) {
    throw new Error(
      'Usage: node tools/demo-render/run.mjs preflight|timeline|render|captions config.json',
    );
  }
  const config = JSON.parse(await readFile(resolve(configArgument), 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('DEMO_CONFIG_INVALID');
  }
  const requiredPath = (key) => {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) {
      throw new Error(`DEMO_ABSOLUTE_PATH_REQUIRED:${key}`);
    }
    return config[key];
  };
  const { resolveDesktopRenderRuntimeAuthority } =
    await import('../../apps/desktop/dist-electron/main/desktop-render-runtime-locator.js');
  if (operation === 'preflight') {
    const authority = await resolveDesktopRenderRuntimeAuthority({
      is_packaged: false,
      controlled_dev_runtime_root: requiredPath('runtime_root'),
    });
    console.log(
      JSON.stringify(
        {
          status: 'RUNTIME_AUTHORITY_VERIFIED',
          host: `${process.platform}-${process.arch}`,
          runtime_root: authority.runtime_root,
          demo_acceptance: 'NOT_RUN',
          real_provider_request_count: 0,
        },
        null,
        2,
      ),
    );
  } else {
    const dbPath = requiredPath('db_path');
    if (!(await stat(dbPath)).isFile()) throw new Error('DEMO_EXISTING_DATABASE_REQUIRED');
    const { openDatabase, JobRepository, TimelinePlanRepository, RenderExecutionRepository } =
      await import('../../packages/local-db/dist/index.js');
    const { db } = await openDatabase({
      dbPath,
      migrationsDirectory: resolve(repoRoot, 'migrations/desktop-sqlite'),
    });
    let composition;
    try {
      if (operation === 'timeline') {
        const { commitDemoTimeline } = await import('./timeline.mjs');
        const timeline = await commitDemoTimeline({
          database: db,
          shot_plan_id: config.shot_plan_id,
          shot_plan_version: config.shot_plan_version,
          timing_snapshot: JSON.parse(await readFile(requiredPath('timing_snapshot_path'), 'utf8')),
          selection_request_ids: config.selection_request_ids,
          timeline_id: config.timeline_id,
        });
        console.log(
          JSON.stringify(
            {
              status: 'TIMELINE_COMMITTED',
              timeline_id: timeline.timeline_id,
              timeline_version: timeline.version,
              commit_receipt: timeline.commit_receipt,
              demo_acceptance: 'NOT_RUN',
            },
            null,
            2,
          ),
        );
      } else if (operation === 'captions') {
        const timeline = new TimelinePlanRepository(db).getVersion(
          config.timeline_id,
          config.timeline_version,
        );
        if (!timeline) throw new Error('DEMO_COMMITTED_TIMELINE_REQUIRED');
        const { createDemoSrt } = await import('./captions.mjs');
        const srt = createDemoSrt(
          timeline.planning_request.confirmed_shot_plan,
          timeline.planning_request.narration_timing_snapshot,
        );
        await writeFile(requiredPath('srt_path'), srt, { flag: 'wx' });
        console.log(
          JSON.stringify({
            status: 'SIDECAR_SRT_CREATED',
            subtitle_burn_in: false,
            core_mp4_modified: false,
          }),
        );
      } else {
        const { createDesktopRenderCompositionV1 } =
          await import('../../apps/desktop/dist-electron/main/desktop-render-composition.js');
        composition = await createDesktopRenderCompositionV1({
          database: db,
          jobs: new JobRepository(db),
          userDataPath: requiredPath('user_data_path'),
          runtimeLocation: {
            is_packaged: false,
            controlled_dev_runtime_root: requiredPath('runtime_root'),
          },
        });
        if (!composition.available) throw new Error('DEMO_APPROVED_RENDER_RUNTIME_UNAVAILABLE');
        await composition.orchestrator.recoverStartup();
        const job = await composition.timelineHandoff.prepareFromTimeline({
          schema_version: '1.0',
          timeline_id: config.timeline_id,
          timeline_version: config.timeline_version,
        });
        const executed = await composition.orchestrator.execute(job.job_id);
        const success = new RenderExecutionRepository(db).findSucceeded(job.job_id);
        if (!success || executed.job_state !== 'SUCCEEDED')
          throw new Error('DEMO_RENDER_NOT_SUCCEEDED');
        const path = success.attempt.final_output_path;
        const actualHash = await sha256File(path);
        if (actualHash !== executed.result?.output_sha256)
          throw new Error('DEMO_FINAL_OUTPUT_HASH_MISMATCH');
        console.log(
          JSON.stringify(
            {
              status: 'CORE_MP4_VERIFIED',
              job: executed,
              output_path: path,
              actual_output_sha256: actualHash,
              formal_receipt: success.receipt,
              real_provider_request_count: 0,
              subtitle: 'OFF',
              windows_e2e_acceptance: 'REQUIRES_SEPARATE_FRESH_DB_UI_RUN',
            },
            null,
            2,
          ),
        );
      }
    } finally {
      const shutdown = composition ? await composition.orchestrator.shutdown() : null;
      if (shutdown && !shutdown.settled) throw new Error('DEMO_RENDER_SHUTDOWN_NOT_SETTLED');
      db.close();
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'BLOCKED',
      stage: operation ?? 'CONFIG',
      error: error instanceof Error ? error.message : String(error),
      demo_acceptance: 'NOT_RUN',
    }),
  );
  process.exitCode = 1;
}
