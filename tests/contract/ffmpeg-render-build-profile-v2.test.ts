import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../packages/domain-media-index/src/signature.js';

const v1Path = resolve(
  import.meta.dirname,
  '../../compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_BUILD_PROFILE_V1.json',
);
const v2Path = resolve(
  import.meta.dirname,
  '../../compliance/runtime-dependency-intake/ffmpeg-render-v2/FFMPEG_RENDER_BUILD_PROFILE_V2.json',
);

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const semanticHash = (value: Record<string, unknown>, field: string) => {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256(canonicalJson(copy));
};

describe('Code F FFmpeg Render Build Profile v2', () => {
  it('keeps the approved v1 profile bytes and hash immutable', () => {
    const bytes = readFileSync(v1Path);
    const profile = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    expect(sha256(bytes)).toBe('3e9b2f54c9eb5ead1c75cd2ca9f25e3613e4afb9fb38561b60741118342055e4');
    expect(profile.profile_sha256).toBe(
      '8a8c032009beb90f57ba6a48f6bdb8d01ddf67b2c372c16795e1729c016e57ff',
    );
  });

  it('binds a distinct v2 profile to the exact Code G v2 checkpoint', () => {
    const profile = JSON.parse(readFileSync(v2Path, 'utf8')) as Record<string, unknown>;
    expect(profile.profile_id).toBe('code-f-ffmpeg-render-build-profile-v2');
    expect(profile.profile_version).toBe(2);
    expect(profile.profile_sha256).toBe(
      '40ebffb4307b1c2ec141ffbdd3be2e2c52545090ea1f776267fa445952b3657c',
    );
    expect(semanticHash(profile, 'profile_sha256')).toBe(profile.profile_sha256);
    expect(profile.code_g_capability_profile).toEqual({
      path: 'docs/render/ffmpeg-required-capability-profile.v2.json',
      commit: 'ebe411df646504d43162af3c8a588f42e633bd39',
      profile_id: 'code-g-r1-ffmpeg-required-capabilities',
      profile_version: 2,
      profile_hash: '2c19710e609b1ae769e7f007cffca1e552ce1158963bec2aa8a8bcad59a01c1b',
    });
  });

  it('adds only the rotation filters while retaining the security boundary', () => {
    const v1 = JSON.parse(readFileSync(v1Path, 'utf8')) as Record<string, unknown>;
    const v2 = JSON.parse(readFileSync(v2Path, 'utf8')) as Record<string, unknown>;
    const v1Components = v1.required_components as Record<string, unknown>;
    const v2Components = v2.required_components as Record<string, unknown>;
    const v1Filters = new Set(v1Components.video_filters as string[]);
    const v2Filters = new Set(v2Components.video_filters as string[]);
    expect([...v1Filters].every((filter) => v2Filters.has(filter))).toBe(true);
    expect([...v2Filters].filter((filter) => !v1Filters.has(filter)).sort()).toEqual([
      'hflip',
      'rotate',
      'transpose',
      'vflip',
    ]);
    const argumentsList = [
      ...(v2.common_configure_arguments as string[]),
      ...((v2.platform_builds as Record<string, Record<string, unknown>>)['windows-x86_64']
        .configure_arguments as string[]),
    ];
    for (const filter of ['hflip', 'rotate', 'transpose', 'vflip'])
      expect(argumentsList).toContain(`--enable-filter=${filter}`);
    for (const forbidden of [
      '--enable-network',
      '--enable-gpl',
      '--enable-nonfree',
      '--enable-libx264',
      '--enable-libx265',
    ])
      expect(argumentsList).not.toContain(forbidden);
  });

  it('keeps dynamic rotation as a Windows 11/Desktop product gate', () => {
    const profile = JSON.parse(readFileSync(v2Path, 'utf8')) as Record<string, unknown>;
    expect(profile.verification_policy).toMatchObject({
      rotation_application_count: 'EXACTLY_ONCE',
      output_nonidentity_display_matrix: 'FORBIDDEN',
      dynamic_product_rotation_gate: 'CODE_G_R1B_PRODUCT_PATH_REQUIRED',
      server_dynamic_h264_gate: 'NOT_PRODUCT_APPROVAL',
    });
    expect(profile.artifact_status.windows).toBe('NOT_YET_PRODUCED');
    expect(profile.version_history.runtime_v1_status).toBe('HISTORICALLY_APPROVED');
    expect(profile.version_history.runtime_v1_mutated).toBe(false);
  });
});
