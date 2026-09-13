import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const profileRelative =
  'compliance/runtime-dependency-intake/ffmpeg-render-v2/FFMPEG_RENDER_BUILD_PROFILE_V2.json';
const profilePath = resolve(repositoryRoot, profileRelative);
const codeGRelative = 'docs/render/ffmpeg-required-capability-profile.v2.json';
const codeGPath = resolve(repositoryRoot, codeGRelative);
const v1Relative = 'docs/render/ffmpeg-required-capability-profile.v1.json';
const v1Path = resolve(repositoryRoot, v1Relative);
const codeGCommit = 'ebe411df646504d43162af3c8a588f42e633bd39';
const codeGProfileHash = '2c19710e609b1ae769e7f007cffca1e552ce1158963bec2aa8a8bcad59a01c1b';
const codeGProfileFileHash = 'f5de57358ab07589fbbf96e8184e2fa2b4b3eb9cb072ede22fbc4edde7ddcfb5';
const buildProfileHash = '40ebffb4307b1c2ec141ffbdd3be2e2c52545090ea1f776267fa445952b3657c';
const buildProfileFileHash = '48e6ef8716ac3f4b4a20ff4fbf7e9dc96456a512aa501859835aa3b195b0ba34';
const v1ProfileFileHash = '4352c73c432a0bbf37a4937267b7785d1fac9c8fe55fab99fb6e7a09ccb9e8c6';
const v1ProfileHash = 'e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
const semanticHash = (value, field) => {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256(Buffer.from(JSON.stringify(canonical(copy)), 'utf8'));
};

function fail(message) {
  throw new Error(`FFMPEG_RENDER_BUILD_PROFILE_V2_INVALID: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function git(args, encoding = 'utf8') {
  return execFileSync(process.env.GIT_PATH || 'git', args, {
    cwd: repositoryRoot,
    encoding,
  });
}

assert(existsSync(profilePath), `missing ${profileRelative}`);
assert(existsSync(codeGPath), `missing ${codeGRelative}`);
assert(existsSync(v1Path), `missing ${v1Relative}`);

const profile = readJson(profilePath);
const codeGProfile = readJson(codeGPath);
const v1Profile = readJson(v1Path);

assert(profile.schema_version === '1', 'schema_version must remain 1');
assert(profile.profile_kind === 'FFMPEG_RENDER_BUILD_PROFILE', 'profile_kind mismatch');
assert(profile.profile_id === 'code-f-ffmpeg-render-build-profile-v2', 'profile id mismatch');
assert(profile.profile_version === 2, 'profile version mismatch');
assert(profile.profile_sha256 === buildProfileHash, 'approved V2 semantic hash mismatch');
assert(semanticHash(profile, 'profile_sha256') === buildProfileHash, 'V2 self hash mismatch');
assert(sha256(readFileSync(profilePath)) === buildProfileFileHash, 'V2 file hash mismatch');
assert(sha256(readFileSync(v1Path)) === v1ProfileFileHash, 'V1 capability bytes changed');
assert(semanticHash(v1Profile, 'profile_hash') === v1ProfileHash, 'V1 semantic hash changed');
assert(v1Profile.profile_hash === v1ProfileHash, 'V1 approved hash changed');

try {
  git(['cat-file', '-e', `${codeGCommit}^{commit}`]);
} catch {
  fail(`Code G authoritative commit ${codeGCommit} is unavailable`);
}
try {
  git(['merge-base', '--is-ancestor', codeGCommit, 'HEAD']);
} catch {
  fail(`Code G authoritative commit ${codeGCommit} is not an ancestor of HEAD`);
}
const committedCodeGBytes = git(['show', `${codeGCommit}:${codeGRelative}`], 'buffer');
assert(
  sha256(committedCodeGBytes) === sha256(readFileSync(codeGPath)),
  'working Code G V2 bytes differ from the authoritative commit',
);
assert(
  sha256(committedCodeGBytes) === codeGProfileFileHash,
  'Code G V2 committed blob differs from approved exact bytes',
);
assert(codeGProfile.profile_hash === codeGProfileHash, 'Code G V2 semantic hash mismatch');
assert(
  semanticHash(codeGProfile, 'profile_hash') === codeGProfileHash,
  'Code G V2 self hash mismatch',
);
assert(codeGProfile.profile_version === 2, 'Code G V2 profile version mismatch');

const binding = profile.code_g_capability_profile;
assert(binding.path === codeGRelative, 'Code G V2 path mismatch');
assert(binding.commit === codeGCommit, 'Code G V2 commit mismatch');
assert(binding.profile_hash === codeGProfileHash, 'Code G V2 hash binding mismatch');
assert(binding.profile_version === 2, 'Code G V2 version binding mismatch');

const configureArguments = [
  ...profile.common_configure_arguments,
  ...Object.values(profile.platform_builds).flatMap((build) => build.configure_arguments),
];
const has = (value) => configureArguments.includes(value);
for (const required of [
  '--disable-everything',
  '--enable-ffmpeg',
  '--enable-ffprobe',
  '--disable-ffplay',
  '--enable-demuxers',
  '--enable-parsers',
  '--enable-decoders',
  '--enable-encoder=aac',
  '--enable-encoder=h264_mf',
  '--enable-muxer=mov',
  '--enable-muxer=mp4',
  '--enable-protocol=file',
  '--enable-protocol=pipe',
  '--disable-network',
  '--disable-autodetect',
  '--disable-devices',
  '--disable-indevs',
  '--disable-outdevs',
  '--disable-gpl',
  '--disable-nonfree',
  '--enable-shared',
  '--disable-static',
])
  assert(has(required), `required configure argument missing: ${required}`);
for (const filter of [
  'concat',
  'crop',
  'format',
  'fps',
  'hflip',
  'pad',
  'rotate',
  'scale',
  'setsar',
  'setpts',
  'transpose',
  'trim',
  'vflip',
  'aformat',
  'aresample',
  'asetpts',
])
  assert(has(`--enable-filter=${filter}`), `required V2 filter missing: ${filter}`);
for (const forbidden of [
  '--enable-network',
  '--enable-gpl',
  '--enable-nonfree',
  '--enable-libx264',
  '--enable-libx265',
  '--enable-ffplay',
])
  assert(!has(forbidden), `forbidden configure argument present: ${forbidden}`);

const declaredFilters = new Set(profile.required_components.video_filters);
for (const filter of ['transpose', 'hflip', 'vflip', 'rotate'])
  assert(declaredFilters.has(filter), `V2 required component missing: ${filter}`);
assert(
  profile.verification_policy.required_rotation_filters.join(',') ===
    'transpose,hflip,vflip,rotate',
  'rotation filter policy drift',
);
assert(
  profile.verification_policy.rotation_application_count === 'EXACTLY_ONCE',
  'rotation count policy drift',
);
assert(
  profile.verification_policy.output_nonidentity_display_matrix === 'FORBIDDEN',
  'display matrix policy drift',
);
assert(
  profile.verification_policy.dynamic_product_rotation_gate === 'CODE_G_R1B_PRODUCT_PATH_REQUIRED',
  'dynamic gate owner drift',
);
assert(
  profile.artifact_status.windows === 'NOT_YET_PRODUCED',
  'V2 artifact status must remain pending',
);
assert(
  profile.version_history.runtime_v1_status === 'HISTORICALLY_APPROVED',
  'V1 approval history missing',
);
assert(profile.version_history.runtime_v1_mutated === false, 'V1 mutation marker is not false');

const candidateIndex = process.argv.indexOf('--candidate-dir');
const candidateDir = process.argv.find((argument) => argument.startsWith('--candidate-dir='));
const candidatePath = candidateDir
  ? candidateDir.slice('--candidate-dir='.length)
  : candidateIndex >= 0
    ? process.argv[candidateIndex + 1]
    : undefined;
const candidateStatus = candidatePath
  ? 'CANDIDATE_INSPECTION_REQUESTED'
  : 'PENDING_CANDIDATE_ARTIFACT';
if (candidatePath) assert(existsSync(candidatePath), 'candidate directory is unavailable');

console.log(
  JSON.stringify({
    status: 'PASS',
    profile_sha256: profile.profile_sha256,
    profile_file_sha256: buildProfileFileHash,
    code_g_profile_commit: binding.commit,
    code_g_profile_hash: binding.profile_hash,
    code_g_profile_file_sha256: codeGProfileFileHash,
    runtime_v1_status: profile.version_history.runtime_v1_status,
    runtime_v1_mutated: profile.version_history.runtime_v1_mutated,
    required_rotation_filters: ['transpose', 'hflip', 'vflip', 'rotate'],
    static_candidate_inspection: candidateStatus,
    dynamic_rotation_product_gate: 'CODE_G_R1B_PRODUCT_PATH_REQUIRED',
  }),
);
