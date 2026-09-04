import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyFfprobePin } from '../../tools/ffprobe-build-profile/verify.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidenceRoot = resolve(root, 'compliance/runtime-dependency-intake/ffprobe-v2');
type JsonObject = Record<string, unknown>;
type AuthorityFixture = {
  capability: JsonObject;
  security: JsonObject;
  profile: JsonObject;
  pin: JsonObject;
};

function read(name: string) {
  return JSON.parse(readFileSync(resolve(evidenceRoot, name), 'utf8')) as JsonObject;
}

function fixture(): AuthorityFixture {
  return {
    capability: read('REQUIRED_MEDIA_CAPABILITY_SET_V1.json'),
    security: read('FFMPEG_RELEASE_SECURITY_INTAKE_V1.json'),
    profile: read('FFPROBE_BUILD_PROFILE_V1.json'),
    pin: read('FFPROBE_SOURCE_AND_BUILD_PROFILE_PIN_RECORD_V1.json'),
  };
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

function refreshSelf(value: JsonObject, field: string) {
  const copy = structuredClone(value);
  delete copy[field];
  value[field] = createHash('sha256')
    .update(JSON.stringify(canonical(copy)))
    .digest('hex');
}

describe('FFprobe source release and semantic build profile', () => {
  it('accepts the exact source/build-intent authority without approving binaries', () => {
    expect(verifyFfprobePin(fixture()).status).toBe('PASS');
  });

  it('fails closed when the source archive identity changes', () => {
    const value = fixture();
    (value.pin.source_archive as JsonObject).sha256 = 'f'.repeat(64);
    refreshSelf(value.pin, 'record_sha256');
    expect(() => verifyFfprobePin(value)).toThrow(/source archive SHA mismatch/u);
  });

  it('fails closed when a network protocol is added', () => {
    const value = fixture();
    (value.profile.protocol_policy as JsonObject).network_protocol_allowlist = ['https'];
    refreshSelf(value.profile, 'profile_sha256');
    (value.pin.build_profile_binding as JsonObject).profile_sha256 = value.profile.profile_sha256;
    refreshSelf(value.pin, 'record_sha256');
    expect(() => verifyFfprobePin(value)).toThrow(/network protocol allowlist must be empty/u);
  });

  it('fails closed when a required media capability is removed', () => {
    const value = fixture();
    const provided = value.profile.provided_capabilities as JsonObject;
    provided.probe_fields = (provided.probe_fields as string[]).filter(
      (field: string) => field !== 'rotation',
    );
    refreshSelf(value.profile, 'profile_sha256');
    (value.pin.build_profile_binding as JsonObject).profile_sha256 = value.profile.profile_sha256;
    refreshSelf(value.pin, 'record_sha256');
    expect(() => verifyFfprobePin(value)).toThrow(
      /probe fields missing required capabilities: rotation/u,
    );
  });

  it('binds the empty external-library set by hash', () => {
    const value = fixture();
    const hash = createHash('sha256').update('[]').digest('hex');
    expect(
      (value.profile.external_library_policy as JsonObject).declared_external_library_set_sha256,
    ).toBe(hash);
  });

  it('keeps exact Linux and Windows artifacts unproduced', () => {
    const value = fixture();
    expect(value.profile.artifact_status).toMatchObject({
      linux_exact_ffprobe_artifact: 'NOT_YET_PRODUCED',
      windows_exact_ffprobe_artifact: 'NOT_YET_PRODUCED',
      artifact_approval: 'NOT_PERFORMED',
    });
  });
});
