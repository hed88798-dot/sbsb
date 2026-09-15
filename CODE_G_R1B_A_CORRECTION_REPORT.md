# Code G R1B-A pre-Windows correction report

```text
CODE_G_R1B_A_CORRECTION:
PASS

BASE_IMPLEMENTATION:
aa2709d43538d0c7bd8940e02e2fb0be130e88e1

FINAL_COMMIT:
THIS_COMMIT

ROTATION_RUNTIME_CAPABILITY:
BLOCKED_RUNTIME_V1

PROFILE_V2_REQUIRED:
YES

RUNTIME_V1_STATUS:
HISTORICALLY_APPROVED

RUNTIME_V1_CURRENT_R1B_COMPATIBILITY:
INCOMPATIBLE_WITH_ROTATION_CAPABLE_R1B_CONTRACT

ROTATION_90_PRODUCT_EXECUTION:
PENDING_RUNTIME_V2

ROTATION_180_PRODUCT_EXECUTION:
PENDING_RUNTIME_V2

ROTATION_270_PRODUCT_EXECUTION:
PENDING_RUNTIME_V2

ROTATION_OUTPUT_DIMENSIONS:
PENDING_RUNTIME_V2

ROTATION_FRAME_COUNT:
PENDING_RUNTIME_V2

PRESPAWN_CANCELLATION:
PASS

PROGRESS_PROTOCOL_FAILURE_CLASSIFICATION:
PASS

INVALID_SUCCESS_RECOVERY_DISPOSITION:
PASS

WINDOWS_CANCELLATION_HARNESS:
READY

HISTORICAL_R1A_PRODUCT_FIXTURE:
NONE_AVAILABLE

SMOKE_BUNDLE_EXPORT:
READY

R1B_TESTS:
105/105 focused Render, migration, portable-bundle, and boundary tests PASS

R1A_REGRESSION:
PASS (30/30)

LOCAL_BROAD_REGRESSION:
PASS (325/325)

FULL_LOCAL_TESTS:
772 PASS; 3 SKIP; 5 unavailable because this Mac lacks exact Python 3.13.15

CI:
PENDING_DRAFT_PR

WINDOWS_NATIVE_SMOKE:
PENDING_DRAFT_PR

WINDOWS_11_PRODUCT_RENDER:
STILL_PENDING

MAIN_MERGE:
NO

FIRST_ACTUAL_BLOCKER:
CODE_G_CAPABILITY_PROFILE_V2_AND_CODE_F_ROTATION_CAPABLE_RUNTIME_V2_ARE_NOT_AVAILABLE
```

## Correction summary

- Runtime v1 evidence remains immutable. Product pre-spawn verification authenticates it and then
  fails closed with `RENDER_ROTATION_RUNTIME_CAPABILITY_V2_REQUIRED` until a forward profile
  and Runtime v2 exist. The R1B `-autorotate` semantic is unchanged.
- Migration 007 adds durable cancellation intent and append-only output recoverability observations;
  migrations 005 and 006 remain byte-identical to their accepted versions.
- STARTING cancellation is checked before re-verification, after it, and in the conditional
  STARTING-to-RUNNING spawn claim. Before, during, and immediate pre-spawn race tests persist an
  immutable CANCELLED receipt and launch no process.
- Invalid FFmpeg progress terminates as FAILED with
  `FFMPEG_PROGRESS_PROTOCOL_INVALID`, never as user cancellation.
- Historical SUCCEEDED attempts, receipts, and VERIFIED_OUTPUT rows remain immutable. Missing,
  hash-invalid, or size-invalid current output creates a separate append-only disposition, moves the
  user-facing current envelope to FAILED, and blocks automatic trusted reuse even if bytes later
  reappear.
- The Windows harness now exercises product-service cancellation, Windows `taskkill /T`, bounded
  graceful/forced stages, orphan detection, partial-output non-promotion, CANCELLED receipt, retry,
  and verified success. It has not been run as product evidence.
- Controlled export/import commands package an existing accepted READY job into a relative,
  hash/size-bound bundle with manifest and aggregate bundle hashes. Import rejects traversal,
  normalized conflicts, undeclared files, symlinks/reparse escapes, and mutations, then creates only
  a new Windows execution snapshot. It does not run or reconstruct C/D/E.

No accepted historical product database exists on this host, so no fake fixture was substituted.
No Windows product acceptance was run.

STOP.
