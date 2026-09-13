import { readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2,
  assertApprovedRuntimeV2Identity,
  renderRuntimeIdentityV1Schema,
  verifyRuntimeV2ApprovalReceipt,
} from '../../packages/render/dist/index.js';
import { canonicalJson, hashFile, sha256 } from '../../packages/domain-media-index/dist/index.js';

function selfHash(value, field) {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256(canonicalJson(copy));
}

function runtimeIdentityHash(manifest) {
  const copy = structuredClone(manifest);
  delete copy.manifest_sha256;
  delete copy.runtime_identity_sha256;
  delete copy.license_evidence;
  return sha256(canonicalJson(copy));
}

function findEntrypoint(manifest, name) {
  const entry = manifest.entrypoints?.find((candidate) => candidate.path === name);
  if (!entry) throw new Error('RUNTIME_V2_AUTHORITY_INVALID');
  return entry;
}

export async function resolveApprovedRuntimeV2(config) {
  try {
    const receiptBytes = await readFile(resolve(config.approval_receipt_path));
    const receiptSha256 = await hashFile(resolve(config.approval_receipt_path));
    if (receiptSha256 !== CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256) {
      throw new Error('RUNTIME_V2_AUTHORITY_INVALID');
    }
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    const approved = verifyRuntimeV2ApprovalReceipt({ receipt_sha256: receiptSha256, receipt });
    const manifest = JSON.parse(await readFile(resolve(config.manifest_path), 'utf8'));
    if (
      selfHash(manifest, 'manifest_sha256') !== manifest.manifest_sha256 ||
      runtimeIdentityHash(manifest) !== manifest.runtime_identity_sha256 ||
      manifest.runtime_id !== approved.runtime_id ||
      manifest.manifest_sha256 !== approved.runtime_manifest_sha256 ||
      manifest.runtime_identity_sha256 !== CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256
    ) {
      throw new Error('RUNTIME_V2_AUTHORITY_INVALID');
    }
    const runtimeRoot = await realpath(resolve(config.root));
    const bundleRoot = await realpath(join(runtimeRoot, 'bundle'));
    const ffmpeg = findEntrypoint(manifest, 'ffmpeg.exe');
    const ffprobe = findEntrypoint(manifest, 'ffprobe.exe');
    const ffmpegPath = await realpath(join(bundleRoot, 'ffmpeg.exe'));
    const ffprobePath = await realpath(join(bundleRoot, 'ffprobe.exe'));
    const members = manifest.bundle_members.map((member) => ({
      relative_path: member.path,
      sha256: member.sha256,
    }));
    for (const member of manifest.bundle_members) {
      const memberPath = await realpath(join(bundleRoot, member.path));
      if (!(await stat(memberPath)).isFile() || (await hashFile(memberPath)) !== member.sha256) {
        throw new Error('RUNTIME_V2_AUTHORITY_INVALID');
      }
    }
    const identity = renderRuntimeIdentityV1Schema.parse({
      schema_version: '1.0',
      runtime_id: manifest.runtime_id,
      platform: 'win32',
      architecture: 'x64',
      ffmpeg_executable_path: ffmpegPath,
      ffmpeg_entrypoint_sha256: ffmpeg.sha256,
      ffprobe_executable_path: ffprobePath,
      ffprobe_entrypoint_sha256: ffprobe.sha256,
      companion_manifest_sha256: manifest.manifest_sha256,
      capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_id,
      capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_version,
      capability_profile_hash: manifest.provenance.code_g_capability_profile_hash,
      runtime_member_hashes: members,
      approval_status: 'APPROVED',
    });
    assertApprovedRuntimeV2Identity(identity);
    return { identity, ffprobePath, receiptSha256 };
  } catch (error) {
    if (error instanceof Error && error.message === 'RUNTIME_V2_AUTHORITY_INVALID') throw error;
    throw new Error('RUNTIME_V2_AUTHORITY_INVALID', { cause: error });
  }
}
