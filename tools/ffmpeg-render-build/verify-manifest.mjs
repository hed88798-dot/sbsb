import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function args(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--')) throw new Error(`invalid argument: ${key}`);
    if (value !== undefined && !value.startsWith('--')) {
      result[key.slice(2)] = value;
      index += 1;
    } else result[key.slice(2)] = true;
  }
  return result;
}
const options = args(process.argv);
for (const key of ['bundle', 'manifest', 'profile'])
  if (!options[key]) throw new Error(`missing --${key}`);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashWithout = (value, field) => {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256(Buffer.from(JSON.stringify(canonical(copy)), 'utf8'));
};

function fail(message) {
  throw new Error(`FFMPEG_RENDER_MANIFEST_INVALID: ${message}`);
}
function verify(bundlePath, manifest, profile) {
  if (manifest.schema_version !== '1' || manifest.subject_type !== 'FFMPEG_RENDER_RUNTIME_BUNDLE')
    fail('subject type mismatch');
  if (manifest.role !== 'PRODUCT_RUNTIME_DEPENDENCY') fail('role mismatch');
  if (manifest.manifest_sha256 !== hashWithout(manifest, 'manifest_sha256'))
    fail('manifest hash mismatch');
  const identity = structuredClone(manifest);
  delete identity.manifest_sha256;
  delete identity.runtime_identity_sha256;
  delete identity.license_evidence;
  if (
    manifest.runtime_identity_sha256 !==
    sha256(Buffer.from(JSON.stringify(canonical(identity)), 'utf8'))
  )
    fail('runtime identity mismatch');
  if (manifest.provenance.build_profile_sha256 !== profile.profile_sha256)
    fail('build profile binding mismatch');
  if (
    manifest.provenance.code_g_capability_profile_hash !==
    profile.code_g_capability_profile.profile_hash
  )
    fail('Code G capability profile hash mismatch');
  if (
    manifest.provenance.code_g_capability_profile_commit !==
    profile.code_g_capability_profile.commit
  )
    fail('Code G capability profile commit mismatch');
  if (
    manifest.runtime_dependency_closure.status !== 'PASS' ||
    manifest.runtime_dependency_closure.unresolved_count !== 0
  )
    fail('runtime closure is not PASS');
  if (
    manifest.distribution.system_path_fallback !== false ||
    manifest.distribution.resolver_mode !== 'EXPLICIT_BUNDLED_LOCATOR'
  )
    fail('system PATH fallback is not disabled');
  const actual = readdirSync(bundlePath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const declared = manifest.bundle_members.map((member) => member.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(declared))
    fail(`bundle member set mismatch: actual=${actual.join(',')} declared=${declared.join(',')}`);
  const members = new Map(manifest.bundle_members.map((member) => [member.path, member]));
  for (const member of manifest.bundle_members) {
    const actualHash = sha256(readFileSync(join(bundlePath, member.path)));
    if (actualHash !== member.sha256) fail(`member hash mismatch: ${member.path}`);
  }
  for (const entrypoint of manifest.entrypoints) {
    const member = members.get(entrypoint.path);
    if (!member || member.kind !== 'EXECUTABLE')
      fail(`entrypoint is not a declared executable: ${entrypoint.path}`);
    if (entrypoint.sha256 !== member.sha256)
      fail(`entrypoint/member hash mismatch: ${entrypoint.path}`);
  }
  if (manifest.bundle_members.some((member) => /(?:ffplay|libx264|libx265)/iu.test(member.path)))
    fail('forbidden runtime member selected');
  const internalPaths = new Set(
    manifest.runtime_dependency_closure.members.map((member) => member.member_path),
  );
  for (const member of manifest.bundle_members.filter((entry) => entry.kind === 'DYNAMIC_LIBRARY'))
    if (!internalPaths.has(member.path))
      fail(`dynamic member absent from runtime closure: ${member.path}`);
  return true;
}

const bundle = resolve(options.bundle);
const manifest = JSON.parse(readFileSync(resolve(options.manifest), 'utf8'));
const profile = JSON.parse(readFileSync(resolve(options.profile), 'utf8'));
verify(bundle, manifest, profile);
if (options['negative-controls']) {
  const expectFailure = (label, action) => {
    try {
      action();
      fail(`negative control unexpectedly passed: ${label}`);
    } catch (error) {
      if (String(error?.message).includes(`negative control unexpectedly passed: ${label}`))
        throw error;
    }
  };
  const wrongHash = structuredClone(manifest);
  wrongHash.entrypoints[0].sha256 = '0'.repeat(64);
  expectFailure('wrong binary hash', () => verify(bundle, wrongHash, profile));
  const wrongProfile = structuredClone(manifest);
  wrongProfile.provenance.build_profile_sha256 = '0'.repeat(64);
  expectFailure('wrong build profile hash', () => verify(bundle, wrongProfile, profile));
  const temporary = mkdtempSync(join(tmpdir(), 'ffmpeg-render-manifest-controls-'));
  cpSync(bundle, temporary, { recursive: true });
  const dll = readdirSync(temporary).find((name) => /\.dll$/iu.test(name));
  if (dll) {
    const bytes = readFileSync(join(temporary, dll));
    writeFileSync(join(temporary, dll), Buffer.concat([bytes, Buffer.from([0])]));
    expectFailure('modified DLL', () => verify(temporary, manifest, profile));
  }
  const member = readdirSync(temporary).find((name) => /\.exe$/iu.test(name));
  if (member) {
    rmSync(join(temporary, member));
    expectFailure('missing runtime member', () => verify(temporary, manifest, profile));
  }
  rmSync(temporary, { recursive: true, force: true });
  console.log('FFMPEG_RENDER_MANIFEST_NEGATIVE_CONTROLS: PASS');
}
console.log(
  JSON.stringify({
    status: 'PASS',
    runtime_id: manifest.runtime_id,
    manifest_sha256: manifest.manifest_sha256,
    runtime_identity_sha256: manifest.runtime_identity_sha256,
  }),
);
