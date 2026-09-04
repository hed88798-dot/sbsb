import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../tools/native-runtime-companion/companion.mjs';
import { verifyLoaderPolicy } from '../../tools/native-runtime-companion/loader-policy.mjs';

type JsonObject = Record<string, unknown>;

const root = resolve(import.meta.dirname, '../..');
const policyPath = resolve(
  root,
  'compliance/runtime-dependency-intake/native-runtime-companion-v1/RUNTIME_LOADER_POLICY_RECORD_V1.json',
);

function fixture(): JsonObject {
  return JSON.parse(readFileSync(policyPath, 'utf8')) as JsonObject;
}

function refreshSelf(record: JsonObject) {
  const copy = structuredClone(record);
  delete copy.record_sha256;
  record.record_sha256 = createHash('sha256')
    .update(JSON.stringify(canonicalJson(copy)))
    .digest('hex');
}

describe('native runtime companion loader policy', () => {
  it('accepts the exact immutable loader policy authority', () => {
    expect(verifyLoaderPolicy(undefined, { verifyAuthoritySidecars: true }).status).toBe('PASS');
  });

  it('fails closed when the semantic record hash is stale', () => {
    const record = fixture();
    (record.linux_policy as JsonObject).entrypoint_dt_runpath = '/tmp/ffmpeg';
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /runtime loader policy schema invalid|semantic self hash mismatch/u,
    );
  });

  it('fails closed when Linux transitive RUNPATH closure is disabled', () => {
    const record = fixture();
    (record.linux_policy as JsonObject).transitive_runpath_closure_required = false;
    refreshSelf(record);
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /runtime loader policy schema invalid|transitive RUNPATH closure is not required/u,
    );
  });

  it('fails closed when an absolute Linux search path is allowed', () => {
    const record = fixture();
    (record.linux_policy as JsonObject).absolute_runpath_allowed = true;
    refreshSelf(record);
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /runtime loader policy schema invalid|absolute or DT_RPATH search paths are allowed/u,
    );
  });

  it('fails closed when Windows decoy DLLs may be consumed', () => {
    const record = fixture();
    (record.negative_resolution_tests as JsonObject).windows_decoy_path_library_consumed = true;
    refreshSelf(record);
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /runtime loader policy schema invalid|decoy DLL is allowed to be consumed/u,
    );
  });

  it('fails closed when an undeclared external OS prerequisite is permitted', () => {
    const record = fixture();
    (record.external_os_prerequisite_policy as JsonObject).allowlist_enforced = false;
    refreshSelf(record);
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /runtime loader policy schema invalid|external OS prerequisite allowlist is not fail-closed/u,
    );
  });

  it('fails closed when a required recheck trigger is removed', () => {
    const record = fixture();
    record.recheck_triggers = (record.recheck_triggers as string[]).filter(
      (trigger) => trigger !== 'system PATH authority changes',
    );
    refreshSelf(record);
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /recheck trigger list missing: system PATH authority changes/u,
    );
  });

  it('does not allow this policy to approve an exact artifact', () => {
    const record = fixture();
    (record.downstream_status as JsonObject).linux_exact_artifact = 'PRODUCED';
    refreshSelf(record);
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /runtime loader policy schema invalid|must not claim exact ffprobe artifacts/u,
    );
  });

  it('keeps the FFprobe Build Profile binding immutable', () => {
    const record = fixture();
    (record.ffprobe_build_profile_binding as JsonObject).record_sha256 = 'f'.repeat(64);
    refreshSelf(record);
    expect(() => verifyLoaderPolicy(record, { verifySidecar: false })).toThrow(
      /FFprobe Build Profile record SHA mismatch/u,
    );
  });
});
