#!/usr/bin/env bash
set -euo pipefail

FFMPEG="${FFMPEG_BIN:?FFMPEG_BIN is required}"
FFPROBE="${FFPROBE_BIN:?FFPROBE_BIN is required}"
FIXTURES="${FIXTURES_DIR:?FIXTURES_DIR is required}"
OUT="${CAPABILITY_OUT:?CAPABILITY_OUT is required}"
mkdir -p "$OUT"
test -x "$FFMPEG" -o -f "$FFMPEG"
test -x "$FFPROBE" -o -f "$FFPROBE"
test -f "$FIXTURES/input.rgb24"
test -f "$FIXTURES/narration.wav"

fail() { echo "FFMPEG_RENDER_CAPABILITY_SMOKE: FAIL: $*" >&2; exit 1; }
require_line() { grep -Eq "$2" "$1" || fail "missing $3"; }

"$FFMPEG" -version > "$OUT/version.txt" 2>&1 || fail 'ffmpeg -version failed'
"$FFMPEG" -buildconf > "$OUT/buildconf.txt" 2>&1 || fail 'ffmpeg -buildconf failed'
"$FFMPEG" -filters > "$OUT/filters.txt" 2>&1 || fail 'filter inventory unavailable'
"$FFMPEG" -encoders > "$OUT/encoders.txt" 2>&1 || fail 'encoder inventory unavailable'
"$FFMPEG" -muxers > "$OUT/muxers.txt" 2>&1 || fail 'muxer inventory unavailable'
"$FFMPEG" -protocols > "$OUT/protocols.txt" 2>&1 || fail 'protocol inventory unavailable'

for filter in concat crop format fps pad scale setsar setpts trim aformat aresample asetpts; do
  require_line "$OUT/filters.txt" "[[:space:]]${filter}[[:space:]]" "filter $filter"
done
require_line "$OUT/encoders.txt" '[[:space:]]h264_mf([[:space:]]|$)' 'Windows h264_mf encoder'
require_line "$OUT/encoders.txt" '[[:space:]]aac([[:space:]]|$)' 'AAC encoder'
require_line "$OUT/muxers.txt" '[[:space:]]mov([[:space:]]|$)' 'MP4 mov muxer'
require_line "$OUT/muxers.txt" '[[:space:]]mp4([[:space:]]|$)' 'MP4 muxer'
require_line "$OUT/protocols.txt" '^[[:space:]]+file([[:space:]]|$)' 'file protocol'
require_line "$OUT/protocols.txt" '^[[:space:]]+pipe([[:space:]]|$)' 'pipe protocol'
for forbidden in ftp http https rtmp rtsp tcp udp; do
  if grep -Eq "^[[:space:]]+${forbidden}([[:space:]]|$)" "$OUT/protocols.txt"; then
    fail "forbidden network protocol is enabled: $forbidden"
  fi
done

video="$OUT/rendered-video.mp4"
audio="$OUT/rendered-narration.m4a"
output="$OUT/rendered-output.mp4"
progress="$OUT/video-progress.txt"
rm -f "$video" "$audio" "$output" "$progress"

# The input is a hash-pinned local fixture. Every transformation is explicit,
# and machine-readable progress is emitted on the approved stdout pipe.
if ! "$FFMPEG" -hide_banner -loglevel error \
  -f rawvideo -pix_fmt rgb24 -video_size 16x16 -framerate 30 -i "$FIXTURES/input.rgb24" \
  -an -vf 'trim=start=0:end=0.5,setpts=PTS-STARTPTS,scale=32:32,pad=32:32:0:0:black,setsar=1,fps=30,format=yuv420p' \
  -c:v h264_mf -b:v 500k -movflags +faststart -progress pipe:1 -f mp4 "$video" > "$progress"; then
  fail 'H.264 Media Foundation encode failed'
fi
require_line "$progress" '^progress=end' 'terminal progress marker'

if ! "$FFMPEG" -hide_banner -loglevel error -i "$FIXTURES/narration.wav" \
  -vn -af 'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS' \
  -c:a aac -ar 48000 -ac 2 -b:a 128k -movflags +faststart "$audio"; then
  fail 'AAC narration encode failed'
fi
if ! "$FFMPEG" -hide_banner -loglevel error -i "$video" -i "$audio" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a copy -movflags +faststart -f mp4 "$output"; then
  fail 'video/audio MP4 mux failed'
fi

"$FFPROBE" -v error -show_streams -show_format -of json "$output" > "$OUT/output-probe.json" || fail 'ffprobe output verification failed'
node - "$OUT/output-probe.json" <<'NODE'
const { readFileSync } = require('node:fs');
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const streams = doc.streams ?? [];
const video = streams.find((stream) => stream.codec_type === 'video');
const audio = streams.find((stream) => stream.codec_type === 'audio');
if (!video || video.codec_name !== 'h264' || video.width !== 32 || video.height !== 32 || video.pix_fmt !== 'yuv420p') throw new Error('video facts do not satisfy profile');
if (!audio || audio.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000 || Number(audio.channels) !== 2) throw new Error('audio facts do not satisfy profile');
if (doc.format?.format_name !== 'mov,mp4,m4a,3gp,3g2,mj2') throw new Error(`unexpected container: ${doc.format?.format_name}`);
NODE

# Absolute invocation must remain correct when CWD and PATH contain decoys.
decoy="$OUT/decoy"
mkdir -p "$decoy"
printf '%s\n' '#!/usr/bin/env sh' 'echo decoy-ffmpeg-consumed >&2' 'exit 91' > "$decoy/ffmpeg"
chmod +x "$decoy/ffmpeg"
if ! (cd "$decoy" && PATH="$decoy:$PATH" "$FFMPEG" -version > "$OUT/decoy-version.txt" 2>&1); then
  fail 'absolute ffmpeg invocation was affected by PATH/CWD decoy'
fi
if grep -q 'decoy-ffmpeg-consumed' "$OUT/decoy-version.txt"; then fail 'PATH decoy was consumed'; fi

# Network and unsupported capability controls must fail closed.
if "$FFMPEG" -hide_banner -loglevel error -i 'http://127.0.0.1:9/not-allowed' -f null - > "$OUT/network-control.txt" 2>&1; then
  fail 'network input unexpectedly succeeded'
fi
if "$FFMPEG" -hide_banner -loglevel error -f rawvideo -pix_fmt rgb24 -video_size 16x16 -framerate 30 -i "$FIXTURES/input.rgb24" -vf subtitles=missing.srt -f null - > "$OUT/unsupported-filter-control.txt" 2>&1; then
  fail 'unsupported subtitle filter unexpectedly succeeded'
fi

# A looped local operation gives the harness a deterministic termination point.
cancel_progress="$OUT/cancel-progress.txt"
set +e
"$FFMPEG" -hide_banner -loglevel error -stream_loop -1 -f rawvideo -pix_fmt rgb24 -video_size 16x16 -framerate 30 -i "$FIXTURES/input.rgb24" -f null - > "$cancel_progress" 2>&1 &
pid=$!
sleep 1
kill "$pid" 2>/dev/null
wait "$pid"
cancel_status=$?
set -e
if [ "$cancel_status" -eq 0 ]; then fail 'cancelled process reported success'; fi

printf '%s\n' \
  '{' \
  '  "schema_version": "1",' \
  '  "status": "PASS",' \
  '  "encoder": "h264_mf",' \
  '  "audio_encoder": "aac",' \
  '  "muxer": "mov",' \
  '  "protocols": {"required": ["file", "pipe"], "forbidden_present": []},' \
  '  "network_control": "FAIL_CLOSED",' \
  '  "unsupported_filter_control": "FAIL_CLOSED",' \
  '  "path_cwd_decoy_control": "PASS",' \
  '  "cancellation_control": "PASS",' \
  '  "product_render": "NOT_RUN"' \
  '}' > "$OUT/capability-verification.json"
cat "$OUT/capability-verification.json"
