# R1B-A runtime rotation compatibility checkpoint

```text
RUNTIME_V1_STATUS:
HISTORICALLY_APPROVED

RUNTIME_V1_CURRENT_R1B_COMPATIBILITY:
INCOMPATIBLE_WITH_ROTATION_CAPABLE_R1B_CONTRACT

ROTATION_RUNTIME_CAPABILITY:
BLOCKED_BY_APPROVED_RUNTIME_V1

PROFILE_V2_REQUIRED:
YES

WINDOWS_11_PRODUCT_ACCEPTANCE:
BLOCKED_PENDING_RUNTIME_V2
```

The frozen R1B visual contract requires `APPLY_DECLARED_METADATA`. The R1B invocation retains
`-autorotate`; it is not weakened or silently removed. The historically approved Runtime v1 has the
declared filters `concat`, `crop`, `format`, `fps`, `pad`, `scale`, `setsar`, `setpts`, and `trim`, but
does not declare `transpose`, `hflip`, `vflip`, or `rotate`. Runtime v1 was correctly approved for its
historical contract. The later R1B rotation requirement is forward contract evolution and does not
invalidate or rewrite that approval.

Production pre-spawn verification therefore fails closed with
`RENDER_ROTATION_RUNTIME_CAPABILITY_V2_REQUIRED` after authenticating the v1 authority. Runtime v1's
profile, build profile, approval receipt, binary hashes, manifest, ZIP hash, and retained artifact
remain immutable.

## Required forward replacement

Runtime v2 requires a new Code G capability-profile version and hash, a corresponding Code F build
profile/runtime identity, new member and binary hashes, a new manifest, and a new Code F approval
receipt. Static filter inventory is necessary but insufficient.

Before Runtime v2 can satisfy R1B product acceptance, the actual R1B service path must execute real
fixtures carrying 90°, 180°, and 270° display-matrix/rotation metadata. Each case must prove visible
orientation, policy canvas dimensions, SAR, FPS, exact frozen frame count without an off-by-one,
source-video audio DROP, narration-only audio, and unchanged output verification. Until those tests
run on supported Windows 11 Desktop:

```text
ROTATION_90_PRODUCT_EXECUTION: PENDING_RUNTIME_V2
ROTATION_180_PRODUCT_EXECUTION: PENDING_RUNTIME_V2
ROTATION_270_PRODUCT_EXECUTION: PENDING_RUNTIME_V2
ROTATION_OUTPUT_DIMENSIONS: PENDING_RUNTIME_V2
ROTATION_FRAME_COUNT: PENDING_RUNTIME_V2
```
