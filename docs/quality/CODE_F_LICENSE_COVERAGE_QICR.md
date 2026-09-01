# Code F License Coverage QICR

```text
QICR_STATUS: PASS (pending PR merge)
BRANCH: code-f/license-coverage-qicr
OLD_MAIN_QUALITY_BASELINE: e00abb61a5f493ec02cfeea0ee6e4d3e5a0f99b0
WORKER_ARTIFACT_HEAD: ab035c73b2d6268958f17c02774dceb7b080a1ce
WORKER_REBUILD_REQUIRED: NO
DIAGNOSTIC_HEAD: 391d013436757e6e214902a85d022e832cc202d8
```

## Contract

This QICR adds two immutable companion contracts. Upstream Release Binding v1
answers which exact artifact bytes were published by an upstream release;
License Coverage v1 answers which artifact members are covered by an exact
license assertion. Neither record is a commercial-policy approval.

```text
LICENSE_COVERAGE_SCHEMA_VERSION: 1
UPSTREAM_BINDING_SCHEMA_VERSION: 1
COVERAGE_SELECTOR_SEMANTICS_VERSION: 1
UPSTREAM_BINDING_METHODS:
  - BUILD_PROVENANCE_ATTESTATION
  - OFFICIAL_RELEASE_ASSET_BYTE_IDENTITY
  - OTHER_APPROVED_METHOD
UPSTREAM_BINDING_ASSURANCE_MODEL: PASS
COMPONENT_PATH_COVERAGE_SUPPORTED: YES
UPSTREAM_RELEASE_COVERAGE_SUPPORTED: YES
```

Selectors are deterministic, versioned and offline replayable. Supported
types are `ENTIRE_ARTIFACT`, `EXACT_PATH`, `PATH_PREFIX`, `VERSIONED_GLOB` and
`EXPLICIT_MEMBER_LIST`; arbitrary code predicates are not accepted. Every
used or distributed member must have exactly one effective disposition.
Uncovered members, conflicting overlap, nonexistent paths and wrong exact
artifact identities fail closed.

## Regression fixtures

The fixtures contain manifests and immutable hashes only; no wheel binaries are
committed. SentencePiece Linux binds the exact wheel to the signed
`google/sentencepiece` `v0.2.1` release with SLSA integrity and subject
membership. SentencePiece Windows uses the same signed official Release
exact-byte identity but records an absent SLSA subject separately. That is an
accepted upstream binding with the weaker `OFFICIAL_PUBLICATION_EXACT_BYTES`
assurance, not an invented attestation.

`pyinstaller-hooks-contrib` exercises generic component/path coverage:
`_pyinstaller_hooks_contrib/**` excluding `rthooks/**` is `GPL-2.0-or-later`,
while `rthooks/**` is `Apache-2.0`. The artifact is explicitly
`PYTHON_BUILD_DEPENDENCY` / `BUILD_ONLY_USE` and is not in the final worker.

```text
SENTENCEPIECE_LINUX_RELEASE_BINDING: PASS
SENTENCEPIECE_LINUX_ATTESTATION_INTEGRITY: PASS
SENTENCEPIECE_LINUX_ATTESTATION_SUBJECT_MEMBERSHIP: PRESENT
SENTENCEPIECE_LINUX_BINDING_ASSURANCE: BUILD_PROVENANCE_VERIFIED
SENTENCEPIECE_WINDOWS_RELEASE_BINDING_METHOD: OFFICIAL_RELEASE_ASSET_BYTE_IDENTITY
SENTENCEPIECE_WINDOWS_RELEASE_BINDING: ACCEPTED
SENTENCEPIECE_WINDOWS_ATTESTATION_INTEGRITY: PASS
SENTENCEPIECE_WINDOWS_ATTESTATION_SUBJECT_MEMBERSHIP: ABSENT
SENTENCEPIECE_WINDOWS_BINDING_ASSURANCE: OFFICIAL_PUBLICATION_EXACT_BYTES
SENTENCEPIECE_RELEASE_LICENSE_COVERAGE_REVIEW: PENDING
SENTENCEPIECE_EFFECTIVE_LICENSE_EXPRESSION: Apache-2.0 (coverage assertion only)
SENTENCEPIECE_WHOLE_ARTIFACT_COVERAGE: PASS
SENTENCEPIECE_UNACCOUNTED_LICENSE_RELEVANT_MEMBER_COUNT: 0
PYINSTALLER_HOOKS_COMPONENT_COVERAGE: PASS
PYINSTALLER_HOOKS_LICENSE_RELATIONSHIP: PER_COMPONENT
PYINSTALLER_HOOKS_BUILD_ONLY_USAGE_BINDING: PASS
```

The SentencePiece coverage records remain `REQUIRES_REVIEW`; whole-artifact
coverage PASS means the fixture manifest accounts for all license-relevant
members, not that commercial distribution is approved. Code C must consume the
contract and rerun its complete License Closure after this QICR reaches main.

## Negative regression matrix

The contract tests cover wrong repository/tag/commit, filename/SHA mismatch,
release-asset mismatch, tampered provenance, valid attestation with a wrong
subject, source/license hash drift, missing coverage, uncovered members,
conflicting selectors, nonexistent paths, wrong artifact binding and a
distributed member misclassified as build-only. The test suite also asserts
that coverage evidence exposes no commercial-use or distribution decision.

```text
COVERAGE_SELECTOR_DETERMINISM: PASS
UNCOVERED_MEMBER_FAIL_CLOSED: PASS
CONFLICTING_COVERAGE_FAIL_CLOSED: PASS
WRONG_ARTIFACT_BINDING_FAIL_CLOSED: PASS
WRONG_RELEASE_BINDING_FAIL_CLOSED: PASS
TAMPERED_UPSTREAM_EVIDENCE_FAIL_CLOSED: PASS
EVIDENCE_POLICY_SEPARATION: PASS
```

The CI command is `pnpm compliance:license-coverage:verify`; it is verify-only
and uploads only the existing small compliance evidence. No Worker rebuild,
Inventory regeneration, Native reconciliation, CVE Stage A/B, SigLIP/Index
work, or remaining Required Review audit is part of this QICR.

```text
DEPENDENCY_ARTIFACT_CHANGE_REQUIRED: NO
CODE_C_REGENERATION_REQUIRED: NO
OWNER_OF_NEXT_FIX: CODE_C_LICENSE_REVALIDATION
NEW_MAIN_QUALITY_BASELINE: SET_AT_SQUASH_MERGE
```
