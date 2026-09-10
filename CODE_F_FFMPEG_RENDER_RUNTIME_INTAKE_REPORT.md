# Code F — FFmpeg Render Runtime Intake Report

This is the Code F intake checkpoint from the frozen `main` baseline. It is a
fail-closed report: the Windows Render runtime is **not approved** because the
required H.264 Media Foundation standalone smoke failed on the only execution
environment used. No product Render, Electron packaging, or business-semantic
change is authorized by this report.

```text
CODE_F_FFMPEG_RENDER_RUNTIME_INTAKE:
BLOCKED

BASE:
36fce1bb446c10d1565d3614f2246257f35fa157

INTAKE_BRANCH:
code-f/ffmpeg-render-runtime-intake

INTAKE_HEAD_TESTED:
89d5aed6dc0bfaed0c4f914e55169ca549a45aaa

PR:
51 (open; no merge to main)
```

## Authority bindings

Code G's exact capability profile is committed and self-hash verified. The
Render build profile is a separate, versioned profile; the existing ffprobe
profile was not reused as Render approval.

```text
CODE_G_CAPABILITY_PROFILE_FILE:
docs/render/ffmpeg-required-capability-profile.v1.json

CODE_G_CAPABILITY_PROFILE_COMMIT:
3a212342b573d0f785c0bb9be91cb8a8bad0a113

CODE_G_IMPORTED_VENDORED_SNAPSHOT_COMMIT:
9cc2326bf5059290f1a8498d0683e7e7d6f3bf9d (historical F-branch snapshot only)

CODE_G_CAPABILITY_PROFILE_HASH:
e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910

CODE_G_CAPABILITY_PROFILE_FILE_SHA256:
4352c73c432a0bbf37a4937267b7785d1fac9c8fe55fab99fb6e7a09ccb9e8c6

CAPABILITY_PROFILE_BINDING:
PASS

FFMPEG_RENDER_BUILD_PROFILE:
compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_BUILD_PROFILE_V1.json

FFMPEG_RENDER_BUILD_PROFILE_HASH:
8a8c032009beb90f57ba6a48f6bdb8d01ddf67b2c372c16795e1729c016e57ff

FFMPEG_RENDER_BUILD_PROFILE_SELF_HASH_VERIFICATION:
PASS

SOURCE_BUILD_PROFILE_SEMANTICS:
SEPARATE_FROM_FFPROBE
```

The prior profile identity `5882b57077b414fd9bd37d5486c3afdfddb884fad10e4dc83d98def5120875eb`
and its associated candidate/status remain historical evidence only. They are not an approved
candidate after this source-provenance rebind.

## Source, build, and security policy

The candidate is source-built from the pinned FFmpeg release. The profile
keeps GPL, nonfree, `libx264`, and `libx265` disabled and permits only the
profile's local `file`/controlled `pipe` protocols. No floating binary,
system-PATH lookup, prebuilt npm/brew binary, or random user-installed FFmpeg
is used.

```text
FFMPEG_SOURCE_VERSION:
9.0.1

FFMPEG_RELEASE_TAG:
n9.0.1

FFMPEG_RELEASE_COMMIT:
bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa

FFMPEG_SOURCE_ARCHIVE:
ffmpeg-9.0.1.tar.xz

FFMPEG_SOURCE_HASH:
cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635

GPL:
DISABLED

NONFREE:
DISABLED

LIBX264:
NOT_INCLUDED

LIBX265:
NOT_INCLUDED

NETWORK_SURFACE:
DISABLED; file + controlled progress pipe only

RUNTIME_LAYOUT:
EXPLICIT_APP_LOCAL_BUNDLE; PATH/registry/user discovery forbidden

BUILD_PROFILE_AND_SOURCE_BINDING:
PASS
```

The Windows source build reached compile/install completion. Profile
verification, exact MSYS2 UCRT64 toolchain preflight, and the pinned source
hash checks passed before the runtime smoke stopped the job.

```text
WINDOWS_BUILD_ENVIRONMENT:
GitHub-hosted windows-2022

WINDOWS_RUNNER_OS:
Microsoft Windows Server 2022 (10.0.20348, Datacenter)

WINDOWS_WORKFLOW_RUN:
34516681254

WINDOWS_BUILD_JOB:
103003708833

WINDOWS_PROFILE_VERIFIER:
PASS

WINDOWS_TOOLCHAIN_PREFLIGHT:
PASS

WINDOWS_SOURCE_BUILD_COMPILE_INSTALL:
PASS
```

## First actual blocker — Windows H.264 Media Foundation

The required capability smoke supplied a controlled raw-video fixture and
invoked the exact profile path (`NV12` input, `h264_mf`, MP4 output and
machine-readable progress). It failed before producing an encoded stream:

```text
FFMPEG_RENDER_CAPABILITY_SMOKE:
FAIL

ERROR:
[h264_mf] could not set output type (MF_E_INVALIDMEDIATYPE)

FFMPEG_RENDER_CAPABILITY_SMOKE_RESULT:
H.264 Media Foundation encode failed

WINDOWS_H264_ENCODER:
BLOCKED — actual encode not demonstrated

WINDOWS_AAC_ENCODER:
NOT_REACHED

WINDOWS_MP4_MUX:
NOT_REACHED

FIRST_ACTUAL_BLOCKER:
The GitHub-hosted windows-2022 job runs Windows Server 2022 and cannot establish
the required h264_mf output type. The Microsoft H.264 encoder reference lists
Windows desktop apps as the supported client and “None supported” for the
minimum supported server; this is consistent with the observed
MF_E_INVALIDMEDIATYPE, but the CI evidence itself remains the binding failure.
```

This is a hard gate. The failure is not worked around with `libx264`, a GPL
build, a prebuilt binary, or a claim based only on `ffmpeg -encoders`. An
approved Windows 10/11 desktop-capable execution environment (or an explicit
architecture decision that preserves the frozen Code G profile) is required
before this intake can proceed. A macOS result cannot substitute for the
Windows product runtime.

## Capability and negative-control status

The verifier and smoke implement the Code G binding and fail-closed negative
controls. Controls that require a completed approved candidate could not be
promoted to PASS after the H.264 stop.

```text
REQUIRED_CAPABILITIES:
FAIL — h264_mf actual encode unavailable; downstream AAC/MP4 verification not reached

FORBIDDEN_CAPABILITIES:
PASS — profile/configuration rejects GPL, nonfree, libx264/libx265 and network protocols

NETWORK_PROTOCOL_RESTRICTION:
PASS (configuration/profile verification)

WRONG_PROFILE_HASH_REJECTED:
PASS (verifier coverage)

WRONG_BINARY_HASH_REJECTED:
NOT_RUN — no approved candidate produced

MODIFIED_MEMBER_REJECTED:
NOT_RUN — no approved candidate produced

MISSING_MEMBER_REJECTED:
NOT_RUN — no approved candidate produced

PATH_DECOY_NOT_CONSUMED:
NOT_REACHED — smoke stopped at required encoder

CWD_DECOY_NOT_CONSUMED:
NOT_REACHED — smoke stopped at required encoder

UNSUPPORTED_CAPABILITY_FAILS:
NOT_REACHED — smoke stopped at required encoder
```

The workflow did upload a transient transport archive after the failing build
step. That archive is evidence/transport only, not a distribution approval or
frozen candidate:

```text
TRANSIENT_TRANSPORT_ARTIFACT:
ffmpeg-render-windows-7c67f1dd242303d617caaf2a9c24c02f87b7e622

ARTIFACT_ID:
10168328676

ARTIFACT_SIZE_BYTES:
9897517

ARTIFACT_ZIP_SHA256:
8b6c21c95a4b4cc624823f9174138fbcf4a113e4c30c6d9b7d1301fda3165512

ARTIFACT_ROLE:
TRANSIENT_EVIDENCE_ONLY; NOT AN APPROVED RENDER CANDIDATE
```

## Approval gates not reached

Because the hard Windows capability gate failed, the exact final member set
was not approved and later gates were not allowed to manufacture a PASS.

```text
WINDOWS_ARTIFACT:
BLOCKED

WINDOWS_ENTRYPOINT_SHA256:
NOT_AVAILABLE_AS_APPROVED_ARTIFACT

WINDOWS_RUNTIME_CLOSURE:
NOT_RUN_TO_APPROVAL

WINDOWS_STANDALONE_SMOKE:
FAIL

LICENSE_REVIEW:
NOT_RUN — exact successful Render member set unavailable

VULNERABILITY_REVIEW:
NOT_RUN — exact successful Render member set unavailable

PROVENANCE:
PARTIAL — source/profile/toolchain provenance captured; final candidate not approved

SBOM_NOTICE_BINDING:
NOT_RUN — exact distributable member set unavailable

ARTIFACT_RETENTION:
NOT_FROZEN — transient CI evidence only

MACOS_DEV_ARTIFACT:
DEFERRED_WITH_REASON: Windows hard gate unresolved; macOS cannot substitute

MACOS_DEV_ENTRYPOINT_SHA256:
NOT_AVAILABLE
```

The following remain explicitly out of scope for this intake:

```text
ELECTRON_PACKAGED_INTEGRATION:
NOT_RUN

CODE_G_PRODUCT_RENDER:
NOT_RUN

PRODUCT_RENDER:
NOT_RUN
```

## Scope integrity

No Code C/D/E semantics, RenderPolicy fields, Timeline entries, narration
logic, fallback behavior, Digital Human logic, packaging wiring, dependency
upgrade, Worker rebuild outside this intake, or historical compliance bytes
were changed. No main merge was performed.

```text
CODE_C_SEMANTICS_CHANGED:
NO

CODE_D_SEMANTICS_CHANGED:
NO

CODE_E_SEMANTICS_CHANGED:
NO

NEW_PRODUCTION_DEPENDENCIES:
NONE

WORKER_REBUILD:
NO (business Worker; FFmpeg source build only)
```

## Recommendation

```text
RECOMMENDATION:
KEEP_FFMPEG_INTAKE_OPEN

NEXT_REQUIRED_ACTION:
Provide an approved Windows 10/11 desktop-capable execution environment (or
an explicitly reviewed profile/architecture change), then rerun the exact
Windows source build and all downstream gates. Do not promote the current
transport archive, switch encoders, or start Code G product Render.

CODE_G_R1A:
INDEPENDENT / NOT REPLACED BY THIS REPORT
```

The Microsoft reference used for the environment assessment documents the
accepted input/output media types and the Windows desktop/server support
boundary: <https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder>.
