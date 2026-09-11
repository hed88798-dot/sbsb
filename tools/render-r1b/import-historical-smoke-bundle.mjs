import { resolve } from 'node:path';
import { importHistoricalR1BSmokeBundle } from '../../apps/desktop/dist-electron/main/render-smoke-bundle-service.js';

const [
  bundleArgument,
  controlledRootArgument,
  migrationsArgument,
  runtimeRootArgument,
  runtimeIdentityArgument,
  approvalReceiptArgument,
] = process.argv.slice(2);
if (
  !bundleArgument ||
  !controlledRootArgument ||
  !migrationsArgument ||
  !runtimeRootArgument ||
  !runtimeIdentityArgument ||
  !approvalReceiptArgument
) {
  throw new Error('R1B_SMOKE_IMPORT_ARGUMENTS_REQUIRED');
}
const result = await importHistoricalR1BSmokeBundle({
  bundle_root: resolve(bundleArgument),
  controlled_root: resolve(controlledRootArgument),
  migrations_directory: resolve(migrationsArgument),
  runtime_root: resolve(runtimeRootArgument),
  runtime_identity_path: resolve(runtimeIdentityArgument),
  approval_receipt_path: resolve(approvalReceiptArgument),
});
console.log(
  JSON.stringify({
    CODE_G_R1B_SMOKE_BUNDLE_IMPORT: 'PASS',
    authority_mode: 'HISTORICAL_ACCEPTED_CHAIN',
    job_id: result.job_id,
    manifest_hash: result.manifest_hash,
    bundle_hash: result.bundle_hash,
    smoke_config_created: true,
  }),
);
