# R1B deterministic FFmpeg execution V1

R1B is a Main-owned executor for an exact R1A `READY_FOR_EXECUTION` record. Its public service
surface is `executePreparedRender(job_id)`. The caller cannot provide source paths, output paths,
runtime paths, codecs, encoders, filter graphs, or raw process arguments.

## Frozen execution semantics

- Every source input is a staged path from the immutable execution snapshot.
- Each interval is decoded and filter-trimmed from its exact millisecond source range; input-side
  keyframe seeking is not used as the accepted boundary.
- Each segment is CFR-normalized and then trimmed to exactly `frame_end - frame_start` frames.
- FFprobe `-count_frames` must report exactly `LogicalRenderPlan.total_output_frames`; there is no
  implicit one-frame tolerance.
- The only output audio is the staged narration, resampled to AAC 48 kHz stereo. Source audio is
  never mapped. Subtitle, data, and attachment streams fail verification.
- Windows uses only the approved `h264_mf` runtime identity. No PATH lookup or encoder fallback is
  present.

## Process and output lifecycle

The executor spawns an absolute executable with an argument array and `shell: false`. FFmpeg uses
`-nostdin`, `-nostats`, and `-progress pipe:1`. Main enforces overall, no-progress, graceful-cancel,
forced-cancel, and bounded-log policy facts. Windows tree termination uses the absolute system
`taskkill.exe` with `/T`, followed by `/F` after the bounded grace interval.

FFmpeg writes only an attempt-local `.partial.mp4`. Exit code zero and `progress=end` are necessary
but not sufficient. The exact approved FFprobe verifies stream count/order, H.264, canvas, rational
FPS, exact frame count, pixel format, profile/level, AAC, 48 kHz stereo, MP4, size, and duration.
The output hash is measured before and after probing. Verified bytes are finalized with a
same-volume atomic rename and re-hashed; ordinary copy fallback is forbidden.

## Persistence and recovery

Migration 006 adds transactional execution-attempt ownership independently of frozen R1A
preparation state. Only one STARTING/RUNNING/VERIFYING attempt may exist per job. Success atomically
persists `VERIFIED_OUTPUT`, immutable receipt, execution terminal state, and generic Job success.
Startup converts unfinished attempts to `INTERRUPTED`, removes controlled partial/final bytes, and
never infers success from an MP4. A valid existing success is returned only after its path, size, and
SHA-256 are reverified.

## Acceptance boundary

The repository provides one Windows 11 Desktop smoke command under `tools/render-r1b`. It consumes
an already accepted historical C→D→E→R1A authority chain and calls the product service; it does not
recompute upstream semantics. Until that command passes on a supported Windows 11 x64 Desktop with
the exact Code F runtime, product acceptance remains `PENDING_WINDOWS_11_DESKTOP_EXECUTION`.
