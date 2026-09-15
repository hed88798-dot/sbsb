# Code G R1B completion report

```text
CODE_G_R1B_IMPLEMENTATION:
PENDING_WINDOWS_11_DESKTOP_EXECUTION

BRANCH:
code-g/render-r1b-deterministic-execution

BASE:
4de9c42cf3b784c566d865d70906fbdffff50df4

FINAL_COMMIT:
THIS_COMMIT

REAL_FFMPEG_EXECUTION_CODE:
IMPLEMENTED

R1A_READY_TO_R1B_EXECUTION_PATH:
PASS

APPROVED_RUNTIME_HASH_REVERIFY:
PASS

STAGED_INPUT_HASH_REVERIFY:
PASS

SHELL_FALSE:
PASS

PATH_LOOKUP:
FORBIDDEN

SOURCE_VIDEO_AUDIO_DROP:
PASS

NARRATION_ONLY:
PASS

SUBTITLE_OFF:
PASS

FALLBACK_GENERATION:
NONE

FFPROBE_OUTPUT_VERIFICATION:
PASS

OUTPUT_SHA256:
PASS

VERIFIED_OUTPUT_PERSISTENCE:
PASS

TERMINAL_RECEIPT:
PASS

CONCURRENCY_IDEMPOTENCY:
PASS

CANCELLATION_TIMEOUTS:
PASS

INTERRUPTION_RECOVERY:
PASS

MIGRATION_006:
ADDED

R1A_REGRESSION:
PASS (30/30)

LOCAL_TESTS:
R1B 47/47 PASS; Render/Timeline/Migration/Isolation 308/308 PASS;
full Vitest 756 PASS, 3 SKIP, 5 unavailable because this Mac does not have
the repository-required Python 3.13.15 runtime.

CI:
NOT_YET_RUN

WINDOWS_NATIVE_SMOKE:
NOT_YET_RUN

WINDOWS_11_PRODUCT_RENDER:
PENDING_EXTERNAL_DESKTOP

WINDOWS_11_EVIDENCE:
The controlled tools/render-r1b Windows Desktop harness is ready. It opens an
existing accepted R1A READY_FOR_EXECUTION database and calls
RenderExecutionServiceV1.executePreparedRender(job_id). No hosted Windows or
Mac result is relabeled as the Windows 11 Desktop dynamic h264_mf gate.

REAL_OUTPUT:
NOT_YET_PRODUCED

REAL_OUTPUT_SHA256:
NOT_YET_PRODUCED

RECEIPT_HASH:
NOT_YET_PRODUCED

FRAME_ACCURATE_TRIM:
PASS

EXPECTED_FRAME_COUNT_VERIFY:
PASS

WINDOWS_CANCELLATION_SEMANTICS:
PENDING_WINDOWS_DESKTOP

FINALIZE_PROTOCOL:
ATOMIC_SAME_VOLUME_RENAME

HISTORICAL_UPSTREAM_AUTHORITY_REUSED:
PASS (HARNESS CONTRACT); DYNAMIC EVIDENCE PENDING_WINDOWS_DESKTOP

CAPABILITY_PROFILE_HASH:
e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910

APPROVAL_RECEIPT_HASH:
bcfad4490263904b9f8c71b19b66f5c0d6a033d4ab6bdb8896372072501ea714

APPROVED_FFMPEG_SHA256:
4ca74875cd4a8f458b21db6834ece1351f72307bd9acdfd9ccae11b26029b4a8

APPROVED_FFPROBE_SHA256:
ffacd628c9936b1988f7a3e8be168d3839a5b57cf12bacfd1098fdea64268b35

APPROVED_RUNTIME_ZIP_SHA256:
5aba48f781f56165eb5cf623eb067fc745bfbc50b9c80cfb8b7430651b4d9dbd

REAL_FFMPEG_EXECUTION:
NOT_RUN_ON_THIS_MAC

R1B_CODE_ADDED:
YES — EXECUTION SCOPE ONLY

DIGITAL_HUMAN:
NOT_TOUCHED

MAIN_MERGE:
NO

FIRST_ACTUAL_BLOCKER:
SUPPORTED_WINDOWS_11_X64_DESKTOP_WITH_THE_EXACT_CODE_F_RUNTIME_IS_NOT_AVAILABLE_ON_THIS_HOST
```

## Implemented boundary

R1B adds a job-id-only Main service, a pure deterministic FFmpeg/FFprobe invocation layer,
pre-spawn authority re-verification, direct shell-free process supervision, exact frame-count and
stream verification, hash-stable same-volume promotion, immutable output/receipt persistence,
transactional single-attempt ownership, interruption recovery, and a controlled Windows 11 product
smoke harness. The implementation does not add retrieval, selection, Timeline, narration, fallback,
subtitle, Digital Human, packaging, or installer behavior.

## Validation notes

- Build, typecheck, formatting, lint, dependency direction, portability, workflow security, secret
  scan, license scan, vulnerability gate, golden manifest, runtime-companion, loader-policy,
  FFprobe profile, and FFmpeg profile checks pass locally.
- The complete JavaScript/TypeScript suite has no R1B regression: all runnable tests passed. Five
  Python-dependent cases could not start because the host lacks exact Python 3.13.15; the repository
  CI provisions that runtime explicitly.
- No FFmpeg ZIP or binary was added to Git. The durable Draft Release remains the external runtime
  retention authority.
- Product success remains intentionally unclaimed until the supplied harness passes on supported
  Windows 11 Desktop and produces the real output SHA-256 and terminal receipt hash.

STOP.
