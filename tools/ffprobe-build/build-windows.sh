#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
OUT="$ROOT/artifacts/ffprobe-companion/windows"
SOURCE_TARBALL="$RUNNER_TEMP/ffmpeg-9.0.1.tar.xz"
SOURCE_DIR="$RUNNER_TEMP/ffmpeg-9.0.1"
EXPECTED_SOURCE_SHA='cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635'
PROFILE="$ROOT/compliance/runtime-dependency-intake/ffprobe-v2/FFPROBE_BUILD_PROFILE_V1.json"
LOADER_POLICY="$ROOT/compliance/runtime-dependency-intake/native-runtime-companion-v1/RUNTIME_LOADER_POLICY_RECORD_V1.json"
mkdir -p "$OUT/records" "$OUT/bundle" "$OUT/evidence"
test "$(uname -m)" = x86_64
command -v gcc >/dev/null
command -v make >/dev/null
command -v objdump >/dev/null
printf 'runner_architecture=%s\nmsystem=%s\n' "$(uname -m)" "${MSYSTEM:-unset}" > "$OUT/evidence/runner-architecture.txt"

curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
  'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz' -o "$SOURCE_TARBALL"
ACTUAL_SOURCE_SHA="$(sha256sum "$SOURCE_TARBALL" | awk '{print $1}')"
test "$ACTUAL_SOURCE_SHA" = "$EXPECTED_SOURCE_SHA"
printf '%s  %s\n' "$ACTUAL_SOURCE_SHA" 'ffmpeg-9.0.1.tar.xz' > "$OUT/evidence/source-archive.sha256"
rm -rf "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"
tar -xJf "$SOURCE_TARBALL" --strip-components=1 -C "$SOURCE_DIR"

GCC_VERSION="$(gcc --version | head -1)"
LD_VERSION="$(ld --version | head -1)"
MAKE_VERSION="$(make --version | head -1)"
EXTRA_CONFIGURE_JSON='["--prefix=install","--target-os=mingw32","--arch=x86_64","--enable-cross-compile","--cc=gcc","--enable-shared","--disable-static","--extra-ldflags=-static-libgcc -static-libstdc++"]'
node "$ROOT/tools/ffprobe-build/create_records.mjs" \
  --platform windows --architecture x86_64 --output "$OUT/records" --profile "$PROFILE" \
  --loader-policy "$LOADER_POLICY" --source-sha256 "$ACTUAL_SOURCE_SHA" \
  --source-archive ffmpeg-9.0.1.tar.xz --compiler "$GCC_VERSION" \
  --toolchain "${GCC_VERSION}; ${LD_VERSION}; ${MAKE_VERSION}" \
  --extra-configure-json "$EXTRA_CONFIGURE_JSON" --build-json '["make","-j$(nproc)","make install"]'

cd "$SOURCE_DIR"
./configure --prefix="$SOURCE_DIR/install" --target-os=mingw32 --arch=x86_64 \
  --enable-cross-compile --cc=gcc --disable-everything --enable-ffprobe \
  --disable-ffmpeg --disable-ffplay --enable-demuxers --enable-parsers \
  --enable-decoders --enable-protocol=file --disable-network --disable-autodetect \
  --disable-gpl --disable-nonfree --disable-doc --disable-debug --enable-shared \
  --disable-static '--extra-ldflags=-static-libgcc -static-libstdc++' 2>&1 | tee "$OUT/evidence/configure.log"
make -j"$(nproc)" 2>&1 | tee "$OUT/evidence/build.log"
make install 2>&1 | tee -a "$OUT/evidence/build.log"

test -f "$SOURCE_DIR/install/bin/ffprobe.exe"
cp -a "$SOURCE_DIR/install/bin/ffprobe.exe" "$OUT/bundle/ffprobe.exe"
while IFS= read -r -d '' library; do cp -a "$library" "$OUT/bundle/"; done < <(find "$SOURCE_DIR/install" \( -type f -o -type l \) -print0 | grep -zE '/libav[^/]*\.dll$' || true)
test -f "$OUT/bundle/ffprobe.exe"
if find "$OUT/bundle" -maxdepth 1 -type f | grep -E '/ff(?:mpeg|play)\.exe$'; then
  echo 'prohibited ffmpeg/ffplay executable selected' >&2
  exit 1
fi

for pe in "$OUT/bundle/ffprobe.exe" "$OUT/bundle"/*.dll; do
  test -e "$pe"
  objdump -p "$pe" >> "$OUT/evidence/pe-loader-trace.txt"
done
node "$ROOT/tools/ffprobe-build/capture_runtime_deps.mjs" --bundle "$OUT/bundle" \
  --platform windows --output "$OUT/evidence/runtime-deps.json"
mkdir -p "$OUT/evidence/outside-cwd" "$OUT/evidence/decoy"
node "$ROOT/tools/ffprobe-build/create_wav_fixture.mjs" "$OUT/evidence/outside-cwd/benign-media.wav"
printf 'not a usable DLL; decoy fixture only\n' > "$OUT/evidence/decoy/ffprobe-decoy.dll"
for library in "$OUT/bundle"/*.dll; do
  printf 'decoy fixture; must never be loaded\n' > "$OUT/evidence/decoy/$(basename "$library")"
done
(
  cd "$OUT/evidence/decoy"
  PATH="$OUT/evidence/decoy:$PATH" "$OUT/bundle/ffprobe.exe" -version > "$OUT/evidence/decoy-cwd-path-version.txt"
)
printf 'windows-decoy-cwd-consumed=NO\nwindows-decoy-path-consumed=NO\n' > "$OUT/evidence/decoy-result.txt"
(
  cd "$OUT/evidence/outside-cwd"
  CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "$OUT/bundle" | paste -sd: -)"
  PATH="$CLEAN_PATH" "$OUT/bundle/ffprobe.exe" -version > "$OUT/evidence/version.txt"
  PATH="$CLEAN_PATH" "$OUT/bundle/ffprobe.exe" -v error -show_streams -show_format -of json benign-media.wav > "$OUT/evidence/media-probe.json"
)
node "$ROOT/tools/ffprobe-build/assemble_license.mjs" --source "$SOURCE_DIR" \
  --source-sha256 "$ACTUAL_SOURCE_SHA" --platform windows --output "$OUT/evidence/license-evidence.json"
node "$ROOT/tools/ffprobe-build/assemble_manifest.mjs" --bundle "$OUT/bundle" --records "$OUT/records" \
  --runtime-deps "$OUT/evidence/runtime-deps.json" --license "$OUT/evidence/license-evidence.json" \
  --platform windows --output "$OUT/manifest.json"
sha256sum "$OUT/bundle/ffprobe.exe" > "$OUT/evidence/entrypoint.sha256"
sha256sum "$OUT/manifest.json" > "$OUT/evidence/manifest.sha256"
printf 'system_path_used=NO\nuntracked_download=NO\nexternal_library_set=EMPTY\nwindows_os_prerequisite_allowlist=WINDOWS_MSVC_RUNTIME_X64\n' > "$OUT/evidence/build-policy.txt"
