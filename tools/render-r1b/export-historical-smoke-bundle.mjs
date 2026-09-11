import { resolve } from 'node:path';
import {
  RenderPolicyRepository,
  RenderPreparationRepository,
  openDatabase,
} from '../../packages/local-db/dist/index.js';
import { exportHistoricalR1BSmokeBundle } from '../../apps/desktop/dist-electron/main/render-smoke-bundle-service.js';

const [dbArgument, migrationsArgument, jobId, bundleArgument] = process.argv.slice(2);
if (!dbArgument || !migrationsArgument || !jobId || !bundleArgument) {
  throw new Error('R1B_SMOKE_EXPORT_ARGUMENTS_REQUIRED');
}
const { db } = await openDatabase({
  dbPath: resolve(dbArgument),
  migrationsDirectory: resolve(migrationsArgument),
});
try {
  const result = await exportHistoricalR1BSmokeBundle({
    preparations: new RenderPreparationRepository(db),
    policies: new RenderPolicyRepository(db),
    job_id: jobId,
    bundle_root: resolve(bundleArgument),
  });
  console.log(
    JSON.stringify({
      CODE_G_R1B_SMOKE_BUNDLE_EXPORT: 'PASS',
      authority_mode: result.manifest.authority_mode,
      job_id: result.manifest.job_id,
      logical_render_hash: result.manifest.logical_render_hash,
      original_execution_snapshot_hash: result.manifest.original_execution_snapshot_hash,
      manifest_hash: result.manifest.manifest_hash,
      bundle_hash: result.manifest.bundle_hash,
      file_count: result.manifest.files.length,
    }),
  );
} finally {
  db.close();
}
