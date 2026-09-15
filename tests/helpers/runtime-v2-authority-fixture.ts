import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { canonicalJson, hashFile, sha256 } from '../../packages/domain-media-index/src/index.js';
import {
  CODE_G_R1B_APPROVED_BUILD_PROFILE_V2_SHA256,
  CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_ID,
  CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2,
} from '../../packages/render/src/index.js';
import { createApprovedRuntimeV2AuthorityResolverForTests } from '../../apps/desktop/src/main/render-runtime-authority-service.js';

const approvalReceiptSource = resolve(
  import.meta.dirname,
  '../../compliance/approval/ffmpeg-render-v2/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
);

const companionHash = 'ab'.repeat(32);

export async function createRuntimeV2AuthorityFixture(root: string) {
  const runtimeRoot = join(root, 'runtime-v2');
  const bundleRoot = join(runtimeRoot, 'bundle');
  await mkdir(bundleRoot, { recursive: true });
  const ffmpegPath = join(bundleRoot, 'ffmpeg.exe');
  const ffprobePath = join(bundleRoot, 'ffprobe.exe');
  const companionPath = join(bundleRoot, 'avcodec-63.dll');
  await writeFile(ffmpegPath, 'approved-ffmpeg-v2-test-double');
  await writeFile(ffprobePath, 'approved-ffprobe-v2-test-double');
  await writeFile(companionPath, 'approved-companion-v2-test-double');
  const manifest = {
    schema_version: '1',
    subject_type: 'FFMPEG_RENDER_RUNTIME_BUNDLE',
    role: 'PRODUCT_RUNTIME_DEPENDENCY',
    runtime_id: CODE_G_R1B_APPROVED_RUNTIME_V2_ID,
    platform: { architecture: 'x86_64', os: 'windows' },
    entrypoints: [
      { path: 'ffmpeg.exe', sha256: CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256 },
      { path: 'ffprobe.exe', sha256: CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256 },
    ],
    bundle_members: [
      { kind: 'DYNAMIC_LIBRARY', path: 'avcodec-63.dll', sha256: companionHash },
      { kind: 'EXECUTABLE', path: 'ffmpeg.exe', sha256: CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256 },
      {
        kind: 'EXECUTABLE',
        path: 'ffprobe.exe',
        sha256: CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256,
      },
    ],
    provenance: {
      build_profile_sha256: CODE_G_R1B_APPROVED_BUILD_PROFILE_V2_SHA256,
      code_g_capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash,
    },
    manifest_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
    runtime_identity_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256,
    license_evidence: { policy_disposition: 'TEST_DOUBLE_FOR_CONTRACT_VERIFICATION' },
  };
  const manifestPath = join(runtimeRoot, 'manifest.json');
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`);
  const approvalReceiptPath = join(root, 'runtime-v2-approval-receipt.json');
  await copyFile(approvalReceiptSource, approvalReceiptPath);

  const manifestPayload = structuredClone(manifest) as Record<string, unknown>;
  delete manifestPayload.manifest_sha256;
  const identityPayload = structuredClone(manifest) as Record<string, unknown>;
  delete identityPayload.manifest_sha256;
  delete identityPayload.runtime_identity_sha256;
  delete identityPayload.license_evidence;
  const expectedCanonicalHashes = new Map([
    [canonicalJson(manifestPayload), CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256],
    [canonicalJson(identityPayload), CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256],
  ]);
  const approvedFileHashes = new Map<string, string>();
  for (const [path, expectedHash] of [
    [ffmpegPath, CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256],
    [ffprobePath, CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256],
    [companionPath, companionHash],
  ] as const) {
    approvedFileHashes.set(await hashFile(path), expectedHash);
  }
  const resolveRuntimeAuthority = createApprovedRuntimeV2AuthorityResolverForTests({
    hashFile: async (path) => {
      const observed = await hashFile(path);
      return approvedFileHashes.get(observed) ?? observed;
    },
    hashCanonical: (value) => {
      const canonical = canonicalJson(value);
      return expectedCanonicalHashes.get(canonical) ?? sha256(canonical);
    },
  });
  const input = {
    runtime_root: runtimeRoot,
    runtime_manifest_path: manifestPath,
    approval_receipt_path: approvalReceiptPath,
  };
  return {
    runtimeRoot,
    bundleRoot,
    manifest,
    manifestPath,
    approvalReceiptPath,
    ffmpegPath,
    ffprobePath,
    companionPath,
    resolveRuntimeAuthority,
    input,
  };
}
