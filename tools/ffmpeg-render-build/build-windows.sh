#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
RUNNER_TEMP="${RUNNER_TEMP:?RUNNER_TEMP is required}"
PROFILE="$ROOT/${FFMPEG_RENDER_PROFILE_RELATIVE:-compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_BUILD_PROFILE_V1.json}"
OUT="$ROOT/${FFMPEG_RENDER_OUT_RELATIVE:-artifacts/ffmpeg-render/windows}"
SOURCE_TARBALL="$RUNNER_TEMP/ffmpeg-9.0.1.tar.xz"
SOURCE_DIR="$RUNNER_TEMP/ffmpeg-9.0.1-render-build"
EXPECTED_SOURCE_SHA='cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635'
MAKE_COMMAND="${MAKE_COMMAND:-mingw32-make}"

test "${MSYSTEM:-}" = UCRT64
test "$(uname -m)" = x86_64
command -v node >/dev/null
command -v curl >/dev/null
command -v tar >/dev/null
command -v sha256sum >/dev/null
command -v cmp >/dev/null
command -v "$MAKE_COMMAND" >/dev/null
command -v gcc >/dev/null
command -v objdump >/dev/null
test -f "$PROFILE"

PREFLIGHT_SOURCE_OUT="$ROOT/${FFMPEG_RENDER_PREFLIGHT_OUT_RELATIVE:-artifacts/ffmpeg-render/windows}"
PREFLIGHT_EVIDENCE="$RUNNER_TEMP/ffmpeg-render-preflight-evidence"
rm -rf "$PREFLIGHT_EVIDENCE"
if [ -d "$PREFLIGHT_SOURCE_OUT/evidence" ]; then cp -a "$PREFLIGHT_SOURCE_OUT/evidence" "$PREFLIGHT_EVIDENCE"; fi
rm -rf "$OUT" "$SOURCE_DIR"
mkdir -p "$OUT/records" "$OUT/bundle" "$OUT/evidence" "$OUT/fixtures"
if [ -d "$PREFLIGHT_EVIDENCE" ]; then cp -a "$PREFLIGHT_EVIDENCE"/. "$OUT/evidence/"; fi
PROFILE_VERIFY_SCRIPT="${FFMPEG_RENDER_PROFILE_VERIFY_SCRIPT:-$ROOT/tools/ffmpeg-render-build-profile/verify.mjs}"
node "$PROFILE_VERIFY_SCRIPT" > "$OUT/evidence/profile-verification.json"
test -f "$PREFLIGHT_SOURCE_OUT/evidence/msys2-toolchain-preflight.json"

curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz' -o "$SOURCE_TARBALL"
ACTUAL_SOURCE_SHA="$(sha256sum "$SOURCE_TARBALL" | awk '{print $1}')"
test "$ACTUAL_SOURCE_SHA" = "$EXPECTED_SOURCE_SHA"
printf '%s  %s\n' "$ACTUAL_SOURCE_SHA" 'ffmpeg-9.0.1.tar.xz' > "$OUT/evidence/source-archive.sha256"
mkdir -p "$SOURCE_DIR"
tar -xJf "$SOURCE_TARBALL" --strip-components=1 -C "$SOURCE_DIR"

test -f /ucrt64/include/mfapi.h
test -f /ucrt64/include/mftransform.h

CONFIG_RESOLVER="${FFMPEG_RENDER_CONFIG_RESOLVER:-$ROOT/tools/ffmpeg-render-build/resolve-config.mjs}"
mapfile -t CONFIGURE_ARGS < <(node "$CONFIG_RESOLVER" windows-x86_64)
CONFIGURE_JSON="$(node "$CONFIG_RESOLVER" windows-x86_64 --json)"
BUILD_JOBS="$(nproc)"
BUILD_JSON="[\"$MAKE_COMMAND\",\"-j$BUILD_JOBS\",\"$MAKE_COMMAND install\"]"
GCC_VERSION="$(gcc --version | head -1)"
LD_VERSION="$(ld --version | head -1)"
MAKE_VERSION="$("$MAKE_COMMAND" --version | head -1)"
TOOLCHAIN_IDENTITY="$GCC_VERSION; $LD_VERSION; $MAKE_VERSION; MSYS2_UCRT64"
FFMPEG_RENDER_PROFILE_PATH="$PROFILE" node "$ROOT/tools/ffmpeg-render-build/create-records.mjs" --platform windows --architecture x86_64 --output "$OUT/records" --compiler "$GCC_VERSION" --toolchain "$TOOLCHAIN_IDENTITY" --configure-json "$CONFIGURE_JSON" --build-json "$BUILD_JSON"

cd "$SOURCE_DIR"
./configure "${CONFIGURE_ARGS[@]}" 2>&1 | tee "$OUT/evidence/configure.log"
if [ -f config.log ]; then
  cp config.log "$OUT/evidence/config.log"
elif [ -f ffbuild/config.log ]; then
  cp ffbuild/config.log "$OUT/evidence/config.log"
else
  echo 'configure did not produce a recognized config.log path' >&2
  false
fi
"$MAKE_COMMAND" -j"$BUILD_JOBS" 2>&1 | tee "$OUT/evidence/build.log"
"$MAKE_COMMAND" install 2>&1 | tee -a "$OUT/evidence/build.log"

test -f "$SOURCE_DIR/install/bin/ffmpeg.exe"
test -f "$SOURCE_DIR/install/bin/ffprobe.exe"
cp -a "$SOURCE_DIR/install/bin/ffmpeg.exe" "$OUT/bundle/ffmpeg.exe"
cp -a "$SOURCE_DIR/install/bin/ffprobe.exe" "$OUT/bundle/ffprobe.exe"
find "$SOURCE_DIR/install" -type f -iname '*.dll' -exec cp -a {} "$OUT/bundle/" \;
test -n "$(find "$OUT/bundle" -maxdepth 1 -type f -iname '*.dll' -print -quit)"

node "$ROOT/tools/ffmpeg-render-build/create-fixtures.mjs" "$OUT/fixtures"
CAPABILITY_SCRIPT="${FFMPEG_RENDER_CAPABILITY_SCRIPT:-$ROOT/tools/ffmpeg-render-build/verify-capabilities.sh}"
FFMPEG_BIN="$OUT/bundle/ffmpeg.exe" FFPROBE_BIN="$OUT/bundle/ffprobe.exe" FIXTURES_DIR="$OUT/fixtures" CAPABILITY_OUT="$OUT/evidence" bash "$CAPABILITY_SCRIPT"
node "$ROOT/tools/ffmpeg-render-build/capture-runtime-deps.mjs" --bundle "$OUT/bundle" --platform windows --output "$OUT/evidence/runtime-deps.json"
node "$ROOT/tools/ffmpeg-render-build/assemble-license-evidence.mjs" --source "$SOURCE_DIR" --records "$OUT/records" --profile "$PROFILE" --output "$OUT/evidence/license-evidence.json"
node "$ROOT/tools/ffmpeg-render-build/assemble-manifest.mjs" --bundle "$OUT/bundle" --records "$OUT/records" --runtime-deps "$OUT/evidence/runtime-deps.json" --license "$OUT/evidence/license-evidence.json" --profile "$PROFILE" --output "$OUT/manifest.json"
node "$ROOT/tools/ffmpeg-render-build/assemble-vulnerability-review.mjs" --profile "$PROFILE" --manifest "$OUT/manifest.json" --output "$OUT/evidence/vulnerability-review.json"
node "$ROOT/tools/ffmpeg-render-build/assemble-sbom.mjs" --manifest "$OUT/manifest.json" --license "$OUT/evidence/license-evidence.json" --output "$OUT/SBOM.cdx.json" --notice "$OUT/THIRD_PARTY_NOTICES.md"
node "$ROOT/tools/ffmpeg-render-build/verify-manifest.mjs" --bundle "$OUT/bundle" --manifest "$OUT/manifest.json" --profile "$PROFILE" --negative-controls
node "$ROOT/tools/ffmpeg-render-build/create-transfer-manifest.mjs" --root "$OUT" --platform windows --candidate-id "code-f-ffmpeg-render-windows-${GITHUB_SHA:-local}-${GITHUB_RUN_ID:-local}" --profile "$PROFILE" --manifest "$OUT/manifest.json" --records "$OUT/records" --output "$OUT/candidate-transfer-manifest.json"

sha256sum "$OUT/bundle/ffmpeg.exe" "$OUT/bundle/ffprobe.exe" > "$OUT/evidence/entrypoints.sha256"
sha256sum "$OUT/manifest.json" "$OUT/SBOM.cdx.json" "$OUT/candidate-transfer-manifest.json" > "$OUT/evidence/authority-files.sha256"
printf 'system_path_used=NO\nnetwork_protocols=DISABLED\nexternal_library_autodetection=DISABLED\ncapability_mode=%s\ndesktop_h264_mf_product_gate=NOT_RUN_ON_SERVER\nproduct_render=NOT_RUN\nelectron_packaged_integration=NOT_RUN\n' "${FFMPEG_CAPABILITY_MODE:-FULL_SMOKE}" > "$OUT/evidence/build-policy.txt"
echo 'FFMPEG_RENDER_WINDOWS_BUILD: PASS'
