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
PENDING_FOLLOW_UP_REPORT_COMMIT
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
code-f-ffmpeg-render-windows-x86_64-34694993762

FFMPEG_V2_SHA256:
7af11afbae14889700ffaf70e72748c198a8448f68ced40f82a44fe806798477

FFPROBE_V2_SHA256:
2f0bf1a542266b58b35c41b09e1feaa3a61f5a75fa22ea2364f19d2a9d0ca0e6

MANIFEST_V2_SHA256:
c3184e86cc229d7eecf8407e103cd93047a6f148824aede3ddd59591aed31efa

MANIFEST_V2_FILE_SHA256:
55e588ba8f1ba0ac8daed1fbbf52af58c0dc454c1091874798d304310f962098

RUNTIME_IDENTITY_V2_SHA256:
b13500811d7b02e651128477165959e57513060a723af1dd0a5dc91c23ad3de6

RUNTIME_V2_ZIP_SHA256:
30c64106f38a354962d31931502947f769cf61b6aa99a601088a5e7c8071341b

TRANSIENT_ARTIFACT_ID:
10298224954

TRANSIENT_ARTIFACT_SIZE_BYTES:
9909206

TRANSIENT_ARTIFACT_DIGEST_SCOPE:
GitHub Actions artifact ZIP bytes

BUILD_SOURCE_COMMIT:
514158af2f015a809b4b31577f17d85a5fb85b0c

BUILD_CONTEXT_SHA256:
244e8a69f957555208fe9e8cc2dc9d8352f4ae33bd05d6e7c1802327268ca355

BUILD_RECIPE_SHA256:
d432e534c8b877d0999d6f451101090bd73d1af79ae557a5c5b22f423714ac65

ENVIRONMENT_DESCRIPTOR_SHA256:
0c3c7c13487592d0896ee88bb8892a09dc4ece290f548bd4234fd18ce130a06d

TRANSFER_MANIFEST_SHA256:
8d681973f9ca5d7b01c8d937c0b88986ce5a4dbfce21e9d6bd30e02e2d3e2089

TRANSPORT_TAR_SHA256:
4488cb0c09796b1bf22851854499ee07f77f84f0e6cc1db18829e1decbe4fd6a

STATIC_CAPABILITY_EVIDENCE_SHA256:
7e1b557410029c28affd4bdbd54bc49b90eb8850a7616ab31210d06d2dd173cb

RUNTIME_CLOSURE_EVIDENCE_SHA256:
5a6669b5ad25730ca729a106fb10b2f1e438f421f8dce0edb7f086da2abd0ee0

LICENSE_EVIDENCE_SHA256:
854cf507e7e7274ba27f06cd2e24261b16e2a2ec4999c3041cf794b83ee80da1

VULNERABILITY_EVIDENCE_SHA256:
23066242f13a900cef8a1522f44b002fb8a22caeef68ce850c971dcee88e77c0

SBOM_SHA256:
53b72be30825ab73577f942b6445a6a3151c14abaf622f5d8ac15bfcb5a9b307

NOTICE_SHA256:
a8681de44d640b422cb0b5655dfedf1f503a1e2a0058c6fe9afc35782ac7a91f

ENTRYPOINT_HASH_EVIDENCE_SHA256:
c2735248d777fb3fd2ee55a749e366f60c6e7c3cab88968d1afba75bc85d35fe

DURABLE_ARTIFACT_LOGICAL_LOCATOR:
frozen-candidates/code-f-ffmpeg-render-windows-x86_64-34694993762/windows/

STATIC_TRANSPOSE:
PASS

STATIC_HFLIP:
PASS

STATIC_VFLIP:
PASS

STATIC_ROTATE:
PASS

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
PASS

LICENSE:
PASS

VULNERABILITY:
PASS

SBOM_NOTICE:
PASS

DURABLE_ARTIFACT:
PASS — local Mac project-folder retention and hash verification

APPROVAL_RECEIPT_HASH:
NOT_YET_PRODUCED — v2 Desktop rotation approval is intentionally not issued

CI:
PASS — CI run 34694993711

WINDOWS_11_RUNTIME_V2_HARNESS:
NOT_READY — no authorized R1B product-path rotation harness run

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
WINDOWS_11_DESKTOP_ROTATION_EVIDENCE_PENDING; approval receipt intentionally not issued
```
