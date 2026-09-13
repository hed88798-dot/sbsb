import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const receiptPath = resolve(
  import.meta.dirname,
  '../../compliance/approval/ffmpeg-render-v2/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
);
const sidecarPath = resolve(
  import.meta.dirname,
  '../../compliance/approval/ffmpeg-render-v2/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.sha256',
);
const receiptBytes = readFileSync(receiptPath);
type RotationEvidence = {
  status: string;
  rotation_applied_exactly_once: boolean;
  output_nonidentity_display_matrix: boolean;
};
type Receipt = {
  approval_status: string;
  approval_scope: string;
  authority: {
    code_g_profile_hash: string;
    code_f_build_profile_hash: string;
    FFMPEG_RENDER_BUILD_PROFILE_V1: {
      artifact_status: string;
      final_approval_authority: boolean;
    };
  };
  candidate: {
    runtime_id: string;
    entrypoints: Record<string, string>;
    transport_tar_sha256: string;
  };
  durable_artifact: {
    release_id: number;
    asset_id: number;
    durable_retrieval_verification: string;
  };
  windows_11_desktop_dynamic_evidence: {
    attempt: number;
    status: string;
    evidence_sha256: string;
    durable_evidence: { json_asset_id: number; readback_verification: string };
    rotations: Record<string, RotationEvidence>;
  };
  pixel_oracle_v2: { product_role: string; package_inclusion: string };
  product_boundary: {
    electron_packaged_integration: string;
    code_g_product_render: string;
    code_g_r1b: string;
    runtime_v1_status: string;
    runtime_v1_mutated: boolean;
    pixel_oracle_v1_mutated: boolean;
  };
};
const receipt = JSON.parse(receiptBytes.toString('utf8')) as Receipt;
const receiptSha256 = createHash('sha256').update(receiptBytes).digest('hex');

describe('Code F FFmpeg Render Runtime v2 final approval', () => {
  it('binds the exact approved runtime, profile, and durable transport', () => {
    expect(receipt.approval_status).toBe('APPROVED');
    expect(receipt.approval_scope).toBe('STANDALONE_RUNTIME_INTAKE_ONLY');
    expect(receipt.authority.code_g_profile_hash).toBe(
      '2c19710e609b1ae769e7f007cffca1e552ce1158963bec2aa8a8bcad59a01c1b',
    );
    expect(receipt.authority.code_f_build_profile_hash).toBe(
      '40ebffb4307b1c2ec141ffbdd3be2e2c52545090ea1f776267fa445952b3657c',
    );
    expect(receipt.candidate.runtime_id).toBe('code-f-ffmpeg-render-windows-x86_64-34699695106');
    expect(receipt.candidate.entrypoints['ffmpeg.exe']).toBe(
      '7fc910c87e37502f3ff1f7e56c0ee470d91597aece9cd873880ce3c477d0a933',
    );
    expect(receipt.candidate.entrypoints['ffprobe.exe']).toBe(
      '641b8649c3d11702942a4b649d6ecee35231e04e09ce50a8d74b8c46b5295c4e',
    );
    expect(receipt.candidate.transport_tar_sha256).toBe(
      'a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01',
    );
    expect(receipt.durable_artifact.release_id).toBe(387604810);
    expect(receipt.durable_artifact.asset_id).toBe(559437104);
    expect(receipt.durable_artifact.durable_retrieval_verification).toBe('PASS');
  });

  it('binds Windows 11 Attempt 7 and keeps the product boundary explicit', () => {
    const evidence = receipt.windows_11_desktop_dynamic_evidence;
    expect(evidence.attempt).toBe(7);
    expect(evidence.status).toBe('PASS_RUNTIME_LEVEL_ONLY');
    expect(evidence.evidence_sha256).toBe(
      'db55c0f88d85734f5504ef8387bf9396a6b004ae4ec79979c03858951a41f748',
    );
    expect(evidence.durable_evidence.json_asset_id).toBe(561197534);
    expect(evidence.durable_evidence.readback_verification).toBe('PASS');
    for (const angle of ['90', '180', '270']) {
      expect(evidence.rotations[angle].status).toBe('PASS');
      expect(evidence.rotations[angle].rotation_applied_exactly_once).toBe(true);
      expect(evidence.rotations[angle].output_nonidentity_display_matrix).toBe(false);
    }
    expect(receipt.product_boundary.electron_packaged_integration).toBe('NOT_RUN');
    expect(receipt.product_boundary.code_g_product_render).toBe('NOT_RUN');
    expect(receipt.product_boundary.code_g_r1b).toBe('NOT_STARTED');
  });

  it('is self-hash bound and preserves historical v1/oracle boundaries', () => {
    expect(readFileSync(sidecarPath, 'utf8')).toContain(
      `${receiptSha256}  FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json`,
    );
    expect(receipt.authority.FFMPEG_RENDER_BUILD_PROFILE_V1).toMatchObject({
      artifact_status: 'HISTORICAL_PROFILE_CREATION_STATE',
      final_approval_authority: false,
    });
    expect(receipt.pixel_oracle_v2.product_role).toBe('NONE');
    expect(receipt.pixel_oracle_v2.package_inclusion).toBe('FORBIDDEN');
    expect(receipt.product_boundary.runtime_v1_status).toBe('HISTORICALLY_APPROVED');
    expect(receipt.product_boundary.runtime_v1_mutated).toBe(false);
    expect(receipt.product_boundary.pixel_oracle_v1_mutated).toBe(false);
  });
});
