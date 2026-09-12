# Code F — FFmpeg Render Runtime v2 Intake

This is a forward, rotation-capable intake. Runtime v1 remains an historical
approval and is not mutated or revoked. A Windows v2 candidate was built by
the hosted static-intake workflow and independently inspected. Static,
provenance, closure, license, vulnerability, SBOM, and retention gates pass;
only the Windows 11 Desktop dynamic rotation evidence remains pending.

```text
CODE_F_RUNTIME_V2_INTAKE:
PENDING_WINDOWS_11_DESKTOP_ROTATION_EVIDENCE

BRANCH:
code-f/ffmpeg-render-runtime-v2-intake

BASE:
ebe411df646504d43162af3c8a588f42e633bd39

FINAL_COMMIT:
3455bb655e1f32748665ed5ed475bd2733512cba
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
code-f-ffmpeg-render-windows-x86_64-34695738218

FFMPEG_V2_SHA256:
68cd3efc374a3db49d3b3d69f81e1dd87819fc611fba71b5eb70758741720c99

FFPROBE_V2_SHA256:
876d06b87d7a7932d41ec239be67272b6585320cad2d3085a55a58391163b0c7

MANIFEST_V2_SHA256:
1ad0b6fd56eb01ab650346c97c09ec15a8212b296ad57ef284ef32898421d151

MANIFEST_V2_FILE_SHA256:
94782c814e5691cddf81ca231403e336310163519aaf0686745364b8b1742cf7

RUNTIME_IDENTITY_V2_SHA256:
11a92136b9145bb2286cb653fdbd6a815db434999814b2bad187d38fd2aa3528

RUNTIME_V2_ZIP_SHA256:
0403ca51bb04a428aa7a354ae8a3b5f39a315537997948c1811da3997b967812

TRANSIENT_ARTIFACT_ID:
10298836491

TRANSIENT_ARTIFACT_SIZE_BYTES:
9909277

TRANSIENT_ARTIFACT_DIGEST_SCOPE:
GitHub Actions artifact ZIP bytes

BUILD_SOURCE_COMMIT:
204f9732d35756531d92d369a83a555479d79e25

BUILD_CONTEXT_SHA256:
2b9c5dc7e06a726738a91208351fe0ebcdbb83d8c099708530a0e7c6d99dc4a9

BUILD_RECIPE_SHA256:
3217ed84767617629fec2fe5b88cc76b38eb0c31f44d6f70ea5c3235fc0344fe

ENVIRONMENT_DESCRIPTOR_SHA256:
377e13ec7913ec77b9783e07910df713300654de52ea37393af1712f71e5ed18

TRANSFER_MANIFEST_SHA256:
f6fa4c60d8fdd7cde80ffe961e022e705f4f9af9f5d448565a4b86264d7964ac

TRANSPORT_TAR_SHA256:
8f5ec1d0b86a867e0fa2002aedfbc052fc3c3f89d9e74e73ec6861cc787bd160

STATIC_CAPABILITY_EVIDENCE_SHA256:
7e1b557410029c28affd4bdbd54bc49b90eb8850a7616ab31210d06d2dd173cb

RUNTIME_CLOSURE_EVIDENCE_SHA256:
5a889b0e45d632a2951bec6e205e54a9e24ebc56da255d10b6f5a48d2da29ab6

LICENSE_EVIDENCE_SHA256:
e4c8a5750db45b42d17dd04bff433e23c57c1c04c4cd77ab7654140707f3ae71

VULNERABILITY_EVIDENCE_SHA256:
5baec5b0e1f29d16d5b39e561b11e8b83570f975dfe485ea9237bbedf77aa30a

SBOM_SHA256:
9311eb209784ec006a403e952c6af6e5597a5ee2cd7acb662928b3b7fa6b08e8

NOTICE_SHA256:
b8aaa2763cca0aa31ec61aee2fc710ae74389bd6ba4b5480dd9213795801353f

ENTRYPOINT_HASH_EVIDENCE_SHA256:
5fc8718d54e35ec8f629e2edee5387898aa2639be9cd7820b5e451acf9c208d8

DURABLE_ARTIFACT_LOGICAL_LOCATOR:
frozen-candidates/code-f-ffmpeg-render-windows-x86_64-34695738218/windows/

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
PASS — CI run 34695738227; V2 static intake run 34695738218

WINDOWS_11_RUNTIME_V2_HARNESS:
NOT_READY — no authorized R1B product-path rotation harness run

CODE_G_R1B_PRODUCT_ROTATION_GATE:
NOT_RUN

MAIN_MERGE:
NO
```

## Stop condition

The next authorized step is Windows 10/11 x64 Desktop dynamic 90°/180°/270°
product rotation evidence captured by the Code G R1B product path. The hosted
candidate has already passed static intake and exact-bundle inspection. This branch does not enter R1B, modify RenderPolicy, mutate runtime v1, or approve a v2 artifact without those exact bytes and evidence.

```text
FIRST_ACTUAL_BLOCKER:
WINDOWS_11_DESKTOP_ROTATION_EVIDENCE_PENDING; approval receipt intentionally not issued
```
