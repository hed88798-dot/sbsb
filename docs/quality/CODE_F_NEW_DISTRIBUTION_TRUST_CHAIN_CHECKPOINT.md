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
→ Primary + Secondary Archive
→ Primary Recovery Drill
→ Secondary Availability Check
→ FROZEN_CANDIDATE
```

The schemas in `schemas/compliance/distribution-trust-chain/v1/` are the
machine-readable contract. `tools/python-supply-chain/trust-chain.mjs` is the
cross-record verifier. Hashes for the recipe, environment descriptor, build
context, candidate identity, retention receipt and recovery drill are SHA-256 of
canonical JSON with that record's own hash field omitted. Canonical JSON sorts
object keys recursively and preserves array order.

## Current main baseline binding

This checkpoint is reviewed and tested against the Fastify-remediated main
baseline below. The earlier baseline is retained only as historical provenance;
it is not the current review or required-main baseline.

```text
CHECKPOINT_BASELINE_REFERENCE: 4ea7f1cc0ae5ec2d38c4036ca8e292963bdf751f
CURRENT_MAIN_BASELINE: 4ea7f1cc0ae5ec2d38c4036ca8e292963bdf751f
CURRENT_MAIN_BASELINE_ROLE: MAIN_AFTER_FASTIFY
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
4. `candidate-identity.schema.json` binds the new candidate to the build context,
   source identity and exact Worker, CArchive and archive-container bytes.
5. `retention-receipt.schema.json` binds the candidate to independent primary and
   secondary cold-archive copies. Both copies must be available and their archived
   object hash must match the candidate archive-container hash.
6. `recovery-drill.schema.json` proves that a clean location recovered the exact
   Worker and CArchive bytes from primary and that the secondary copy is available.

## Gate semantics

`FROZEN_CANDIDATE` is prohibited until the primary recovery drill and secondary
availability check both pass. A Worker SHA matching an historical artifact is only
an output-byte comparison; it never proves historical recipe or environment
reproduction.

Full Worker and CArchive bytes must not be committed to Git or uploaded to GitHub
Actions. The approved retention class is
`PROJECT_CONTROLLED_LOCAL_COLD_ARCHIVE` with two independent locations. Repository
records may contain only portable logical locators; local filesystem paths are not
authority-bearing.

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

For a real candidate, Code C must pass all six records to the verifier:

```text
node tools/python-supply-chain/trust-chain.mjs \
  --recipe <recipe.json> \
  --environment <environment.json> \
  --context <context.json> \
  --candidate <candidate.json> \
  --retention <retention-receipt.json> \
  --recovery <recovery-drill.json>
```

This checkpoint is a release-infrastructure gate only. It does not approve a
candidate, rebuild a Worker, or start CPython Stage A/Stage B. After this change
is merged into `main`, Code C may issue a new candidate and must stop after
distribution closure for F's short trust-chain checkpoint review.
