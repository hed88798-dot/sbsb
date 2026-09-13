import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_ID,
  CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
  CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2,
  assertApprovedRuntimeV2Identity,
  verifyRuntimeV2ApprovalReceipt,
  type RenderRuntimeIdentityV1,
} from '../../packages/render/src/index.js';

const receiptPath = resolve(
  import.meta.dirname,
  '../../compliance/approval/ffmpeg-render-v2/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
);

function approvedIdentity(): RenderRuntimeIdentityV1 {
  return {
    schema_version: '1.0',
    runtime_id: CODE_G_R1B_APPROVED_RUNTIME_V2_ID,
    platform: 'win32',
    architecture: 'x64',
    ffmpeg_executable_path: 'D:\\runtime\\ffmpeg.exe',
    ffmpeg_entrypoint_sha256: CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256,
    ffprobe_executable_path: 'D:\\runtime\\ffprobe.exe',
    ffprobe_entrypoint_sha256: CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256,
    companion_manifest_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
    capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_id,
    capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_version,
    capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash,
    runtime_member_hashes: [
      { relative_path: 'manifest.json', sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256 },
    ],
    approval_status: 'APPROVED',
  };
}

describe('Code G R1B active Runtime v2 authority binding', () => {
  const receiptBytes = readFileSync(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString('utf8')) as Record<string, unknown>;

  it('accepts the exact approved V2 receipt and active runtime identity', () => {
    expect(createHash('sha256').update(receiptBytes).digest('hex')).toBe(
      CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256,
    );
    expect(
      verifyRuntimeV2ApprovalReceipt({
        receipt_sha256: CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256,
        receipt,
      }),
    ).toEqual(
      expect.objectContaining({
        runtime_id: CODE_G_R1B_APPROVED_RUNTIME_V2_ID,
        runtime_manifest_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
      }),
    );
    expect(() => assertApprovedRuntimeV2Identity(approvedIdentity())).not.toThrow();
  });

  it('rejects a wrong receipt hash', () => {
    expect(() =>
      verifyRuntimeV2ApprovalReceipt({ receipt_sha256: '0'.repeat(64), receipt }),
    ).toThrowError('RENDER_RUNTIME_V2_APPROVAL_RECEIPT_INVALID');
  });

  it.each([
    ['Profile v2 hash', ['authority', 'code_g_profile_hash'], '0'.repeat(64)],
    ['Build Profile v2 hash', ['authority', 'code_f_build_profile_hash'], '0'.repeat(64)],
    ['Runtime id', ['candidate', 'runtime_id'], 'wrong-runtime'],
    ['runtime manifest', ['candidate', 'runtime_manifest_sha256'], '0'.repeat(64)],
    ['runtime identity', ['candidate', 'runtime_identity_sha256'], '0'.repeat(64)],
    ['ffmpeg', ['candidate', 'entrypoints', 'ffmpeg.exe'], '0'.repeat(64)],
    ['ffprobe', ['candidate', 'entrypoints', 'ffprobe.exe'], '0'.repeat(64)],
    ['transport TAR', ['candidate', 'transport_tar_sha256'], '0'.repeat(64)],
  ])('rejects a wrong %s semantic binding', (_name, path, replacement) => {
    const mutated = structuredClone(receipt);
    let target = mutated;
    for (const part of path.slice(0, -1)) target = target[part] as Record<string, unknown>;
    target[path.at(-1)!] = replacement;
    expect(() =>
      verifyRuntimeV2ApprovalReceipt({
        receipt_sha256: CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256,
        receipt: mutated,
      }),
    ).toThrowError('RENDER_RUNTIME_V2_APPROVAL_RECEIPT_INVALID');
  });

  it('rejects historically approved Runtime v1 from active R1B execution', () => {
    const v1 = {
      ...approvedIdentity(),
      runtime_id: 'code-f-ffmpeg-render-windows-x86_64-v1',
      capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id,
      capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_version,
      capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash,
    };
    expect(() => assertApprovedRuntimeV2Identity(v1)).toThrowError(
      'RENDER_EXECUTION_RUNTIME_V2_NOT_APPROVED',
    );
  });

  it.each([
    ['Runtime id', 'runtime_id', 'wrong-runtime'],
    ['Profile v2 hash', 'capability_profile_hash', '0'.repeat(64)],
    ['runtime manifest', 'companion_manifest_sha256', '0'.repeat(64)],
    ['ffmpeg', 'ffmpeg_entrypoint_sha256', '0'.repeat(64)],
    ['ffprobe', 'ffprobe_entrypoint_sha256', '0'.repeat(64)],
  ] as const)('rejects a wrong active %s identity binding', (_name, field, replacement) => {
    const identity = { ...approvedIdentity(), [field]: replacement };
    expect(() => assertApprovedRuntimeV2Identity(identity)).toThrowError(
      'RENDER_EXECUTION_RUNTIME_V2_NOT_APPROVED',
    );
  });
});
