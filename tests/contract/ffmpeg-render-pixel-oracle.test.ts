import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const profilePath = resolve(
  import.meta.dirname,
  '../../tools/ffmpeg-render-pixel-oracle/CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V1.json',
);
const builderPath = resolve(
  import.meta.dirname,
  '../../tools/ffmpeg-render-pixel-oracle/build-windows.sh',
);
const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
  profile_id: string;
  tool_role: string;
  product_runtime_identity_effect: string;
  package_inclusion: string;
  upstream_source: { release: string; commit: string; archive_sha256: string };
  configure_arguments: string[];
  capabilities: { required: string[]; forbidden: string[] };
  verification: { input: string; output: string; autorotation: string; network: string };
};
const builder = readFileSync(builderPath, 'utf8');

describe('Code F rotation pixel oracle isolation', () => {
  it('declares a separate test-only tool with no product packaging authority', () => {
    expect(profile.profile_id).toBe('code-f-rotation-pixel-oracle-build-profile-v1');
    expect(profile.tool_role).toBe('TEST_ONLY');
    expect(profile.product_runtime_identity_effect).toBe('NONE');
    expect(profile.package_inclusion).toBe('FORBIDDEN');
    expect(profile.upstream_source.release).toBe('9.0.1');
    expect(profile.upstream_source.commit).toBe('bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa');
    expect(profile.upstream_source.archive_sha256).toBe(
      'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
    );
  });

  it('enables only the decoding and RGB raw-pixel output surface', () => {
    for (const argument of [
      '--disable-everything',
      '--enable-ffmpeg',
      '--enable-demuxer=mov',
      '--enable-decoder=h264',
      '--enable-parser=h264',
      '--enable-filter=format',
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
    expect(profile.capabilities.forbidden).toEqual(
      expect.arrayContaining(['network_protocols', 'h264_mf_encoder', 'product_runtime_use']),
    );
    expect(profile.verification.input).toBe('already-produced normalized MP4 only');
    expect(profile.verification.output).toBe('first-frame RGB24 rawvideo file');
    expect(profile.verification.autorotation).toBe('DISABLED');
    expect(profile.verification.network).toBe('DISABLED');
  });

  it('pins source bytes and emits an explicit non-packaged tool identity', () => {
    expect(builder).toContain(
      "EXPECTED_SOURCE_SHA='cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635'",
    );
    expect(builder).toContain("EXPECTED_SOURCE_COMMIT='bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa'");
    expect(builder).toContain("tool_role: 'TEST_ONLY'");
    expect(builder).toContain("package_inclusion: 'FORBIDDEN'");
    expect(builder).toContain("product_runtime_identity_effect: 'NONE'");
    expect(builder).toContain("'rawvideo_encoder'");
    expect(builder).toContain("'rawvideo_muxer'");
    expect(builder).not.toContain('h264_mf');
    expect(builder).not.toContain('aac');
  });
});
