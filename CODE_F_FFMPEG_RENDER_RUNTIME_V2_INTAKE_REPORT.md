# Code F — FFmpeg Render Runtime v2 Intake

This is a forward, rotation-capable intake. Runtime v1 remains an historical
approval and is not mutated or revoked. No Windows v2 candidate has been
produced on this branch yet; therefore candidate hashes, runtime closure,
license, vulnerability, SBOM, retention, and Desktop rotation evidence remain
closed until the exact v2 bundle is built and inspected.

```text
CODE_F_RUNTIME_V2_INTAKE:
PENDING_WINDOWS_11_DESKTOP_ROTATION_EVIDENCE

BRANCH:
code-f/ffmpeg-render-runtime-v2-intake

BASE:
ebe411df646504d43162af3c8a588f42e633bd39

FINAL_COMMIT:
PENDING
```

## Authority binding

```text
CODE_G_PROFILE_V2_PATH:
docs/render/ffmpeg-required-capability-profile.v2.json

CODE_G_PROFILE_V2_COMMIT:
ebe411df646504d43162af3c8a588f42e633bd39

CODE_G_PROFILE_V2_ANCESTRY:
PASS

CODE_G_PROFILE_V2_HASH:
2c19710e609b1ae769e7f007cffca1e552ce1158963bec2aa8a8bcad59a01c1b

CODE_G_PROFILE_V2_FILE_SHA256:
f5de57358ab07589fbbf96e8184e2fa2b4b3eb9cb072ede22fbc4edde7ddcfb5

RUNTIME_V1_STATUS:
HISTORICALLY_APPROVED

RUNTIME_V1_MUTATED:
NO

BUILD_PROFILE_V2_PATH:
compliance/runtime-dependency-intake/ffmpeg-render-v2/FFMPEG_RENDER_BUILD_PROFILE_V2.json

BUILD_PROFILE_V2_HASH:
40ebffb4307b1c2ec141ffbdd3be2e2c52545090ea1f776267fa445952b3657c

BUILD_PROFILE_V2_FILE_SHA256:
48e6ef8716ac3f4b4a20ff4fbf7e9dc96456a512aa501859835aa3b195b0ba34
```

The v2 build profile is a new versioned subject. It preserves FFmpeg 9.0.1,
the local-only protocol boundary, GPL/nonfree/libx264/libx265 exclusions,
and the h264_mf/AAC/MP4 policy. Its only capability delta is the required
`transpose`, `hflip`, `vflip`, and `rotate` filter set plus the exactly-once
rotation policy. The v1 profile bytes and semantic hash are checked by the v2
verifier and remain unchanged.

## Candidate and capability status

```text
RUNTIME_V2_ID:
NOT_YET_PRODUCED

FFMPEG_V2_SHA256:
NOT_YET_PRODUCED

FFPROBE_V2_SHA256:
NOT_YET_PRODUCED

MANIFEST_V2_SHA256:
NOT_YET_PRODUCED

RUNTIME_V2_ZIP_SHA256:
NOT_YET_PRODUCED

STATIC_TRANSPOSE:
PENDING_CANDIDATE_ARTIFACT

STATIC_HFLIP:
PENDING_CANDIDATE_ARTIFACT

STATIC_VFLIP:
PENDING_CANDIDATE_ARTIFACT

STATIC_ROTATE:
PENDING_CANDIDATE_ARTIFACT

ROTATION_90_RUNTIME:
PENDING_WINDOWS_DESKTOP

ROTATION_180_RUNTIME:
PENDING_WINDOWS_DESKTOP

ROTATION_270_RUNTIME:
PENDING_WINDOWS_DESKTOP

ROTATION_APPLIED_EXACTLY_ONCE:
PENDING_WINDOWS_DESKTOP

OUTPUT_NONIDENTITY_DISPLAY_MATRIX:
PENDING_WINDOWS_DESKTOP
```

The hosted Windows workflow is intentionally a source-build, static inventory,
provenance, manifest, closure, and compliance job. It does not manufacture a
Windows 11 Desktop dynamic rotation PASS. The v2 workflow uses the same exact
source, profile, toolchain policy, and transient one-day transport model as the
v1 workflow, with the v2 filter inventory bound explicitly.

```text
RUNTIME_CLOSURE:
NOT_RUN_CANDIDATE_NOT_PRODUCED

LICENSE:
NOT_RUN_CANDIDATE_NOT_PRODUCED

VULNERABILITY:
NOT_RUN_CANDIDATE_NOT_PRODUCED

SBOM_NOTICE:
NOT_RUN_CANDIDATE_NOT_PRODUCED

DURABLE_ARTIFACT:
NOT_RUN_CANDIDATE_NOT_PRODUCED

APPROVAL_RECEIPT_HASH:
NOT_YET_PRODUCED

CI:
NOT_RUN_ON_V2_CANDIDATE

WINDOWS_11_RUNTIME_V2_HARNESS:
NOT_READY

CODE_G_R1B_PRODUCT_ROTATION_GATE:
NOT_RUN

MAIN_MERGE:
NO
```

## Stop condition

The next authorized step is a Windows-hosted v2 source build followed by
exact-bundle transfer and candidate inspection. Dynamic 90°/180°/270° product
rotation evidence must be captured on Windows 10/11 x64 Desktop by the Code G
R1B product path. This branch does not enter R1B, modify RenderPolicy, mutate
runtime v1, or approve a v2 artifact without those exact bytes and evidence.

```text
FIRST_ACTUAL_BLOCKER:
V2_CANDIDATE_NOT_YET_PRODUCED; WINDOWS_11_DESKTOP_ROTATION_EVIDENCE_PENDING
```
