# R1C-A Final Baseline

This project-level record closes the accepted R1C-A Windows Desktop Runtime v2 distribution baseline. It is provenance only and does not modify R1C-A implementation, the approved Runtime v2, its approval receipt, or product-render semantics.

```text
R1C_A_STATUS:
CLOSED

NEW_MAIN:
4fd2275178488af1011243e1750209df28e7fd1c

ACCEPTED_R1C_A_HEAD:
316bed4dc4d0872fb7539bd88d19b443a7137176

POST_MERGE_CI_RUN:
35005517944

POST_MERGE_INSTALLED_RUNTIME_RUN:
35006620554

POST_MERGE_EVIDENCE_ARTIFACT_ID:
10411879014

POST_MERGE_EVIDENCE_ARTIFACT_NAME:
windows-desktop-runtime-v2-distribution-4fd2275178488af1011243e1750209df28e7fd1c

POST_MERGE_EVIDENCE_ARTIFACT_DIGEST:
sha256:92640ac591bac98a1e1bc521c4085c647232bcc83e7daa93c67b822a27b030fb

SOURCE_TRANSPORT_SHA256:
a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01

SOURCE_EXTRACTED_TREE_HASH:
336e464eea7c8029f249c7f0df3ef9d8d34a52f765c0d9b7970cc2dcea3575be

BUILD_STAGED_TREE_HASH:
336e464eea7c8029f249c7f0df3ef9d8d34a52f765c0d9b7970cc2dcea3575be

PACKAGING_ARTIFACT_TREE_HASH:
336e464eea7c8029f249c7f0df3ef9d8d34a52f765c0d9b7970cc2dcea3575be

INSTALLED_TREE_HASH:
336e464eea7c8029f249c7f0df3ef9d8d34a52f765c0d9b7970cc2dcea3575be

THREE_STAGE_RUNTIME_BYTES:
PASS

PACKAGING_ARTIFACT_SMOKE:
PASS

REAL_INSTALLED_APP_SMOKE:
PASS

INSTALLED_PROCESS_RESOURCES_PATH:
C:\Users\runneradmin\AppData\Local\Programs\@appdesktop\resources

RUNTIME_ID:
code-f-ffmpeg-render-windows-x86_64-34699695106

RUNTIME_MANIFEST_SHA256:
5e57ef59bdf1c3d8cf17966b100358f4a16b96edb6c7dc7857e9d85bf3f03205

RUNTIME_IDENTITY_SHA256:
9df0552354769ab18846e5031caa77488f2c0b2fd1c882a7587af06cc0e71db9

FFMPEG_SHA256:
7fc910c87e37502f3ff1f7e56c0ee470d91597aece9cd873880ce3c477d0a933

FFPROBE_SHA256:
641b8649c3d11702942a4b649d6ecee35231e04e09ce50a8d74b8c46b5295c4e

APPROVAL_RECEIPT_SHA256:
4f394178882d19442db7a03d9092fb2e662b449700fe516e1d3e36c9d61a2b4c

PACKAGED_PRODUCTION_FALLBACK:
NONE

PRODUCT_RENDER_RERUN:
NO
```

The verified provenance chain is:

```text
main@4fd2275178488af1011243e1750209df28e7fd1c
-> NSIS installer
-> installed Desktop
-> process.resourcesPath
-> exact approved Runtime v2
-> Runtime authority verification PASS
-> ffmpeg 9.0.1 and ffprobe 9.0.1 version smoke PASS
```

The source-extracted, build-staged, unpacked-package, and installed runtime trees have the same canonical member-tree hash. The installed resolver remained inside `process.resourcesPath`, used no PATH or runtime fallback, and exposed no product Render operation.

## Non-blocking credential governance follow-up

The current use of `PIXEL_ORACLE_FIXTURE_TOKEN` for Runtime v2 durable release acquisition is accepted for this closeout and was not renamed or rotated. A later governance review should evaluate either a dedicated Runtime release-asset credential or same-repository `GITHUB_TOKEN` with `contents: read`, if that token can retrieve the required durable private release asset. This follow-up is not an R1C-A blocker.

## Next-owner boundary

R1C-B implementation belongs to Code A: Electron Main wiring, database and job lifecycle integration, IPC contracts, preload surface, Renderer-safe DTO exposure, and Desktop recovery semantics. Code F retains integration, distribution, CI, release, provenance, and packaged-Windows review responsibility. Code B is outside local FFmpeg Render orchestration unless a Provider or Gateway concern is introduced. Code G remains closed; R1B execution semantics must not be reopened.

R1C-C Desktop Render task UX and Renderer UI belong to Code A / the Desktop UI owner; Code F provides integration and release review only. A genuinely cross-domain Main-integration conflict must be returned to Brain1 rather than silently moving implementation ownership to Code F.
