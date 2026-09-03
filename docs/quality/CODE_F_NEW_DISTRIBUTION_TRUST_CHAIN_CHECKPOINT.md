# Code F New Distribution Trust-Chain Checkpoint

## Purpose

Historical CPython Worker exact reproduction is closed as unproven. The previous
Worker bytes remain historical-only evidence and are not Stage B runtime authority.
Every future distribution candidate must establish a new, forward-looking chain
before PyInstaller runs:

```text
Build Recipe (frozen)
→ Environment Descriptor (bytes retained)
→ Build Context (frozen)
→ Build Worker / CArchive
→ SHA-256 + Candidate Transfer Manifest
→ 1-day GitHub Actions transport artifact
→ Mac local project-folder retention
→ Local Recovery Drill
→ FROZEN_CANDIDATE
```

The schemas in `schemas/compliance/distribution-trust-chain/v1/` remain the
legacy dual-copy contract. The current v2 schemas in
`schemas/compliance/distribution-trust-chain/v2/` define the single local-copy
retention channel and the Candidate Transfer Manifest. `tools/python-supply-chain/trust-chain.mjs`
is the version-dispatched cross-record verifier. Hashes for every record are
SHA-256 of canonical JSON with that record's own hash field omitted. Canonical
JSON sorts object keys recursively and preserves array order.

## Current main baseline binding

This checkpoint is reviewed and tested against the Fastify-remediated main
baseline below. The earlier baseline is retained only as historical provenance;
it is not the current review or required-main baseline.

```text
CHECKPOINT_BASELINE_REFERENCE: d4909631456029b50c8c6bd6011719fd69ddef95
CURRENT_MAIN_BASELINE: d4909631456029b50c8c6bd6011719fd69ddef95
CURRENT_MAIN_BASELINE_ROLE: MAIN_AFTER_CANDIDATE_EGRESS_CHECKPOINT
ORIGINAL_BASELINE: 06c4620e8738bd63f8674e15d1158042a65c1d28 (historical only)
CHECKPOINT_EVIDENCE_BINDS_SYNCED_HEAD: PASS
```

All current-head CI, contract, clean-checkout, native, security and artifact
evidence for this checkpoint must be generated after syncing this branch to the
`CHECKPOINT_BASELINE_REFERENCE`; evidence from the historical baseline cannot be
reused as a current PASS.

## Required records

1. `build-recipe.schema.json` is materialized, canonicalized, hashed and frozen
   before build. It binds source commit/tree/submodule state, zero untracked build
   inputs, exact dependency and toolchain subjects, PyInstaller/spec, command,
   environment allowlist/values and the no-new-resolution/no-sdist/no-unapproved-
   download policy.
2. `build-environment.schema.json` records Linux or Windows OS, architecture,
   runtime versions, executable/toolchain identities, locale/timezone, relevant
   environment values and runner image identity. Descriptor bytes must be retained
   at a portable `cold-archive://...` locator.
3. `build-context.schema.json` independently binds the source identity, recipe,
   environment descriptor, approved subject-set digests, target, CPython artifact,
   spec and build policy. It must be created before the build.
4. `candidate-transfer-manifest.schema.json` binds the candidate ID, platform,
   Worker/CArchive SHA-256 and sizes, Build Recipe/Environment/Context hashes,
   and declares GitHub Actions as `TRANSPORT_ONLY` with `retention_days: 1`.
5. `candidate-identity.schema.json` binds the new candidate to the build context,
   source identity, exact Worker/CArchive bytes and the transfer manifest hash.
6. `retention-receipt.schema.json` binds one verified local copy under
   `frozen-candidates/<candidate-id>/<platform>/`; a secondary permanent copy is
   explicitly not required.
7. `recovery-drill.schema.json` proves that a clean temporary location recovered
   the exact Worker and CArchive bytes from the Mac local project-folder copy.

## Gate semantics

`FROZEN_CANDIDATE` is prohibited until the local recovery drill passes. A Worker
SHA matching an historical artifact is only an output-byte comparison; it never
proves historical recipe or environment reproduction.

Full Worker and CArchive bytes must not be committed to Git. They may be uploaded
to GitHub Actions only as a one-day transient transport artifact, never as final
retention authority. The final retention class is `MAC_LOCAL_PROJECT_FOLDER` under
the logical root `frozen-candidates/`; repository records may contain only logical
locators, never `/Users/...` or other local filesystem paths.

The supported egress helper is:

```text
pnpm compliance:python:candidate:egress create-transfer-manifest ...
pnpm compliance:python:candidate:egress verify-transfer ...
pnpm compliance:python:candidate:egress retain-local ...
pnpm compliance:python:candidate:egress recovery-drill ...
```

The runner creates the manifest and computes `BUILD_HOST_WORKER_SHA256` and
`BUILD_HOST_CARCHIVE_SHA256` before upload. After downloading the transient ZIP on
Mac, `retain-local` rechecks both hashes, writes `manifest.json` beside the retained
files, performs the local Recovery Drill, and emits the hash-bound v2 retention and
recovery records. A failed or mismatched transfer is fail-closed.

The operator sequence is intentionally explicit: complete and retain the Linux
transport first, verify its receipt and recovery drill under
`frozen-candidates/<candidate-id>/linux/`, delete the downloaded transient
extraction, then run the Windows transport and repeat the same local retention
procedure. The Actions ZIP is never the Worker identity and is not a permanent
copy.

Artifact-level inventory, toolchain and license approvals may be reused only when
their exact subject hashes, evidence snapshots, active status and policy version
are unchanged. Worker/CArchive evidence must be rebound to the new candidate
context, including native reconciliation, runtime smoke, 37-usage license replay,
final distribution binding, SBOM and NOTICE.

## Verification

The contract regression is part of the normal quality check:

```text
pnpm compliance:trust-chain:contract
```

For a real v2 candidate, Code C must pass all seven records to the verifier:

```text
node tools/python-supply-chain/trust-chain.mjs \
  --recipe <recipe.json> \
  --environment <environment.json> \
  --context <context.json> \
  --candidate <candidate.json> \
  --retention <retention-receipt.json> \
  --recovery <recovery-drill.json> \
  --transfer-manifest <candidate-transfer-manifest.json>
```

This checkpoint is a release-infrastructure gate only. It does not approve a
candidate, rebuild a Worker, or start CPython Stage A/Stage B. After this change
is merged into `main`, Code C may issue a new candidate and must stop after
distribution closure for F's short trust-chain checkpoint review.
