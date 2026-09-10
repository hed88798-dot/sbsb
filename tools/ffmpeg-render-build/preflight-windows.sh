#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
OUT="$ROOT/artifacts/ffmpeg-render/windows"
EVIDENCE="$OUT/evidence"
STATUS="$EVIDENCE/msys2-toolchain-preflight-status.txt"
mkdir -p "$EVIDENCE"
printf 'status=STARTED\n' > "$STATUS"
on_error() {
  code=$?
  printf 'status=FAIL\nexit_code=%s\nfailed_command=%s\n' "$code" "$BASH_COMMAND" >> "$STATUS"
  exit "$code"
}
trap on_error ERR

test "${MSYSTEM:-}" = UCRT64
test "$(uname -m)" = x86_64
export PATH="/ucrt64/bin:/usr/bin:/bin:${NODE_BIN:-$(dirname "$(command -v node)")}"
command -v node >/dev/null

# The runner image is the build host. Package metadata and exact executable
# hashes are retained as evidence; no package is treated as a product runtime.
pacman -Sy --noconfirm --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-binutils mingw-w64-ucrt-x86_64-make nasm

for package in mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-binutils mingw-w64-ucrt-x86_64-make nasm; do
  pacman -Q "$package" > "$EVIDENCE/msys2-package-$package.txt"
  pacman -Qi "$package" > "$EVIDENCE/msys2-package-$package.info.txt"
done

make_command="${MAKE_COMMAND:-mingw32-make}"
compiler_path="$(command -v gcc)"
linker_path="$(command -v ld)"
assembler_path="$(command -v nasm)"
objdump_path="$(command -v objdump)"
make_path="$(command -v "$make_command")"
case "$compiler_path" in /ucrt64/bin/gcc*) ;; *) echo "unexpected compiler path: $compiler_path" >&2; false ;; esac
case "$linker_path" in /ucrt64/bin/ld*) ;; *) echo "unexpected linker path: $linker_path" >&2; false ;; esac
case "$assembler_path" in /usr/bin/nasm*) ;; *) echo "unexpected assembler path: $assembler_path" >&2; false ;; esac
case "$objdump_path" in /ucrt64/bin/objdump*|/usr/bin/objdump*) ;; *) echo "unexpected objdump path: $objdump_path" >&2; false ;; esac
case "$make_path" in /ucrt64/bin/mingw32-make*) ;; *) echo "unexpected make path: $make_path" >&2; false ;; esac

sha() { sha256sum "$1" | awk '{print $1}'; }
package_archive_hashes=()
for package in mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-binutils mingw-w64-ucrt-x86_64-make nasm; do
  archive="$(find /var/cache/pacman/pkg -maxdepth 1 -type f -name "$package-*.pkg.tar.*" -print | sort | tail -1 || true)"
  if [ -n "$archive" ]; then
    package_archive_hashes+=("$package=$(sha "$archive")")
  else
    package_archive_hashes+=("$package=NOT_AVAILABLE_UNDER_CURRENT_POLICY")
  fi
done

export COMPILER_PATH="$compiler_path" LINKER_PATH="$linker_path" ASSEMBLER_PATH="$assembler_path" OBJDUMP_PATH="$objdump_path" MAKE_PATH="$make_path" MAKE_COMMAND="$make_command" GCC_VERSION="$(gcc --version | head -1)" LD_VERSION="$(ld --version | head -1)" NASM_VERSION="$(nasm -v 2>&1 | head -1)" OBJDUMP_VERSION="$(objdump --version | head -1)" MAKE_VERSION="$("$make_command" --version | head -1)" PACKAGE_ARCHIVE_HASHES="$(IFS=';'; printf '%s' "${package_archive_hashes[*]}")"
node - "$EVIDENCE/msys2-toolchain-preflight.json" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const [output] = process.argv.slice(2);
const env = process.env;
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const archiveHashes = Object.fromEntries((env.PACKAGE_ARCHIVE_HASHES ?? '').split(';').filter(Boolean).map((item) => item.split('=')));
const value = {
  schema_version: '1',
  environment: 'MSYS2_UCRT64',
  target_architecture: 'x86_64',
  full_system_upgrade: false,
  package_manager_used_for_build_toolchain: true,
  package_manager_used_as_product_artifact_authority: false,
  compiler: { path: env.COMPILER_PATH, sha256: hash(env.COMPILER_PATH), version: env.GCC_VERSION },
  linker: { path: env.LINKER_PATH, sha256: hash(env.LINKER_PATH), version: env.LD_VERSION },
  assembler: { path: env.ASSEMBLER_PATH, sha256: hash(env.ASSEMBLER_PATH), version: env.NASM_VERSION },
  objdump: { path: env.OBJDUMP_PATH, sha256: hash(env.OBJDUMP_PATH), version: env.OBJDUMP_VERSION },
  make: { command: env.MAKE_COMMAND, path: env.MAKE_PATH, sha256: hash(env.MAKE_PATH), version: env.MAKE_VERSION },
  package_archive_sha256: archiveHashes,
  binding: 'PASS',
};
writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
NODE

printf 'status=PASS\ncompiler=%s\nlinker=%s\nmake=%s\nassembler=%s\n' "$compiler_path" "$linker_path" "$make_path" "$assembler_path" >> "$STATUS"
cat "$EVIDENCE/msys2-toolchain-preflight.json"
