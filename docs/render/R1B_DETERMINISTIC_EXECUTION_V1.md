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

Runtime v1 remains historically approved, but it is now blocked from product execution because its
declared filter surface cannot satisfy the rotation-capable contract. See
`R1B_A_RUNTIME_ROTATION_COMPATIBILITY_CHECKPOINT.md`. A new profile/runtime v2 and real 90°/180°/270°
product evidence are required; v1 evidence is not modified.

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

Migration 007 adds durable cancellation intent while STARTING and append-only current output
recoverability observations. The executor checks cancellation before and after re-verification and
atomically refuses the STARTING→RUNNING spawn claim when cancellation is present. Historical success
receipts and `VERIFIED_OUTPUT` rows remain immutable when current bytes later become missing or
invalid; a separate disposition blocks trusted reuse and changes only the user-facing current job
envelope.

## Acceptance boundary

The repository provides controlled export/import commands plus one Windows 11 Desktop smoke command
under `tools/render-r1b`. The portable bundle carries relative, hash-bound files and accepted
authority records, then creates only a new machine-local execution snapshot. The final smoke calls
the product service for both real Windows process-tree cancellation and success; it does not
recompute upstream semantics. Until Runtime v2 and those cases pass on supported Windows 11 x64
Desktop, product acceptance remains `PENDING_WINDOWS_11_DESKTOP_EXECUTION`.
