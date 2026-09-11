# Code F — FFmpeg Render Runtime Intake Report

This report records the exact Windows 11 Desktop evidence for the FFmpeg
Render runtime intake. The Server 2022 failure is retained as historical
environment-specific evidence only; it is not the product approval gate.
No Electron integration or Code G product Render was run.

```text
CODE_F_FFMPEG_RENDER_RUNTIME_INTAKE:
PASS

BASE:
36fce1bb446c10d1565d3614f2246257f35fa157

INTAKE_BRANCH:
code-f/ffmpeg-render-runtime-intake

INTAKE_HEAD_TESTED:
bece1b9e590cbfe868e7118f098375659187a003

PR:
51 (open; no merge to main)
```

## Authority and source binding

```text
CODE_G_CAPABILITY_PROFILE_FILE:
docs/render/ffmpeg-required-capability-profile.v1.json

CODE_G_SOURCE_PROFILE_COMMIT:
3a212342b573d0f785c0bb9be91cb8a8bad0a113

CODE_G_IMPORTED_VENDORED_SNAPSHOT_COMMIT:
9cc2326bf5059290f1a8498d0683e7e7d6f3bf9d (historical F snapshot only)

CODE_G_PROFILE_HASH:
e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910

CODE_G_PROFILE_FILE_SHA256:
4352c73c432a0bbf37a4937267b7785d1fac9c8fe55fab99fb6e7a09ccb9e8c6

CAPABILITY_PROFILE_BINDING:
PASS

FFMPEG_RENDER_BUILD_PROFILE:
compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_BUILD_PROFILE_V1.json

FFMPEG_RENDER_BUILD_PROFILE_HASH:
8a8c032009beb90f57ba6a48f6bdb8d01ddf67b2c372c16795e1729c016e57ff

FFMPEG_RENDER_BUILD_PROFILE_SELF_HASH_VERIFICATION:
PASS

PROFILE_SEMANTICS_CHANGED:
NO
```

The Render build is a separate profile. It is pinned to FFmpeg 9.0.1, source
archive SHA-256 `cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635`,
and the MSYS2 UCRT64 toolchain recorded in the build records. GPL, nonfree,
`libx264`, and `libx265` are disabled; only the approved local `file` and
controlled progress `pipe` protocols are enabled.

## Exact candidate and manual-binary binding

```text
CONTROLLED_WORKFLOW_RUN:
34529358057

CONTROLLED_BUILD_SOURCE_COMMIT:
75d929d7862bbc9af3d3010b4618351e63ce00be

TRANSIENT_ARTIFACT_ID:
10173207193

TRANSIENT_ARTIFACT_NAME:
ffmpeg-render-windows-75d929d7862bbc9af3d3010b4618351e63ce00be

TRANSIENT_ARTIFACT_SIZE_BYTES:
9897497

TRANSIENT_ARTIFACT_ZIP_SHA256:
5aba48f781f56165eb5cf623eb067fc745bfbc50b9c80cfb8b7430651b4d9dbd

TRANSPORT_TAR_SHA256:
97a427f59ca34b4d67c667ccf7792f4006819de06b811f0e753577cad115d28b

CANDIDATE_MANIFEST_SHA256:
d01be7ca70d541b5f1bee788a823634dd4c6883aa483c95b52c7bef10214cbaf

RUNTIME_IDENTITY_SHA256:
30c50b522998bc3d0d733988b20cdb415b0ccf823ee716b99446e53db14c967e

RETENTION_LOCATOR:
frozen-candidates/code-f-ffmpeg-render-windows-75d929d7862bbc9af3d3010b4618351e63ce00be/windows/

MANUAL_FFMPEG_SHA256:
4ca74875cd4a8f458b21db6834ece1351f72307bd9acdfd9ccae11b26029b4a8

CONTROLLED_BUNDLE_FFMPEG_SHA256:
4ca74875cd4a8f458b21db6834ece1351f72307bd9acdfd9ccae11b26029b4a8

MANUAL_FFPROBE_SHA256:
ffacd628c9936b1988f7a3e8be168d3839a5b57cf12bacfd1098fdea64268b35

CONTROLLED_BUNDLE_FFPROBE_SHA256:
ffacd628c9936b1988f7a3e8be168d3839a5b57cf12bacfd1098fdea64268b35

MANUAL_DESKTOP_BINARY_HASH_BINDING:
PASS

CANDIDATE_MANIFEST_BINDING:
PASS — manifest reconstructed from the exact transferred bundle and build records; no binary bytes changed
```

All eight bundle member hashes are recorded in the manifest and the retained
`evidence/bundle-members.sha256` inventory. The local recovery copy passed the
same manifest and member-hash verification.

## Final approval receipt and durable retrieval

The machine-readable approval receipt is
`compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_RUNTIME_APPROVAL_V1.json`.
Its exact SHA-256 is
`ab84da87dd35f3abdbcb4438edad82d9e5327b503dc00f9fab7db80b42cb8971`.
The receipt binds the approved candidate, the Windows 11 Desktop evidence
identity, runtime closure, license/vulnerability/SBOM records, and the durable
candidate locator. The original build profile remains unchanged; its
`FFMPEG_RENDER_BUILD_PROFILE_V1.artifact_status` is
`HISTORICAL_PROFILE_CREATION_STATE / NOT_FINAL_APPROVAL_AUTHORITY` and is not
the final approval authority.

```text
FFMPEG_RENDER_RUNTIME_APPROVAL:
APPROVED

APPROVAL_RECEIPT_SHA256:
f0ee056d79ce68be7a3f7cbd9e0b52b31b7865fc38632f62bacbe576d5318175

DURABLE_ARTIFACT_LOCATOR:
cold-archive://frozen-candidates/code-f-ffmpeg-render-windows-75d929d7862bbc9af3d3010b4618351e63ce00be/windows/ffmpeg-render-windows-75d929d7862bbc9af3d3010b4618351e63ce00be.zip

DURABLE_ARTIFACT_SHA256:
5aba48f781f56165eb5cf623eb067fc745bfbc50b9c80cfb8b7430651b4d9dbd

MAC_RECOVERY_COPY:
frozen-candidates/code-f-ffmpeg-render-windows-75d929d7862bbc9af3d3010b4618351e63ce00be/windows/

RETRIEVAL_CONTRACT:
CONTROLLED_TRANSFER_THEN_SHA256_VERIFY
```

The durable locator is the retained Mac project-folder archive; future R1B/CI
must retrieve that exact ZIP through the controlled transfer path and verify the
recorded digest before use. GitHub Actions remains transport-only and is not the
final retention authority.

## Hosted workflow responsibility boundary

```text
HOSTED_SERVER_WORKFLOW_SEMANTICS:
BUILD_AND_STATIC_GOVERNANCE_ONLY

WINDOWS_SERVER_DYNAMIC_H264_PRODUCT_GATE:
NOT_RUN

WINDOWS_DESKTOP_H264_PRODUCT_GATE_AUTHORITY:
WINDOWS_11_DESKTOP_EVIDENCE
```

The `windows-2022` job still performs the exact source build, static capability
inventory, profile/provenance binding, manifest, runtime closure, license,
vulnerability, SBOM/NOTICE, and transient transport upload. Its static
capability record explicitly reports the Desktop-only dynamic Media Foundation
smoke as `NOT_RUN_SERVER_ENVIRONMENT`; it cannot manufacture a Desktop PASS.

## Windows 11 Desktop environment

```text
ENVIRONMENT_PROVIDER:
Alibaba Cloud Wuying Desktop

WINDOWS_DESKTOP_ENVIRONMENT:
PASS

WINDOWS_PRODUCT_NAME:
Microsoft Windows 11 Pro

WINDOWS_VERSION:
10.0.22631

WINDOWS_BUILD:
22631

WINDOWS_ARCH:
x64 / 64-bit

CPU:
AMD EPYC 9T24 96-Core Processor

DISPLAY_ADAPTER_1:
AspDod controller

DISPLAY_DRIVER_1:
10.32.40.381

DISPLAY_ADAPTER_2:
AspIdd controller

DISPLAY_DRIVER_2:
20.36.39.137

SESSION_CONTEXT:
RDP-backed Wuying Desktop; interactive console session running
```

The machine-readable record is retained with the exact candidate evidence at
`frozen-candidates/code-f-ffmpeg-render-windows-75d929d7862bbc9af3d3010b4618351e63ce00be/windows/evidence/`.
The repository records only logical locators and hashes so the full candidate
and its manually captured Desktop evidence remain outside Git.

## Historical Server evidence

```text
WINDOWS_SERVER_2022_PRODUCT_APPROVAL:
NO

SERVER_FAILURE_CLASSIFICATION:
HISTORICAL_ENVIRONMENT_SPECIFIC_FAILURE

SERVER_ERROR:
MF_E_INVALIDMEDIATYPE

WINDOWS_11_DESKTOP_PRODUCT_GATE:
ACTIVE

MF_E_INVALIDMEDIATYPE_ON_WINDOWS_11:
NOT_REPRODUCED
```

The Server 2022/2019 result is not used to block the Windows Desktop product
gate and did not trigger an encoder change.

## Windows 11 Desktop capability smoke

All tests consumed the exact retained bundle above; no PATH lookup, system
FFmpeg, random download, or second build was used.

```text
WINDOWS_11_DESKTOP_EXECUTION:
PASS

WINDOWS_11_H264_MF_MINIMAL:
PASS — raw NV12 1280x720, 30 fps, 1 second; H264 Encoder MFT; 30 frames; 1.00 s

WINDOWS_11_H264_MF_1080X1920_30:
PASS

NV12_INPUT:
PASS

SCALE:
PASS — scale=1080:1920

SAR_NORMALIZATION:
PASS — setsar=1; ffprobe SAR 1:1

FPS_NORMALIZATION:
PASS — 30 fps; ffprobe 30/1; 30 frames

H264_ENCODER:
PASS — h264_mf

AAC:
PASS — AAC-LC, 48000 Hz, stereo, 192 kb/s

H264_AAC_MP4_MUX:
PASS

FFPROBE_VERIFY:
PASS — h264 1080x1920 yuv420p and aac 48000 Hz stereo, 1.000000 s

MACHINE_READABLE_PROGRESS:
PASS — -progress pipe:1 -nostats; progress=end

DUP_FRAMES:
0

DROP_FRAMES:
0

CANCELLATION_PRIMITIVE:
PASS — controlled termination primitive available; no product Render run
```

The `yuv420p` decoded H.264 pixel format reported by ffprobe is expected and
does not invalidate the NV12 Media Foundation input test. The exact manual
commands and observed output are captured in the retained desktop evidence
record.

## Runtime closure and negative controls

Static PE import reconciliation found six internal bundle DLLs, seventeen
allowlisted Windows OS imports, and zero unresolved imports. Execution was from
the flat app-local bundle, not from `PATH` or the current working directory.

```text
RUNTIME_CLOSURE:
PASS — internal=6; external OS allowlist=17; unresolved=0

LOADER_POLICY:
PASS — APP_LOCAL_SAME_DIRECTORY_V1 / COMPANION_BUNDLE_ONLY

NEGATIVE_CONTROLS:
PASS

WRONG_BINARY_HASH_REJECTED:
PASS

MODIFIED_RUNTIME_MEMBER_REJECTED:
PASS

MISSING_RUNTIME_MEMBER_REJECTED:
PASS

WRONG_BUILD_PROFILE_HASH_REJECTED:
PASS

PATH_DECOY_NOT_SELECTED:
PASS — explicit bundled locator; system PATH fallback=false

CWD_DECOY_NOT_SELECTED:
PASS — explicit bundled locator; system PATH fallback=false

NETWORK_SURFACE:
PASS — network disabled; file + controlled progress pipe only

FORBIDDEN_COMPONENTS:
PASS — GPL/nonfree/libx264/libx265 absent
```

The negative controls were replayed against a temporary recovery copy and the
exact retained bundle. Two verifier defects found during this replay were
corrected in the intake branch: CLI pair parsing and use of the function's
bundle argument when validating modified/missing members.

## License, vulnerability, SBOM/NOTICE, and retention

```text
LICENSE:
PASS — exact FFmpeg 9.0.1 source license evidence; LGPL-2.1-or-later; GPL/nonfree disabled

LICENSE_POLICY_DISPOSITION:
ALLOW_WITH_CONDITIONS

CODEC_PATENT_BOUNDARY:
RECORDED_SEPARATELY — H.264/AAC patent or codec-program obligations are not cleared by LGPL review

VULNERABILITY:
PASS — exact manifest/member set bound; zero blocking advisories in the approved release intake

SBOM_NOTICE:
PASS — CycloneDX SBOM and THIRD_PARTY_NOTICES bound to manifest/runtime identity

PROVENANCE:
PASS — source, profile, build context, recipe, environment, artifact, and member hashes bound

ARTIFACT_RETENTION:
PASS — local Mac project-folder retention plus recovery drill; no secondary permanent copy required

RECOVERY_DRILL:
PASS — recovered bundle hashes equal retained bundle hashes

WINDOWS_RUNTIME_ARTIFACT:
APPROVED
```

The retained logical root is
`frozen-candidates/code-f-ffmpeg-render-windows-75d929d7862bbc9af3d3010b4618351e63ce00be/windows/`.
The full binary bundle is not committed to Git; repository evidence contains
logical locators and exact hashes only.

## Scope and stop conditions

```text
GPL:
DISABLED

NONFREE:
DISABLED

LIBX264:
NOT_INCLUDED

LIBX265:
NOT_INCLUDED

SUBTITLE:
OFF

SOURCE_VIDEO_AUDIO:
DROP

BGM:
OFF

FALLBACK:
NOT_RENDERABLE

ELECTRON_PACKAGED_INTEGRATION:
NOT_RUN

CODE_G_PRODUCT_RENDER:
NOT_RUN

REAL_TIMELINE_RENDER:
NOT_RUN

CODE_G_R1B:
NOT_STARTED

CODE_C_SEMANTICS_CHANGED:
NO

CODE_D_SEMANTICS_CHANGED:
NO

CODE_E_SEMANTICS_CHANGED:
NO

NEW_PRODUCTION_DEPENDENCIES:
NONE
```

```text
FIRST_ACTUAL_BLOCKER:
NONE

RECOMMENDATION:
READY_TO_JOIN_CODE_G_R1A
```

This intake stops here. It does not merge `main`, modify Code G, change the
encoder architecture, or start R1B. Code G R1A remains an independent review
authority.
