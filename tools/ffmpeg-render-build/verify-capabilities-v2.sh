#!/usr/bin/env bash
set -euo pipefail

FFMPEG_BIN="${FFMPEG_BIN:?FFMPEG_BIN is required}"
FFPROBE_BIN="${FFPROBE_BIN:?FFPROBE_BIN is required}"
FIXTURES_DIR="${FIXTURES_DIR:?FIXTURES_DIR is required}"
CAPABILITY_OUT="${CAPABILITY_OUT:?CAPABILITY_OUT is required}"
mkdir -p "$CAPABILITY_OUT"

# The hosted Windows Server job is deliberately static. Reuse the proven
# baseline inventory, then require the four additional rotation filters from
# Code G Profile v2. No Desktop dynamic execution is inferred here.
FFMPEG_CAPABILITY_MODE=STATIC_SERVER \
  FFMPEG_BIN="$FFMPEG_BIN" \
  FFPROBE_BIN="$FFPROBE_BIN" \
  FIXTURES_DIR="$FIXTURES_DIR" \
  CAPABILITY_OUT="$CAPABILITY_OUT" \
  bash "$(dirname "$0")/verify-capabilities.sh"

for filter in transpose hflip vflip rotate; do
  if ! grep -Eq "[[:space:]]${filter}[[:space:]]" "$CAPABILITY_OUT/filters.txt"; then
    echo "FFMPEG_RENDER_V2_STATIC_CAPABILITY: missing rotation filter ${filter}" >&2
    exit 1
  fi
done

node - "$CAPABILITY_OUT/capability-verification.json" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const path = process.argv[2];
const value = JSON.parse(readFileSync(path, 'utf8'));
value.profile_version = 2;
value.required_rotation_filters = ['transpose', 'hflip', 'vflip', 'rotate'];
value.dynamic_product_rotation_smoke = 'NOT_RUN_SERVER_ENVIRONMENT';
value.product_render = 'NOT_RUN';
writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
NODE

echo 'FFMPEG_RENDER_V2_STATIC_CAPABILITY_INVENTORY: PASS'
