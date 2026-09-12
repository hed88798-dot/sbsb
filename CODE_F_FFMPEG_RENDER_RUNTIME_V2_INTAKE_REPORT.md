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
8123bc798a91b77fc9d231de0a826d34ba2cdd18

PRE_WINDOWS_BRANCH_HEAD:
4cf1f152d84ef55e6b4f307eef0e100b066bc218

SELECTED_CANDIDATE_SOURCE_HEAD:
9ac58acd952fbb6f2f901e7fd401e8bfaf696727

HARNESS_VALIDATION_COMMIT:
4cf1f152d84ef55e6b4f307eef0e100b066bc218
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
code-f-ffmpeg-render-windows-x86_64-34699695106

CANDIDATE_ID:
code-f-ffmpeg-render-windows-9ac58acd952fbb6f2f901e7fd401e8bfaf696727-34699695106

SELECTED_CANDIDATE_SOURCE_HEAD:
9ac58acd952fbb6f2f901e7fd401e8bfaf696727

SELECTED_CANDIDATE_SOURCE_TREE:
6db4cd7304618af930e2e48f34b715de4c7eb24d

SOURCE_WORKFLOW_RUN_ID:
34699695106

PR_SYNTHETIC_MERGE_SHA:
NOT_RETAINED_AS_AUTHORITY — ephemeral PR merge context only

PR_SYNTHETIC_MERGE_ROLE:
CI_CONTEXT_ONLY

FFMPEG_V2_SHA256:
7fc910c87e37502f3ff1f7e56c0ee470d91597aece9cd873880ce3c477d0a933

FFPROBE_V2_SHA256:
641b8649c3d11702942a4b649d6ecee35231e04e09ce50a8d74b8c46b5295c4e

MANIFEST_V2_SHA256:
5e57ef59bdf1c3d8cf17966b100358f4a16b96edb6c7dc7857e9d85bf3f03205

MANIFEST_V2_FILE_SHA256:
95513b82f3e6c0544e90ad8e6d3dfb4e692e85183982354a0b80fb89e9b2de32

RUNTIME_IDENTITY_V2_SHA256:
9df0552354769ab18846e5031caa77488f2c0b2fd1c882a7587af06cc0e71db9

ACTIONS_ARTIFACT_ENVELOPE_SHA256:
a7118ff8d297e093a12e4550d05efbb50c14dc643a3a6e23c2d671614bfb5846

ACTIONS_ARTIFACT_ENVELOPE_DIGEST_SCOPE:
GitHub Actions generated ZIP bytes

TRANSIENT_ARTIFACT_ID:
10300266594

TRANSIENT_ARTIFACT_SIZE_BYTES:
9909417

TRANSIENT_ARTIFACT_DIGEST_SCOPE:
GitHub Actions artifact ZIP bytes

BUILD_SOURCE_COMMIT:
9ac58acd952fbb6f2f901e7fd401e8bfaf696727

BUILD_SOURCE_TREE_SHA:
6db4cd7304618af930e2e48f34b715de4c7eb24d

BUILD_CONTEXT_SHA256:
c2cdf21af30bfb9770c16b53268944f2291cfc7eee96ead2fe7d425b46b61ca0

BUILD_RECIPE_SHA256:
7698ec5d167999717accb8625a82361faa93865857bf10513d0a22fc2ee8349d

ENVIRONMENT_DESCRIPTOR_SHA256:
49f5c68bd735adf3cdaa8bf7bb8f42902591fd5cdba959b4205920735ea46f9c

TRANSFER_MANIFEST_SHA256:
e4e79e993bc73dbd340c7dc8f8910204ba7a9ab66c02741bb6ba2fad209d6329

RUNTIME_V2_TRANSPORT_TAR_SHA256:
a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01

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

DURABLE_ARTIFACT_CHANNEL:
PRIVATE_GITHUB_DRAFT_RELEASE_ASSET

DURABLE_RELEASE_ID:
387604810

DURABLE_RELEASE_TAG:
code-f-ffmpeg-render-v2-prewindows-9ac58ac-34699695106

DURABLE_ASSET_ID:
559437104

DURABLE_ASSET_NAME:
ffmpeg-render-windows-v2.tar

DURABLE_ARTIFACT_LOGICAL_LOCATOR:
https://github.com/hed88798-dot/sbsb/releases/download/untagged-f4d49c86902c16a07c31/ffmpeg-render-windows-v2.tar

DURABLE_ARTIFACT_SHA256:
a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01

DURABLE_RETRIEVAL_SHA256:
a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01

DURABLE_RETRIEVAL_VERIFICATION:
PASS — independent gh release download and sha256 verification

MAC_LOCAL_COPY_ROLE:
SECONDARY_RECOVERY_COPY

MAC_LOCAL_COPY_LOGICAL_LOCATOR:
frozen-candidates/code-f-ffmpeg-render-windows-9ac58acd952fbb6f2f901e7fd401e8bfaf696727-34699695106/windows/

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

The selected candidate is the only candidate built from the post-freeze
branch head. The Actions envelope hash above covers only the generated ZIP;
the runtime transport tar hash, manifest hash, runtime identity hash, and
entrypoint hashes each retain their own byte scope. The draft release is a
durable retention channel; the one-day Actions artifact is transport-only.

## Historical candidates

The following earlier hosted candidates are superseded and are not the
selected pre-Windows candidate:

```text
SUPERSEDED_RUNTIME_V2_ID:
code-f-ffmpeg-render-windows-x86_64-34695738218

SUPERSEDED_SOURCE_RUN:
34695738218

SUPERSEDED_REASON:
Replaced by the exact source-head candidate from 9ac58acd... / run 34699695106
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
PASS — private draft release asset, independently retrieved and hash verified

APPROVAL_RECEIPT_HASH:
NOT_YET_PRODUCED — v2 Desktop rotation approval is intentionally not issued

CI:
PASS — selected candidate validation: CI run 34701858275; Windows native smoke run 34701858274; V2 static intake run 34699695106; retention run 34700810486

WINDOWS_11_RUNTIME_V2_HARNESS:
READY — Runtime-level harness present; dynamic Desktop execution is pending

CODE_G_R1B_PRODUCT_ROTATION_GATE:
NOT_RUN

MAIN_MERGE:
NO
```

## Stop condition

The next authorized step is Code F Runtime-level Windows 11 Desktop rotation
harness execution against the selected exact candidate. This is not the Code G
R1B product path and does not constitute product Render testing. The hosted
candidate has already passed static intake and exact-bundle inspection. This
branch does not enter R1B, modify RenderPolicy, mutate runtime v1, or approve
a v2 artifact without the required Desktop evidence.

## Historical first Desktop attempt (preserved)

The first real Windows 11 Desktop attempt is retained as a failed harness
fixture-design observation. It did not reject or mutate the selected Runtime;
the same frozen `ffmpeg.exe` passed the independent 1280x720 NV12 / 30 fps /
30-frame `h264_mf` diagnostic on the same machine.

```text
WINDOWS_ATTEMPT_1:
FAIL_HARNESS_FIXTURE_INVALID_MEDIA_TYPE

RUNTIME_REJECTION:
NO

DIAGNOSTIC_1280X720_H264_MF:
PASS

WINDOWS_ATTEMPT_1_CLASSIFICATION:
HARNESS_FIXTURE_DESIGN_DEFECT

OLD_FIXTURE:
32x24 base; 24x32 rotated output

REPLACEMENT_FIXTURE:
1920x1080 base; 1080x1920 for 90/270; 1920x1080 for 180
```

## Historical second Desktop attempt (preserved)

The second Windows 11 Desktop attempt used the corrected Desktop-sized
1920x1080 base fixture. Base `h264_mf` encoding reached the approved runtime
successfully, but the harness could not create authentic signed display-matrix
fixtures because it used the legacy `-metadata:s:v:0 rotate=<angle>` form. This
was a harness metadata-fixture construction defect, not a Runtime rejection.

```text
WINDOWS_ATTEMPT_2:
FAIL_HARNESS_METADATA_FIXTURE_CONSTRUCTION

RUNTIME_REJECTION:
NO

DESKTOP_SIZED_BASE_ENCODING:
PASS

WINDOWS_ATTEMPT_2_CLASSIFICATION:
HARNESS_METADATA_FIXTURE_CONSTRUCTION_DEFECT

FAILURE:
legacy rotate metadata did not produce the expected signed display matrix

FIXED_BY:
-display_rotation:v:0 <angle> with stream-copy fixture creation (-c:v copy)

FIXTURE_PIXELS:
UNCHANGED_BY_METADATA_FIXTURE_CREATION
```

The harness now probes each fixture before applying rotation filters and binds
90° / 180° / 270° to the signed display-angle families. The output path still
forbids residual non-identity display metadata and requires the asymmetric
pixel oracle, exact dimensions, frame count, SAR, and CFR checks. The selected
Runtime v2 bytes and transport identity were not rebuilt or replaced.

## Historical third Desktop attempt (preserved)

The third Windows 11 Desktop attempt reached actual rotation execution with
the authentic display-matrix fixtures and a Desktop-sized `h264_mf` encode. The
explicit pixel rotation filters were reached, but the normalized outputs still
carried a non-identity display matrix. This was an output metadata-normalization
defect in the harness, not a Runtime rejection.

```text
WINDOWS_ATTEMPT_3:
FAIL_HARNESS_OUTPUT_ROTATION_METADATA_NORMALIZATION

AUTHENTIC_DISPLAY_MATRIX_FIXTURE:
PASS

DESKTOP_H264_MF:
PASS

ROTATION_EXECUTION_REACHED:
YES

RUNTIME_REJECTION:
NO

WINDOWS_ATTEMPT_3_CLASSIFICATION:
HARNESS_OUTPUT_METADATA_NORMALIZATION_DEFECT

FAILURE:
rotation 90 left non-identity display metadata

FIXED_BY:
-display_rotation:v:0 0 on the output-transcode input side, before -i fixture

LEGACY_ROTATE_ZERO_METADATA:
NOT_USED

ROTATION_APPLICATION_COUNT:
EXACTLY_ONE
```

The source display matrix is now captured and verified before the identity
override. The override only clears consumed display authority; the selected
transpose / flip filter remains the sole pixel rotation. Output verification
continues to require absent-or-identity display metadata, normalized pixels,
exact dimensions, 30 fps, 30 frames, SAR 1:1, and decoded `yuv420p`.

```text
FIRST_ACTUAL_BLOCKER:
WINDOWS_11_DESKTOP_ROTATION_EVIDENCE_PENDING; approval receipt intentionally not issued
```
