import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const profileRelative =
  'compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_BUILD_PROFILE_V1.json';
const profilePath = resolve(repositoryRoot, profileRelative);
const codeGRelative = 'docs/render/ffmpeg-required-capability-profile.v1.json';
const codeGPath = resolve(repositoryRoot, codeGRelative);
const codeGCommit = '9cc2326bf5059290f1a8498d0683e7e7d6f3bf9d';
const SHA256 = /^[0-9a-f]{64}$/u;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalJson = (value) =>
  Array.isArray(value)
    ? value.map(canonicalJson)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonicalJson(value[key])]),
        )
      : value;
const canonicalHashWithout = (value, field) => {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256(Buffer.from(JSON.stringify(canonicalJson(copy)), 'utf8'));
};

function fail(message) {
  throw new Error(`FFMPEG_RENDER_BUILD_PROFILE_INVALID: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding });
}

function verifyProfile(profile, codeGProfile) {
  assert(profile && typeof profile === 'object', 'profile must be an object');
  assert(profile.schema_version === '1', 'schema_version must be 1');
  assert(profile.profile_kind === 'FFMPEG_RENDER_BUILD_PROFILE', 'profile_kind mismatch');
  assert(profile.profile_version === 1, 'profile_version must be 1');
  assert(SHA256.test(profile.profile_sha256), 'profile_sha256 must be lowercase SHA-256');
  assert(
    canonicalHashWithout(profile, 'profile_sha256') === profile.profile_sha256,
    'profile self hash mismatch',
  );

  const binding = profile.code_g_capability_profile;
  assert(binding.path === codeGRelative, 'Code G profile path mismatch');
  assert(binding.commit === codeGCommit, 'Code G profile commit mismatch');
  assert(binding.profile_id === codeGProfile.profile_id, 'Code G profile ID mismatch');
  assert(
    binding.profile_version === codeGProfile.profile_version,
    'Code G profile version mismatch',
  );
  assert(binding.profile_hash === codeGProfile.profile_hash, 'Code G profile hash mismatch');
  assert(
    canonicalHashWithout(codeGProfile, 'profile_hash') === codeGProfile.profile_hash,
    'Code G profile self hash mismatch',
  );
  assert(
    codeGProfile.stability?.status === 'FROZEN_FOR_CODE_F_INTAKE',
    'Code G profile is not frozen for Code F intake',
  );

  const upstream = profile.upstream_source;
  assert(upstream.project === 'FFmpeg/FFmpeg', 'upstream project mismatch');
  assert(upstream.release === '9.0.1', 'upstream release mismatch');
  assert(upstream.tag === 'n9.0.1', 'upstream tag mismatch');
  assert(
    upstream.commit === 'bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa',
    'upstream commit mismatch',
  );
  assert(
    upstream.archive_sha256 === 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
    'upstream source archive hash mismatch',
  );

  const args = [
    ...profile.common_configure_arguments,
    ...Object.values(profile.platform_builds).flatMap((build) => build.configure_arguments),
  ];
  const has = (value) => args.includes(value);
  for (const required of [
    '--disable-everything',
    '--enable-ffmpeg',
    '--enable-ffprobe',
    '--disable-ffplay',
    '--enable-demuxers',
    '--enable-parsers',
    '--enable-decoders',
    '--enable-encoder=aac',
    '--enable-muxer=mov',
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
  for (const forbidden of [
    '--enable-network',
    '--enable-protocol=http',
    '--enable-protocol=https',
    '--enable-protocol=ftp',
    '--enable-protocol=rtmp',
    '--enable-protocol=rtsp',
    '--enable-gpl',
    '--enable-nonfree',
    '--enable-libx264',
    '--enable-libx265',
    '--enable-ffplay',
  ])
    assert(!has(forbidden), `forbidden configure argument present: ${forbidden}`);

  const commonFilters = new Set([
    'concat',
    'crop',
    'format',
    'fps',
    'pad',
    'scale',
    'setsar',
    'setpts',
    'trim',
    'aformat',
    'aresample',
    'asetpts',
  ]);
  assert(
    JSON.stringify([...commonFilters].sort()) ===
      JSON.stringify(
        [
          ...profile.required_components.video_filters,
          ...profile.required_components.audio_filters,
        ].sort(),
      ),
    'required filter inventory drift',
  );
  assert(
    codeGProfile.required_capabilities.video_filters.every((filter) => commonFilters.has(filter)),
    'Code G video filter not covered',
  );
  assert(
    codeGProfile.required_capabilities.audio_filters.every((filter) => commonFilters.has(filter)),
    'Code G audio filter not covered',
  );
  assert(
    codeGProfile.required_capabilities.protocols.declared.every((protocol) =>
      ['file', 'pipe'].includes(protocol),
    ),
    'Code G protocol outside approved local set',
  );
  assert(
    profile.platform_builds['windows-x86_64'].configure_arguments.includes(
      '--enable-mediafoundation',
    ),
    'Windows Media Foundation is not explicitly enabled',
  );
  assert(
    profile.platform_builds['windows-x86_64'].configure_arguments.includes(
      '--enable-encoder=h264_mf',
    ),
    'Windows h264_mf is not explicitly enabled',
  );
  assert(
    profile.platform_builds['macos-arm64'].configure_arguments.includes('--enable-videotoolbox'),
    'macOS VideoToolbox is not explicitly enabled',
  );
  assert(
    profile.platform_builds['macos-arm64'].configure_arguments.includes(
      '--enable-encoder=h264_videotoolbox',
    ),
    'macOS h264_videotoolbox is not explicitly enabled',
  );
  assert(
    profile.build_policy.system_path_runtime_allowed === false,
    'system PATH runtime fallback is forbidden',
  );
  assert(
    profile.verification_policy.wrong_profile_hash_rejected === true,
    'wrong profile hash negative control is required',
  );
  assert(
    profile.verification_policy.modified_member_rejected === true,
    'modified member negative control is required',
  );
  assert(
    profile.verification_policy.path_and_cwd_decoys_must_not_be_consumed === true,
    'path/CWD decoy negative control is required',
  );
  return {
    profile_sha256: profile.profile_sha256,
    code_g_profile_commit: binding.commit,
    code_g_profile_hash: binding.profile_hash,
  };
}

const profile = readJson(profilePath);
const codeGProfile = readJson(codeGPath);
const gitProfileBytes = git(['show', `${codeGCommit}:${codeGRelative}`], 'buffer');
assert(
  sha256(gitProfileBytes) === sha256(readFileSync(codeGPath)),
  'working Code G profile bytes differ from committed profile bytes',
);
try {
  git(['merge-base', '--is-ancestor', codeGCommit, 'HEAD']);
} catch {
  fail(`Code G profile commit ${codeGCommit} is not an ancestor of HEAD`);
}

const result = verifyProfile(profile, codeGProfile);
console.log(JSON.stringify({ status: 'PASS', ...result }));
