import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(
  import.meta.dirname,
  '../../.github/workflows/code-f-ffmpeg-render-runtime-v2.yml',
);
const harnessPath = resolve(
  import.meta.dirname,
  '../../tools/ffmpeg-render-build/verify-rotation-v2.ps1',
);
const workflow = readFileSync(workflowPath, 'utf8');
const harness = readFileSync(harnessPath, 'utf8');

describe('Code F FFmpeg Render Runtime v2 pre-Windows freeze', () => {
  it('runs candidate builds only for build-input changes or explicit dispatch', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("'.github/workflows/code-f-ffmpeg-render-runtime-v2.yml'");
    expect(workflow).toContain("'tools/ffmpeg-render-build/**'");
    expect(workflow).toContain("'!tools/ffmpeg-render-build/verify-rotation-v2.ps1'");
    expect(workflow).toContain("'!tools/ffmpeg-render-build/rotation-angle.mjs'");
    expect(workflow).toContain("'tools/ffmpeg-render-build-profile/**'");
    expect(workflow).toContain("'pnpm-lock.yaml'");
    expect(workflow).not.toContain('  pull_request:');
    expect(workflow).not.toContain('CODE_F_FFMPEG_RENDER_RUNTIME_V2_INTAKE_REPORT.md');
  });

  it('requires a Windows 11 Desktop and exact candidate identity', () => {
    for (const marker of [
      'Win32_OperatingSystem',
      'ProductType',
      'Windows 11',
      'ExpectedRuntimeId',
      'ExpectedManifestSha256',
      'ExpectedRuntimeIdentitySha256',
      'ExpectedFfmpegSha256',
      'ExpectedFfprobeSha256',
      'ExpectedCodeGProfileHash',
      'ExpectedBuildProfileHash',
      'runtime_dependency_closure',
      'verify-manifest.mjs',
    ])
      expect(harness).toContain(marker);
  });

  it('executes the three metadata rotations with pixel and matrix oracles', () => {
    for (const marker of [
      'asymmetric.rgb24',
      'rotate=$angle',
      "'-noautorotate'",
      "90 = 'transpose=1'",
      "180 = 'hflip,vflip'",
      "270 = 'transpose=2'",
      'side_data_list',
      'output_nonidentity_display_matrix',
      'rotation_applied_exactly_once',
      'nb_read_frames',
      'sample_aspect_ratio',
      'visible_orientation',
      'Normalize-DisplayAngle',
      'Test-AngleEquivalent',
      'Get-DisplayAngleFamily',
      'Test-DisplayAngleLogicVectors',
      'expectedMetadataAngles',
      'fixtureDirections[90] -ne $fixtureDirections[270]',
    ])
      expect(harness).toContain(marker);
  });
});
