import { resolveApprovedRuntimeV2Authority } from '../../apps/desktop/dist-electron/main/render-runtime-authority-service.js';

export async function resolveApprovedRuntimeV2(config) {
  try {
    const resolution = await resolveApprovedRuntimeV2Authority({
      runtime_root: config.root,
      runtime_manifest_path: config.manifest_path,
      approval_receipt_path: config.approval_receipt_path,
    });
    return {
      identity: resolution.identity,
      ffprobePath: resolution.ffprobe_path,
      receiptSha256: resolution.approval_receipt_sha256,
    };
  } catch (error) {
    throw new Error('RUNTIME_V2_AUTHORITY_INVALID', { cause: error });
  }
}
