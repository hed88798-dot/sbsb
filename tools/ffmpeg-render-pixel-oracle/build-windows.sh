#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
RUNNER_TEMP="${RUNNER_TEMP:?RUNNER_TEMP is required}"
OUT="${PIXEL_ORACLE_OUT:-$ROOT/artifacts/ffmpeg-pixel-oracle/windows}"
PROFILE="$ROOT/tools/ffmpeg-render-pixel-oracle/CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V1.json"
SOURCE_TARBALL="$RUNNER_TEMP/ffmpeg-9.0.1.tar.xz"
SOURCE_DIR="$RUNNER_TEMP/ffmpeg-9.0.1-pixel-oracle-build"
EXPECTED_SOURCE_SHA='cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635'
EXPECTED_SOURCE_COMMIT='bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa'
MAKE_COMMAND="${MAKE_COMMAND:-mingw32-make}"

test "${MSYSTEM:-}" = UCRT64
test "$(uname -m)" = x86_64
command -v node >/dev/null
command -v curl >/dev/null
command -v tar >/dev/null
command -v sha256sum >/dev/null
command -v "$MAKE_COMMAND" >/dev/null
command -v gcc >/dev/null
test -f "$PROFILE"

rm -rf "$OUT" "$SOURCE_DIR"
mkdir -p "$OUT/bundle" "$OUT/evidence"
PROFILE_SHA256="$(sha256sum "$PROFILE" | awk '{print $1}')"
curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
  'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz' -o "$SOURCE_TARBALL"
ACTUAL_SOURCE_SHA="$(sha256sum "$SOURCE_TARBALL" | awk '{print $1}')"
test "$ACTUAL_SOURCE_SHA" = "$EXPECTED_SOURCE_SHA"
printf '%s  %s\n' "$ACTUAL_SOURCE_SHA" 'ffmpeg-9.0.1.tar.xz' > "$OUT/evidence/source-archive.sha256"
mkdir -p "$SOURCE_DIR"
tar -xJf "$SOURCE_TARBALL" --strip-components=1 -C "$SOURCE_DIR"

mapfile -t CONFIGURE_ARGS < <(node "$ROOT/tools/ffmpeg-render-pixel-oracle/resolve-profile.mjs")
CONFIGURE_JSON="$(node "$ROOT/tools/ffmpeg-render-pixel-oracle/resolve-profile.mjs" --json)"
GCC_VERSION="$(gcc --version | head -1)"
MAKE_VERSION="$("$MAKE_COMMAND" --version | head -1)"
TOOLCHAIN="${GCC_VERSION}; ${MAKE_VERSION}; MSYS2_UCRT64"

cd "$SOURCE_DIR"
./configure "${CONFIGURE_ARGS[@]}" 2>&1 | tee "$OUT/evidence/configure.log"
"$MAKE_COMMAND" -j"$(nproc)" 2>&1 | tee "$OUT/evidence/build.log"
"$MAKE_COMMAND" install 2>&1 | tee -a "$OUT/evidence/build.log"
test -f "$SOURCE_DIR/install/bin/ffmpeg.exe"
cp -a "$SOURCE_DIR/install/bin/ffmpeg.exe" "$OUT/bundle/ffmpeg.exe"

FFMPEG_SHA256="$(sha256sum "$OUT/bundle/ffmpeg.exe" | awk '{print $1}')"
BUILD_RECIPE_SHA256="$(printf '%s\n' "$CONFIGURE_JSON" "$TOOLCHAIN" | sha256sum | awk '{print $1}')"
TOOL_ID="code-f-rotation-pixel-oracle-windows-x86_64-${GITHUB_RUN_ID:-local}"
node - "$OUT/pixel-oracle-manifest.json" "$OUT/bundle/ffmpeg.exe" "$PROFILE_SHA256" "$BUILD_RECIPE_SHA256" "$TOOL_ID" "$FFMPEG_SHA256" "$TOOLCHAIN" "$EXPECTED_SOURCE_SHA" "$EXPECTED_SOURCE_COMMIT" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const [output, ffmpeg, profileSha, recipeSha, toolId, ffmpegSha, toolchain, sourceSha, sourceCommit] = process.argv.slice(2);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const value = {
  schema_version: '1',
  record_kind: 'CODE_F_ROTATION_PIXEL_ORACLE',
  tool_id: toolId,
  tool_role: 'TEST_ONLY',
  product_runtime_identity_effect: 'NONE',
  package_inclusion: 'FORBIDDEN',
  source: {
    project: 'FFmpeg/FFmpeg',
    release: '9.0.1',
    tag: 'n9.0.1',
    commit: sourceCommit,
    archive_sha256: sourceSha,
  },
  build_profile: {
    path: 'tools/ffmpeg-render-pixel-oracle/CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V1.json',
    sha256: profileSha,
  },
  build_recipe_sha256: recipeSha,
  toolchain,
  entrypoint: 'bundle/ffmpeg.exe',
  ffmpeg_sha256: ffmpegSha,
  capabilities: {
    input: ['mov_demuxer', 'h264_decoder', 'h264_parser', 'file_protocol'],
    output: ['format_filter', 'rgb24_pixel_conversion', 'rawvideo_encoder', 'rawvideo_muxer'],
    network: 'DISABLED',
  },
  invocation_contract: {
    accepted_input: 'already-produced normalized MP4 only',
    autorotation: 'DISABLED',
    first_frame_only: true,
  },
  members: [{ path: 'bundle/ffmpeg.exe', sha256: ffmpegSha }],
};
writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
writeFileSync(`${output}.sha256`, `${hash(readFileSync(output))}  ${output.split('/').pop()}\n`);
writeFileSync(`${output.replace(/pixel-oracle-manifest\.json$/u, '')}tool-identity.json`, `${JSON.stringify({ tool_id: toolId, ffmpeg_sha256: ffmpegSha, manifest_sha256: hash(readFileSync(output)), role: 'TEST_ONLY', package_inclusion: 'FORBIDDEN' }, null, 2)}\n`);
NODE
sha256sum "$OUT/bundle/ffmpeg.exe" > "$OUT/evidence/entrypoint.sha256"
printf 'product_runtime_dependency=NONE\npackage_inclusion=FORBIDDEN\nnetwork=DISABLED\n' > "$OUT/evidence/build-policy.txt"
echo 'CODE_F_ROTATION_PIXEL_ORACLE_BUILD: PASS'
