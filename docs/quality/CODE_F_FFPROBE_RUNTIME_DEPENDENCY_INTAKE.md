# Code F: ffprobe Runtime Dependency Intake and Contract Decision

- Decision record: `code-f-ffprobe-runtime-dependency-intake-d4d6793-v1`
- Decision status: `BLOCKED_PENDING_GENERIC_RUNTIME_COMPANION_QICR`
- Reviewed baseline: `main@d4d6793363aeef3a48147e135d2188f04ec6dd09`
- Owner: Code F / Quality, Release & Compliance

## Scope

This is an intake and contract decision only. It does not produce, download, package,
approve, or redistribute an ffprobe executable. Exact Linux and Windows artifacts remain
pending a later Native execution step.

The Code C boundary preflight identifies the production call chain:

```text
worker.handle -> index_asset -> probe_media -> _run_json -> subprocess.run(ffprobe)
```

Therefore ffprobe is a `PRODUCT_RUNTIME_DEPENDENCY`, not a validation-only tool. The current
candidate has no approved ffprobe artifact, no ffprobe entry in its native manifest, and no
ffprobe component in the current Final Distribution Binding.

## Decision

The deployment model is:

```text
FFPROBE_DEPLOYMENT_MODEL: BUNDLED_RUNTIME_COMPANION
```

The product cannot assume a customer-installed or system-PATH ffprobe. A future candidate must
ship a platform-specific, exact companion and its complete runtime closure through the same
auditable distribution boundary as the Worker.

The acquisition strategy is:

```text
SOURCE_BUILD_FROM_PINNED_FFMPEG_RELEASE
```

Each platform build must use a versioned upstream FFmpeg release, a pinned source archive and
SHA-256, a frozen platform-specific Build Recipe, and recorded build configuration. No system
package manager, floating release, untracked download, or arbitrary internet binary is an
authority.

## Contract assessment

The existing contracts do not express a generic executable runtime companion. The current
external-prerequisite schema is specialized to the Microsoft VC++ redistributable and its
central-installer/probe model. The current runtime-consumer and distribution-candidate records
do not provide a generic companion role, packaged locator, executable identity, per-member
license evidence, or runtime-closure component set.

Accordingly:

```text
CURRENT_NATIVE_RUNTIME_CONTRACT_CAN_EXPRESS_EXTERNAL_EXECUTABLE_COMPANION: NO
RUNTIME_COMPANION_CONTRACT_SUPPORTED: NO
QICR_REQUIRED: YES
OWNER_OF_NEXT_FIX: CODE_F_QICR
```

The required QICR must be generic and must not special-case `ffprobe`. It must cover role,
platform/architecture, version, source release identity, source/artifact hashes, Build Recipe
or trusted provider, configuration, provenance, executable identity, license evidence,
distribution mode, packaged locator, resolver semantics, and every shipped runtime member.

## Frozen requirements for the next QICR and artifact intake

```text
SYSTEM_PATH_FALLBACK_ALLOWED: NO
SYSTEM_PACKAGE_MANAGER_ARTIFACT_AUTHORITY: NO
UNTRACKED_DOWNLOAD_ALLOWED: NO
EXPLICIT_RUNTIME_LOCATOR_REQUIRED: YES
```

For each Linux and Windows exact artifact, the minimum record is:

```text
FFPROBE_VERSION
SOURCE_RELEASE_IDENTITY
SOURCE_SHA256
BUILD_RECIPE_ID
BUILD_CONFIGURATION
ARTIFACT_SHA256
EXECUTABLE_SHA256
LICENSE_EXPRESSION
LICENSE_EVIDENCE_SHA256
PROVENANCE_RECORD
```

The artifact-level license review is per exact binary/build, not an abstract “FFmpeg is LGPL”
assertion. The runtime closure must account for every shipped DLL, `.so`, codec library and
other native member. A fully static/self-contained build may record zero external dynamic
members; otherwise all members enter Native Reconciliation, License Reconciliation, SBOM,
NOTICE, and the distribution component set.

## Worker and identity impact

The reviewed Code C callsite accepts `payload["ffprobe_path"]`, resolves it strictly, and passes
the explicit path to `subprocess.run` with `shell=False`. Thus the current Worker supports an
explicit ffprobe locator and this decision alone does not require a Worker rebuild. A future
packaging resolver/wiring change remains required to supply the approved packaged locator.

Adding a bundled ffprobe changes the distributed component set even if Worker, CArchive and
CPython bytes remain unchanged. The next state is therefore a new Distribution Candidate on the
same Worker lineage, not the same exact Candidate.

```text
CURRENT_WORKER_SUPPORTS_EXPLICIT_FFPROBE_LOCATOR: YES
WORKER_REBUILD_REQUIRED: NO
CANDIDATE_IDENTITY_IMPACT: DISTRIBUTION_COMPONENT_SET_CHANGE
WORKER_IDENTITY_CHANGE_REQUIRED: NO
DISTRIBUTION_COMPONENT_SET_CHANGE_REQUIRED: YES
NEW_DISTRIBUTION_CANDIDATE_REQUIRED: YES
```

## Required downstream rebinds

```text
NATIVE_REBIND_REQUIRED: YES
LICENSE_DISTRIBUTION_REBIND_REQUIRED: YES
PYTHON_ARTIFACT_LICENSE_REREVIEW_REQUIRED: NO (unless Python artifacts change)
SBOM_NOTICE_REBIND_REQUIRED: YES
FINAL_DISTRIBUTION_REBIND_REQUIRED: YES
VULNERABILITY_FINAL_REVIEW_REBIND_REQUIRED: YES
PYTHON_STAGE_A_RERUN_REQUIRED: NOT_YET_DETERMINED
PYTHON_STAGE_B_RERUN_REQUIRED: NOT_YET_DETERMINED
```

The vulnerability rebind is required because the current vulnerability authority is bound to
the current Final Distribution Binding. Stage A/Stage B reruns are deliberately not assumed;
their need is decided only after Worker, CArchive, CPython, packaged-module inventory,
protocol/input surface, and affected callsite identities are compared.

## Current artifact and execution status

```text
EXISTING_APPROVED_FFPROBE_ARTIFACT: NO
LINUX_EXACT_FFPROBE_ARTIFACT: NOT_YET_PRODUCED
WINDOWS_EXACT_FFPROBE_ARTIFACT: NOT_YET_PRODUCED
ARTIFACT_LEVEL_APPROVAL: NOT_PERFORMED_YET
LINUX_FFPROBE_LICENSE_EVIDENCE: PENDING_EXACT_ARTIFACT
WINDOWS_FFPROBE_LICENSE_EVIDENCE: PENDING_EXACT_ARTIFACT
FFPROBE_RUNTIME_CLOSURE: BLOCKED_PENDING_EXACT_ARTIFACT
```

No ffprobe download, build, package, Worker modification, SBOM/NOTICE regeneration, native
rerun, license rerun, vulnerability rerun, SigLIP/index run, or Version Acceptance was performed
in this intake.
