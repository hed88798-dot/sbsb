#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
OUT="$ROOT/artifacts/ffprobe-companion/windows"
EVIDENCE="$OUT/evidence"
STATUS="$EVIDENCE/msys2-toolchain-preflight-status.txt"
mkdir -p "$EVIDENCE"
printf 'status=STARTED\n' > "$STATUS"
on_error() {
  code=$?
  printf 'status=FAIL\nexit_code=%s\n' "$code" >> "$STATUS"
  exit "$code"
}
trap on_error ERR

test "${MSYSTEM:-}" = UCRT64
node_bin="${NODE_BIN:-$(dirname "$(command -v node)")}"
export PATH="/ucrt64/bin:/usr/bin:/bin:$node_bin"
test "$(uname -m)" = x86_64

# Refresh package metadata and install only the build-tool packages needed by
# the frozen FFprobe recipe. This is not a full MSYS2 system upgrade.
pacman -Sy --noconfirm --needed \
  mingw-w64-ucrt-x86_64-gcc \
  mingw-w64-ucrt-x86_64-binutils \
  mingw-w64-ucrt-x86_64-make \
  nasm

for package in mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-binutils mingw-w64-ucrt-x86_64-make nasm; do
  pacman -Q "$package" > "$EVIDENCE/msys2-package-$package.txt"
  pacman -Qi "$package" > "$EVIDENCE/msys2-package-$package.info.txt"
done

compiler_path="$(command -v gcc)"
linker_path="$(command -v ld)"
assembler_path="$(command -v nasm)"
objdump_path="$(command -v objdump)"
make_path="$(command -v make)"
test "$compiler_path" = /ucrt64/bin/gcc
test "$linker_path" = /ucrt64/bin/ld
test "$assembler_path" = /usr/bin/nasm
test "$objdump_path" = /ucrt64/bin/objdump
test "$make_path" = /ucrt64/bin/make

compiler_sha="$(sha256sum "$compiler_path" | awk '{print $1}')"
linker_sha="$(sha256sum "$linker_path" | awk '{print $1}')"
assembler_sha="$(sha256sum "$assembler_path" | awk '{print $1}')"
objdump_sha="$(sha256sum "$objdump_path" | awk '{print $1}')"
make_sha="$(sha256sum "$make_path" | awk '{print $1}')"
nasm_version="$(nasm -v 2>&1 | head -1)"
package_archives=()
for package in mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-binutils mingw-w64-ucrt-x86_64-make nasm; do
  archive="$(find /var/cache/pacman/pkg -maxdepth 1 -type f -name "$package-*.pkg.tar.*" -print | sort | tail -1 || true)"
  if [ -n "$archive" ]; then
    package_archives+=("$package=$(sha256sum "$archive" | awk '{print $1}')")
  else
    package_archives+=("$package=NOT_AVAILABLE_UNDER_CURRENT_POLICY")
  fi
done
gcc_version="$(gcc --version | head -1)"
ld_version="$(ld --version | head -1)"
objdump_version="$(objdump --version | head -1)"
cat > "$EVIDENCE/msys2-toolchain-preflight.json" <<EOF
{
  "schema_version": "1",
  "environment": "MSYS2_UCRT64",
  "target_architecture": "x86_64",
  "full_system_upgrade": false,
  "package_manager_used_for_build_toolchain": true,
  "package_manager_used_as_product_artifact_authority": false,
  "compiler": {"path": "$compiler_path", "sha256": "$compiler_sha", "version": "$gcc_version"},
  "linker": {"path": "$linker_path", "sha256": "$linker_sha", "version": "$ld_version"},
  "assembler": {"path": "$assembler_path", "sha256": "$assembler_sha", "version": "$nasm_version"},
  "objdump": {"path": "$objdump_path", "sha256": "$objdump_sha", "version": "$objdump_version"},
  "make": {"path": "$make_path", "sha256": "$make_sha", "version": "$(make --version | head -1)"},
  "package_archive_sha256": {"${package_archives[0]%%=*}": "${package_archives[0]#*=}", "${package_archives[1]%%=*}": "${package_archives[1]#*=}", "${package_archives[2]%%=*}": "${package_archives[2]#*=}", "${package_archives[3]%%=*}": "${package_archives[3]#*=}"},
  "binding": "PASS"
}
EOF
printf 'status=PASS\ncompiler=%s\nlinker=%s\nmake=%s\nassembler=%s\n' "$compiler_path" "$linker_path" "$make_path" "$assembler_path" >> "$STATUS"
cat "$EVIDENCE/msys2-toolchain-preflight.json"
