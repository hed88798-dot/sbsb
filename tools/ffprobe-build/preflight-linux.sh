#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
OUT="$ROOT/artifacts/ffprobe-companion/linux"
PREFLIGHT="$OUT/evidence/nasm-preflight.json"
STATUS="$OUT/evidence/nasm-preflight-status.txt"
EXPECTED_VERSION='2.16.01-1build1'
mkdir -p "$OUT/evidence"
printf 'status=STARTED\nexpected_version=%s\n' "$EXPECTED_VERSION" > "$STATUS"
on_error() {
  code=$?
  printf 'status=FAIL\nexit_code=%s\n' "$code" >> "$STATUS"
  exit "$code"
}
trap on_error ERR

sudo apt-get update -qq
apt-cache policy nasm > "$OUT/evidence/nasm-apt-policy.txt"
candidate="$(awk '/Candidate:/ {print $2; exit}' "$OUT/evidence/nasm-apt-policy.txt")"
printf 'candidate_version=%s\n' "${candidate:-NOT_AVAILABLE}" >> "$STATUS"
if [ "$candidate" != "$EXPECTED_VERSION" ]; then
  echo "expected NASM $EXPECTED_VERSION, runner candidate is ${candidate:-NOT_AVAILABLE}" >&2
  exit 1
fi
package_dir="$RUNNER_TEMP/nasm-package"
mkdir -p "$package_dir"
cd "$package_dir"
apt-get download "nasm=$EXPECTED_VERSION" >/tmp/code-c-nasm-download.log 2>&1
deb="$(find "$package_dir" -maxdepth 1 -type f -name 'nasm_*.deb' -print -quit)"
test -n "$deb"
package_sha="$(sha256sum "$deb" | awk '{print $1}')"
sudo dpkg --unpack "$deb" >/tmp/code-c-nasm-install.log 2>&1
command -v nasm >/dev/null
nasm_version="$(nasm -v 2>&1 | head -1)"
grep -F "NASM version $EXPECTED_VERSION" <<<"$nasm_version" >/dev/null
nasm_path="$(command -v nasm)"
nasm_sha="$(sha256sum "$nasm_path" | awk '{print $1}')"
nasm_arch="$(file -b "$nasm_path")"
test -n "$nasm_sha"
cat > "$PREFLIGHT" <<EOF
{
  "schema_version": "1",
  "tool": "nasm",
  "role": "BUILD_ONLY_TOOL",
  "distributed_in_runtime_companion": false,
  "version": "$EXPECTED_VERSION",
  "version_output": "$nasm_version",
  "architecture": "$nasm_arch",
  "executable": "$nasm_path",
  "executable_sha256": "$nasm_sha",
  "package_name": "nasm",
  "package_version": "$EXPECTED_VERSION",
  "package_source": "ubuntu-24.04-main-apt",
  "package_artifact_sha256": "$package_sha",
  "acquisition": "apt-get download nasm=$EXPECTED_VERSION followed by dpkg --unpack",
  "package_manager_used_for_build_toolchain": true,
  "package_manager_used_as_product_artifact_authority": false,
  "binding": "PASS"
}
EOF
printf 'status=PASS\n' >> "$STATUS"
{
  echo "NASM_VERSION=$EXPECTED_VERSION"
  echo "NASM_EXECUTABLE_SHA256=$nasm_sha"
  echo "NASM_PACKAGE_VERSION=$EXPECTED_VERSION"
  echo "NASM_PACKAGE_ARTIFACT_SHA256=$package_sha"
  echo "NASM_PACKAGE_SOURCE=ubuntu-24.04-main-apt"
} >> "$GITHUB_ENV"
cat "$PREFLIGHT"
