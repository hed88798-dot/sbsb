# Code F FFmpeg Render Runtime Intake Report

Status: `BLOCKED`

This report records the intake checkpoint from frozen `main`. It does not approve an
FFmpeg Render artifact and does not authorize product Render or Electron packaging.

```text
CODE_F_FFMPEG_RENDER_RUNTIME_INTAKE:
BLOCKED

BASE:
36fce1bb446c10d1565d3614f2246257f35fa157

INTAKE_BRANCH:
code-f/ffmpeg-render-runtime-intake

CODE_G_CAPABILITY_PROFILE_FILE:
PRESENT_IN_WORKTREE_ONLY

CODE_G_CAPABILITY_PROFILE_COMMIT:
MISSING_NOT_COMMITTED

CODE_G_CAPABILITY_PROFILE_HASH:
e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910

CODE_G_CAPABILITY_PROFILE_HASH_RECOMPUTED:
PASS

CAPABILITY_PROFILE_BINDING:
BLOCKED

FIRST_ACTUAL_BLOCKER:
CODE_G_EXACT_FFMPEG_REQUIRED_CAPABILITY_PROFILE_NOT_YET_PUBLISHED
```

## Existing source and governance inputs

The repository contains an existing FFmpeg 9.0.1 source/pin and release-security intake for
the separately approved ffprobe lineage. These records are reusable governance inputs only;
they do not approve an FFmpeg Render executable.

```text
FFMPEG_SOURCE_VERSION:
9.0.1 (source candidate; not a Render artifact approval)

FFMPEG_RELEASE_TAG:
n9.0.1

FFMPEG_RELEASE_COMMIT:
bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa

FFMPEG_SOURCE_ARCHIVE:
ffmpeg-9.0.1.tar.xz

FFMPEG_SOURCE_HASH:
cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635

FFMPEG_RELEASE_SECURITY_INTAKE:
PASS (existing release-level intake; exact Render binary review still required)

FFPROBE_PROFILE_REUSED_AS_RENDER_PROFILE:
NO
```

## Render artifact status

No FFmpeg Render source build, prebuilt binary download, platform artifact, runtime closure,
license review, vulnerability review, SBOM/NOTICE binding, or standalone smoke was performed.
The exact Code G profile is required before freezing a separate Render Build Profile.

```text
FFMPEG_RENDER_BUILD_PROFILE_HASH:
NOT_AVAILABLE_PENDING_CODE_G_CAPABILITY_PROFILE

GPL:
NOT_EVALUATED_PENDING_EXACT_RENDER_BUILD

NONFREE:
NOT_EVALUATED_PENDING_EXACT_RENDER_BUILD

LIBX264:
NOT_EVALUATED_PENDING_EXACT_RENDER_BUILD

LIBX265:
NOT_EVALUATED_PENDING_EXACT_RENDER_BUILD

WINDOWS_H264_ENCODER:
NOT_EVALUATED_PENDING_CODE_G_PROFILE

WINDOWS_AAC_ENCODER:
NOT_EVALUATED_PENDING_CODE_G_PROFILE

WINDOWS_MP4_MUX:
NOT_EVALUATED_PENDING_CODE_G_PROFILE

NETWORK_SURFACE:
NOT_EVALUATED_PENDING_EXACT_BUILD

REQUIRED_CAPABILITIES:
BLOCKED_PENDING_CODE_G_PROFILE

FORBIDDEN_CAPABILITIES:
BLOCKED_PENDING_CODE_G_PROFILE

WINDOWS_ARTIFACT:
BLOCKED

WINDOWS_ENTRYPOINT_SHA256:
NOT_AVAILABLE

WINDOWS_RUNTIME_CLOSURE:
NOT_RUN

WINDOWS_STANDALONE_SMOKE:
NOT_RUN

MACOS_DEV_ARTIFACT:
DEFERRED_WITH_REASON: exact Code G profile is missing; macOS cannot substitute for Windows

MACOS_DEV_ENTRYPOINT_SHA256:
NOT_AVAILABLE

LICENSE_REVIEW:
BLOCKED_PENDING_EXACT_RENDER_ARTIFACT

VULNERABILITY_REVIEW:
BLOCKED_PENDING_EXACT_RENDER_ARTIFACT

PROVENANCE:
BLOCKED_PENDING_PROFILE_AND_BUILD

SBOM_NOTICE_BINDING:
BLOCKED_PENDING_EXACT_MEMBER_SET

ARTIFACT_RETENTION:
NOT_STARTED

ELECTRON_PACKAGED_INTEGRATION:
NOT_RUN

CODE_G_PRODUCT_RENDER:
NOT_RUN
```

## Scope and next action

No Code C/D/E semantics, Render business fields, packaging files, or historical compliance
bytes were changed. No new production dependency was introduced. The profile currently present
in the worktree is not treated as authority until Code G publishes it as an exact repository
commit and supplies that commit SHA. The intake remains open until Code G publishes:

```text
docs/render/ffmpeg-required-capability-profile.v1.json
CAPABILITY_PROFILE_COMMIT
CAPABILITY_PROFILE_HASH
```

After that exact profile is available, Code F must bind a distinct Render Build Profile,
produce platform-specific source-built candidates, and run the independent provenance,
license, vulnerability, capability, runtime-closure, and retention gates.

```text
RECOMMENDATION:
KEEP_FFMPEG_INTAKE_OPEN
```
