import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const profilePath = resolve(
  import.meta.dirname,
  '../../tools/ffmpeg-render-pixel-oracle-v2/CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V2.json',
);
const profileSidecarPath = resolve(
  import.meta.dirname,
  '../../tools/ffmpeg-render-pixel-oracle-v2/CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V2.sha256',
);
const builderPath = resolve(
  import.meta.dirname,
  '../../tools/ffmpeg-render-pixel-oracle-v2/build-windows.sh',
);
const verifierPath = resolve(
  import.meta.dirname,
  '../../tools/ffmpeg-render-pixel-oracle-v2/verify-artifact-v2.mjs',
);
const workflowPath = resolve(
  import.meta.dirname,
  '../../.github/workflows/code-f-ffmpeg-pixel-oracle-v2.yml',
);
const retentionWorkflowPath = resolve(
  import.meta.dirname,
  '../../.github/workflows/code-f-ffmpeg-pixel-oracle-v2-retention.yml',
);
const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
  profile_id: string;
  profile_version: number;
  tool_role: string;
  product_runtime_identity_effect: string;
  package_inclusion: string;
  upstream_source: { release: string; commit: string; archive_sha256: string };
  configure_arguments: string[];
  capabilities: { required: string[]; forbidden: string[] };
  verification: { input: string; output: string; autorotation: string; network: string };
};
const profileSidecar = readFileSync(profileSidecarPath, 'utf8');
const builder = readFileSync(builderPath, 'utf8');
const verifier = readFileSync(verifierPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');
const retentionWorkflow = readFileSync(retentionWorkflowPath, 'utf8');

describe('Code F rotation pixel oracle v2 isolation', () => {
  it('declares a forward test-only replacement without mutating v1', () => {
    expect(profile.profile_id).toBe('code-f-rotation-pixel-oracle-build-profile-v2');
    expect(profile.profile_version).toBe(2);
    expect(profile.tool_role).toBe('TEST_ONLY');
    expect(profile.product_runtime_identity_effect).toBe('NONE');
    expect(profile.package_inclusion).toBe('FORBIDDEN');
    expect(profile.upstream_source.release).toBe('9.0.1');
    expect(profile.upstream_source.commit).toBe('bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa');
    expect(profile.upstream_source.archive_sha256).toBe(
      'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
    );
    expect(profileSidecar).toContain(
      '287d5842524499ca183d262cf4e4654998f001d487dbc866fc0dbf3ce2231753  CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V2.json',
    );
  });

  it('adds only the scale filter required for RGB24 conversion', () => {
    for (const argument of [
      '--disable-everything',
      '--enable-ffmpeg',
      '--enable-demuxer=mov',
      '--enable-decoder=h264',
      '--enable-parser=h264',
      '--enable-filter=format',
      '--enable-filter=scale',
      '--enable-swscale',
      '--enable-encoder=rawvideo',
      '--enable-muxer=rawvideo',
      '--enable-protocol=file',
      '--disable-network',
      '--disable-gpl',
      '--disable-nonfree',
      '--enable-static',
      '--disable-shared',
    ])
      expect(profile.configure_arguments).toContain(argument);
    expect(profile.configure_arguments).not.toContain('--enable-encoder=h264_mf');
    expect(profile.configure_arguments).not.toContain('--enable-encoder=aac');
    expect(profile.capabilities.required).toContain('scale_filter');
    expect(profile.capabilities.forbidden).toEqual(
      expect.arrayContaining([
        'network_protocols',
        'device_capture',
        'h264_mf_encoder',
        'aac_encoder',
        'product_runtime_use',
      ]),
    );
  });

  it('verifies the actual binary and requires exact RGB24 smoke evidence', () => {
    expect(builder).toContain('verify-artifact-v2.mjs');
    expect(builder).toContain('PIXEL_ORACLE_SMOKE_FIXTURE_SHA256');
    expect(builder).toContain('code-f-rotation-pixel-oracle-v2-windows-x86_64.tar');
    expect(verifier).toContain("scale_filter: hasToken(filters, 'scale')");
    expect(verifier).toContain("'-noautorotate'");
    expect(verifier).toContain("'-pix_fmt'");
    expect(verifier).toContain("'rgb24'");
    expect(verifier).toContain('expectedBytes = width * height * 3');
    expect(verifier).toContain('RGB24 smoke fixture hash mismatch');
  });

  it('uses explicit fixture provenance and private durable retention', () => {
    expect(workflow).toContain('code-f/ffmpeg-render-runtime-v2-intake');
    expect(workflow).toContain("'tools/ffmpeg-render-pixel-oracle-v2/**'");
    expect(workflow).toContain("'tools/ffmpeg-render-build/preflight-windows.sh'");
    expect(workflow).not.toContain('CODE_F_FFMPEG_RENDER_RUNTIME_V2_INTAKE_REPORT.md');
    expect(workflow).toContain('actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955');
    expect(workflow).not.toContain('actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906952');
    expect(workflow).toContain('fixture_url:');
    expect(workflow).toContain('fixture_sha256:');
    expect(workflow).toContain(
      'https://api.github.com/repos/hed88798-dot/sbsb/releases/assets/561006627',
    );
    expect(workflow).toContain('FIXTURE_TOKEN: ${{ secrets.PIXEL_ORACLE_FIXTURE_TOKEN }}');
    expect(workflow).toContain("Accept = 'application/octet-stream'");
    expect(workflow).toContain('Authorization = "Bearer $env:FIXTURE_TOKEN"');
    expect(workflow).toContain(
      "inputs.fixture_url || 'https://api.github.com/repos/hed88798-dot/sbsb/releases/assets/561006627'",
    );
    expect(workflow).toContain(
      "inputs.fixture_sha256 || '47e9e88e7b01375230a32f5284c4ecaf251dc9ec99c523e1374db5fa54e9e58a'",
    );
    expect(workflow).toContain('retention-days: 1');
    expect(workflow).toContain('contents: read');
    expect(retentionWorkflow).toContain('contents: write');
    expect(retentionWorkflow).toContain(
      "'.github/workflows/code-f-ffmpeg-pixel-oracle-v2-retention.yml'",
    );
    expect(retentionWorkflow).toContain("inputs.source_run_id || '34752887351'");
    expect(retentionWorkflow).toContain(
      "inputs.source_artifact_name || 'code-f-rotation-pixel-oracle-v2-windows-x86_64-96296dd13e0e2c2744c390ef13332b3df25ef9e6'",
    );
    expect(retentionWorkflow).toContain(
      "inputs.transport_sha256 || '18f85bef8235e0b0a65352dd7b70ea84e12ede2e749c53490e10e1d07a7c3df4'",
    );
    expect(retentionWorkflow).toContain(
      "inputs.release_tag || 'code-f-rotation-pixel-oracle-v2-96296dd1-34752887351'",
    );
    expect(retentionWorkflow).toContain('--draft');
    expect(retentionWorkflow).toContain(
      'Independently retrieve durable transport and verify digest',
    );
    expect(retentionWorkflow).toContain('code-f-rotation-pixel-oracle-v2-windows-x86_64.tar');
  });
});
