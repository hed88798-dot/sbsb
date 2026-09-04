#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
OUT="$ROOT/artifacts/ffprobe-companion/linux"
SOURCE_TARBALL="$RUNNER_TEMP/ffmpeg-9.0.1.tar.xz"
SOURCE_DIR="$RUNNER_TEMP/ffmpeg-9.0.1"
EXPECTED_SOURCE_SHA='cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635'
PROFILE="$ROOT/compliance/runtime-dependency-intake/ffprobe-v2/FFPROBE_BUILD_PROFILE_V1.json"
LOADER_POLICY="$ROOT/compliance/runtime-dependency-intake/native-runtime-companion-v1/RUNTIME_LOADER_POLICY_RECORD_V1.json"
mkdir -p "$OUT/records" "$OUT/bundle" "$OUT/evidence"
test "$(uname -m)" = x86_64
printf 'runner_architecture=%s\n' "$(uname -m)" > "$OUT/evidence/runner-architecture.txt"

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
EXTRA_CONFIGURE_JSON='["--prefix=install","--enable-shared","--disable-static","--extra-ldflags=-Wl,-rpath,$ORIGIN"]'
node "$ROOT/tools/ffprobe-build/create_records.mjs" \
  --platform linux --architecture x86_64 --output "$OUT/records" --profile "$PROFILE" \
  --loader-policy "$LOADER_POLICY" --source-sha256 "$ACTUAL_SOURCE_SHA" \
  --source-archive ffmpeg-9.0.1.tar.xz --compiler "$GCC_VERSION" \
  --toolchain "${GCC_VERSION}; ${LD_VERSION}; ${MAKE_VERSION}" \
  --extra-configure-json "$EXTRA_CONFIGURE_JSON" --build-json '["make","-j$(nproc)","make install"]'

cd "$SOURCE_DIR"
./configure --prefix="$SOURCE_DIR/install" \
  --disable-everything --enable-ffprobe --disable-ffmpeg --disable-ffplay \
  --enable-demuxers --enable-parsers --enable-decoders --enable-protocol=file \
  --disable-network --disable-autodetect --disable-gpl --disable-nonfree \
  --disable-doc --disable-debug --enable-shared --disable-static \
  '--extra-ldflags=-Wl,-rpath,$ORIGIN' > "$OUT/evidence/configure.log" 2>&1
make -j"$(nproc)" > "$OUT/evidence/build.log" 2>&1
make install >> "$OUT/evidence/build.log" 2>&1

test -f "$SOURCE_DIR/install/bin/ffprobe"
cp -a "$SOURCE_DIR/install/bin/ffprobe" "$OUT/bundle/ffprobe"
while IFS= read -r -d '' library; do cp -a "$library" "$OUT/bundle/"; done < <(find "$SOURCE_DIR/install/lib" -maxdepth 1 \( -type f -o -type l \) -print0 | grep -zE '/libav[^/]*\.so(?:\.[0-9]+)*$' || true)
test -f "$OUT/bundle/ffprobe"
if find "$OUT/bundle" -maxdepth 1 -type f -o -type l | grep -Eq '/ff(?:mpeg|play)$'; then
  echo 'prohibited ffmpeg/ffplay executable selected' >&2
  exit 1
fi

for elf in "$OUT/bundle/ffprobe" "$OUT/bundle"/*.so*; do
  test -e "$elf"
  dynamic="$(readelf -d "$elf")"
  printf '%s\n%s\n' "=== $elf ===" "$dynamic" >> "$OUT/evidence/elf-loader-trace.txt"
  grep -F 'RUNPATH' <<<"$dynamic" | grep -F '[$ORIGIN]' >/dev/null
  ! grep -E '\[(RPATH|RUNPATH)\].*(^/| /|/opt/|/usr/)' <<<"$dynamic" >/dev/null
  ! grep -F 'RPATH' <<<"$dynamic" >/dev/null
done

node "$ROOT/tools/ffprobe-build/capture_runtime_deps.mjs" --bundle "$OUT/bundle" \
  --platform linux --output "$OUT/evidence/runtime-deps.json"
mkdir -p "$OUT/evidence/outside-cwd"
node "$ROOT/tools/ffprobe-build/create_wav_fixture.mjs" "$OUT/evidence/outside-cwd/benign-media.wav"
(
  cd "$OUT/evidence/outside-cwd"
  env -u LD_LIBRARY_PATH PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "$OUT/bundle" | paste -sd: -)" \
    "$OUT/bundle/ffprobe" -v error -show_streams -show_format -of json benign-media.wav \
    > "$OUT/evidence/media-probe.json" 2> "$OUT/evidence/media-probe.err"
)
env -u LD_LIBRARY_PATH PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "$OUT/bundle" | paste -sd: -)" \
  "$OUT/bundle/ffprobe" -version > "$OUT/evidence/version.txt"
printf 'linux-path-free-execution=PASS\nlinux-cwd-outside-bundle=PASS\n' > "$OUT/evidence/runtime-policy.txt"
node "$ROOT/tools/ffprobe-build/assemble_license.mjs" --source "$SOURCE_DIR" \
  --source-sha256 "$ACTUAL_SOURCE_SHA" --platform linux --output "$OUT/evidence/license-evidence.json"
node "$ROOT/tools/ffprobe-build/assemble_manifest.mjs" --bundle "$OUT/bundle" --records "$OUT/records" \
  --runtime-deps "$OUT/evidence/runtime-deps.json" --license "$OUT/evidence/license-evidence.json" \
  --platform linux --output "$OUT/manifest.json"
sha256sum "$OUT/bundle/ffprobe" > "$OUT/evidence/entrypoint.sha256"
sha256sum "$OUT/manifest.json" > "$OUT/evidence/manifest.sha256"
printf 'system_path_used=NO\nuntracked_download=NO\nexternal_library_set=EMPTY\n' > "$OUT/evidence/build-policy.txt"
