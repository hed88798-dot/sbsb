# Code F Status Report — Quality, Release & Compliance Foundation

报告日期：2026-08-27（Asia/Shanghai）

```text
BRANCH:
code-f/quality-release-foundation

BASELINE_SHA:
b04b8c152cd3e589b17246f53bab16262aefe313

VERIFIED_IMPLEMENTATION_SHA:
871c5baa13648b978043f0bc6f1f34c9b50a9799

FINAL_SHA:
SEE_FINAL_DELIVERY_MESSAGE — a committed file cannot contain its own Git object ID; the exact pushed head is reported after the final report commit.

MAIN_ARTIFACT_SHA:
NOT_AVAILABLE

ARTIFACT_SHA256:
NOT_AVAILABLE

BUILD_RUN_ID:
NOT_AVAILABLE

WINDOWS_CLEAN_VM:
BLOCKED

INSTALL:
FAIL — NO FORMAL MAIN ARTIFACT / VM EVIDENCE

LAUNCH:
FAIL — NO FORMAL MAIN ARTIFACT / VM EVIDENCE

UPDATE:
FAIL — NO APPROVED PREDECESSOR + MAIN CANDIDATE EVIDENCE

DATA_AFTER_UPDATE:
FAIL — UPDATE NOT EXECUTED

UNINSTALL:
FAIL — FORMAL MAIN INSTALLER NOT EXECUTED

DATA_AFTER_UNINSTALL:
FAIL — UNINSTALL NOT EXECUTED

ROLLBACK / UPDATE_FAILURE:
NOT_YET_AUTOMATED

CLEAN_CHECKOUT:
PASS — isolated store/worktree at 871c5baa13648b978043f0bc6f1f34c9b50a9799

PR_GATE:
PASS — local equivalent; remote PR checks not yet run on this branch

WINDOWS_E2E:
FAIL — WORKFLOW READY, NO MAIN RUN / CLEAN VM RESULT

SECRET_GATE:
PASS — tracked source + compiled output + local packaged asar; formal Windows installer evidence remains blocked

LICENSE_GATE:
PASS — PR first-pass (617 packages, 0 unknown/review) and local packaged asar inventory (81 packages); stable final-artifact/NOTICE review remains blocked

SBOM_SCAFFOLD:
PASS — CycloneDX 1.6, 617 source/build components, explicitly marked installer-incomplete

GOLDEN_SET_INFRASTRUCTURE:
PASS — schema, versioned manifest, authorization/provenance, SHA-256 integrity and locked test split

REQUIRED_CHECKS_REVIEW:
PASS — expected checks documented; remote branch-protection enforcement UNVERIFIED

CI_SECRET_SECURITY:
PASS — read-only PR permissions, commit-pinned Actions, no pull_request_target, signing secrets isolated to manual main environment

KNOWN_P0:
NONE

KNOWN_P1:
NONE

RELEASE_BLOCKERS:
1. Code F workflow/tooling is not yet merged to main; branch artifact cannot receive formal PASS.
2. No immutable signed main installer with SHA-256 and workflow run ID exists for this gate.
3. No resettable Windows 10/11 clean-VM runners are available/configured.
4. release-signing environment / Authenticode material is not configured or evidenced.
5. No approved predecessor installer artifact/run ID exists for update/rollback.
6. Update interruption, partial download and migration-failure recovery are NOT_YET_AUTOMATED.
7. Real Text Provider implementation is not merged to main; F cannot execute formal Desktop → Gateway → Provider smoke.
8. Installer-complete SBOM, final THIRD_PARTY_NOTICES and remote required-check enforcement are not yet evidenced.

ARCHITECTURE_QUESTIONS:
NONE
```

## Verification evidence

- Fixed toolchain gate: Node `24.19.0`, pnpm `11.19.0`, Python `3.12.10` (the final CPython 3.12 release with cross-platform binary installers).
- `pnpm check`: `PASS` — format, lint, typecheck, 16 test files / 152 tests, dependency direction, full-repository portability, workflow security, source secret, license first-pass and Golden manifest.
- Detached clean checkout with no generated state and isolated pnpm store: `PASS` at `871c5baa13648b978043f0bc6f1f34c9b50a9799`.
- macOS arm64 unpacked Electron packaged native SQLite smoke: `PASS`（只作为打包工具回归，不替代 Windows）。
- Local compiled/release scan and extracted asar scan: `PASS`; dependency test directories are excluded from the installer to avoid shipping irrelevant test fixtures.
- Artifact license inventory against extracted local asar: `PASS` — 81 packages, 0 unknown/manual-review entries（不替代 Windows installer + Electron/Chromium/native NOTICE 复核）。
- `ALL_V0_1_ACCEPTANCE = BLOCKED`; no stable tag is authorized.

## Python/native supply-chain foundation — 2026-08-28

```text
BRANCH:
code-f/python-native-supply-chain

BASELINE_SHA:
8e3a98ab664d0737ddf2c9d02002242b88e0c71c

FINAL_SHA:
SEE_FINAL_DELIVERY_MESSAGE — the exact pushed head is recorded after this report commit.

PYTHON_ARTIFACT_INVENTORY_SCHEMA_VERSION:
1

SCOPE_SEPARATION:
PASS — production worker, worker build, model export and model evaluation are distinct scopes.

PYTHON_HASH_LOCK_POLICY:
PASS — wheel filename/platform/ABI/SHA-256 required; missing/wrong hash fails closed.

PYTHON_SBOM_GATE:
PASS — CycloneDX includes approved wheel and native file hashes with scope/provenance properties.

PYTHON_LICENSE_GATE:
PASS — actual wheel METADATA/license files are inspected; unknown/conflict fails closed.

PYTHON_VULNERABILITY_GATE:
PASS — OSV advisory output binds purl, wheel hash, scope, severity and dependency path.

NATIVE_ARTIFACT_INVENTORY:
PASS — packaged pyd/DLL/SO/dylib paths, hashes and source wheel ownership are recorded.

PACKAGED_WORKER_RECONCILIATION:
PASS — missing/unexpected/hash mismatch/unknown owner are blocking.

LINUX_WINDOWS_PLATFORM_ARTIFACT_SUPPORT:
PASS — every inventory has one explicit Python/platform/ABI target.

SDIST_VCS_FAIL_CLOSED:
PASS — v1 accepts approved wheels only; sdist/VCS/floating URLs are rejected.

CI_INTEGRATION:
PASS — PR and clean checkout run Python supply-chain verification; Windows runs packaged reconciliation when applicable.

MAIN_QUALITY_BASELINE_SHA:
RECORDED_IN_FINAL_DELIVERY — a branch cannot predeclare its future merge SHA.

KNOWN_ISSUES:
Code C must still provide its real Windows/Linux complete transitive wheel inventories, hashes, provenance and hash-enforced install. This foundation does not fabricate or approve those inputs.

ARCHITECTURE_QUESTIONS:
NONE
```

## Python wheel compatibility contract v2 — 2026-08-28

```text
ISSUE_10:
RESOLVED_AFTER_PR_MERGE

SCHEMA_VERSION:
2 (v1 reader preserved with unchanged semantics)

COMPATIBILITY_ENGINE:
pypa-packaging / packaging.tags + packaging.utils.parse_wheel_filename

COMPATIBILITY_ENGINE_VERSION:
1

PACKAGING_VERSION:
25.0

TARGET_DESCRIPTOR_VERSION:
1

TARGET_ARTIFACT_SEPARATION:
PASS

CANDIDATE_VERIFIER_SHARED_ENGINE:
PASS

WINDOWS_MIXED_TAG_GRAPH:
PASS

LINUX_MIXED_TAG_GRAPH:
PASS

ABI3_COMPATIBILITY:
PASS

MULTI_TAG_WHEEL_COMPATIBILITY:
PASS

MULTI_PLATFORM_TAG_COMPATIBILITY:
PASS

INCOMPATIBLE_WHEEL_REJECTION:
PASS

COMPLETE_GRAPH_VALIDATION:
PASS

HASH_PROVENANCE_PRESERVED:
PASS

REQUIRE_HASHES_REGRESSION:
PASS

SDIST_VCS_FAIL_CLOSED:
PASS

SBOM_BINDING:
PASS

LICENSE_BINDING:
PASS

VULNERABILITY_BINDING:
PASS

NATIVE_RECONCILIATION:
PASS

PACKAGED_RECONCILIATION:
PASS

QUALITY_TOOL_SUPPLY_CHAIN:
PASS

EXISTING_GATES_REGRESSION:
PASS — local full gate before the platform-only CLI regression: 222 passed, 1 skipped; the final macOS run adds one intentional Windows/Linux-only skip. npm audit retains one low advisory below the blocking threshold.

LINUX_CI:
RECORDED_IN_FINAL_DELIVERY — remote PR check cannot be predeclared by the branch.

WINDOWS_NATIVE_SMOKE:
RECORDED_IN_FINAL_DELIVERY — remote PR check cannot be predeclared by the branch.

SCHEMA_BREAKING_CHANGE:
YES — v2 introduced instead of redefining v1 fields.

V1_READER_SUPPORTED:
PASS

V1_TO_V2_MIGRATION:
PASS

OLD_V1_FIXTURES:
PASS

NEW_V2_FIXTURES:
PASS

CONSUMER_COMPATIBILITY:
PASS — candidate, verifier, hash lock, SBOM, license, vulnerability, native inventory and packaged reconciliation accept v1/v2 through one version-dispatched reader.

ADR_OR_CONTRACT_CHANGE:
docs/adr/ADR-001-python-wheel-compatibility-contract-v2.md

MAIN_QUALITY_BASELINE_SHA:
RECORDED_IN_FINAL_DELIVERY — a branch cannot predeclare its future merge SHA.

ARCHITECTURE_QUESTION:
NONE
```

## Python Approval Provenance QICR — 2026-09-01

```text
CODE_F_PYTHON_APPROVAL_PROVENANCE_QICR:
PASS — contract, verifier and negative regressions implemented; no current subject approvals issued

REVIEWED_CODE_C_HEAD:
5bd956b5eae2c8730144acc962ad085719ea250f

REVIEW_BUNDLE_ID:
code-c-python-inventory-review-5bd956b5eae2-e6ed884abd8c2397

REVIEW_BUNDLE_SHA256:
a3de5d14d1c985413b19950b541a9203c080e97ece4295e8fe3062f3f67c9061

CURRENT_SUBJECT_SHA256:
LINUX_RUNTIME=67478a51fca98171f52755da0e124ca6e99632a4f3a1b5e8a37a8be02b8c54a8
LINUX_WORKER_BUILD=6e03b2e13373980579c1d1324bb8582e814e068a2844ae7e6e7ce74dd0bb55ff
WINDOWS_RUNTIME=be252805ad92925e387831ce766754cdd71b1380484784647443469ff5a120ac
WINDOWS_WORKER_BUILD=e79294a57f3f27f03db39f7707edf43397319cff083db28fae636325a3cdafd1

TOOLCHAIN_EVIDENCE_SHA256:
LINUX=4e6a5e8a7b5ef245124ff188f8c2a74cba61a4ce37cfc8e4b2a6079f6fd4f95f
WINDOWS=f19a6ef7a06bcfe2f804afb0f61c2f04fa4bc8638d5af61e8262f8e7c4fa5f88

RAW_VALIDATION_INPUT_SHA256_MATCHES_SUBJECT:
PASS — all four candidate files match their declared/bundle SHA-256

APPROVAL_PROJECTION_USED_FOR_RAW_VALIDATION:
NO

VALIDATION_TIME_FIELD_INJECTION:
NO

VALIDATION_TIME_SUBJECT_MUTATION:
NO

RAW_CANDIDATE_SCHEMA_VALIDITY:
FAIL — strict v2 schema rejects the exact producer bytes because graph_complete=false and package review_status=PENDING; this is the known contract incompatibility, not a resolver defect

RAW_CANDIDATE_FACT_SEMANTIC_VALIDITY:
FAIL_GRAPH_FACT_INCOMPLETE — v2 graph_complete is authoritative factual completeness

RAW_CANDIDATE_APPROVAL_SUBJECT_VALIDITY:
FAIL

GRAPH_COMPLETE_V2_SEMANTICS:
FACTUAL_GRAPH_COMPLETENESS

GRAPH_COMPLETE_V2_AUTHORITATIVE_MEANING:
The dependency graph is complete only when true; an external approval cannot promote false to true.

REVIEW_STATUS_V2_SEMANTICS:
APPROVAL_LIFECYCLE_COUPLED_LEGACY_FIELD

REVIEW_STATUS_V2_AUTHORITATIVE_MEANING:
The package provenance review_status is an inline APPROVED assertion in v2 and conflicts with an external approval authority when PENDING.

INVENTORY_V2_IMMUTABLE_SUBJECT_COMPATIBILITY:
REQUIRES_VERSIONED_INVENTORY_MIGRATION

INVENTORY_SCHEMA_VERSION_AFTER_QICR:
3 — Code C must regenerate; F does not rewrite v2 candidates

TOOLCHAIN_SUBJECT_MIGRATION_REQUIRED:
NO — current v1 intake evidence has no formal combined approval assertion; provenance, license and vulnerability remain separate scopes

APPROVAL_MODEL:
IMMUTABLE_EXACT_SUBJECT_COMPANION_RECORD

APPROVAL_PROVENANCE_SCHEMA_VERSION:
1

REVOCATION_RECORD_SCHEMA_VERSION:
1

APPROVAL_CANONICALIZATION:
json-utf8-lf-v1

APPROVAL_CONTRACT_SHA256:
9d1b5b0db328a44e128666083f4bdfc4f5dd7fd026e306fe724a8d81c42e90f2

REVIEWER_AUTHORITY_POLICY_SHA256:
e4f8eb4eb82e9ae5a12764b5f950211e2ef18b8727647e65108efd452ea4aa12

APPROVAL_POLICY_VERSION:
1

REVIEW_EVIDENCE_SNAPSHOT_BINDING:
PASS — verifier requires exact subject tuple, bundle snapshot and policy identity

SUBJECT_SHA_BINDING:
PASS

TARGET_BINDING:
PASS

REVIEWER_AUTHORITY_BINDING:
PASS

APPROVAL_RECORD_MUTATION_FAIL_CLOSED:
PASS

REVOCATION:
PASS

REVOCATION_WRONG_APPROVAL_SHA_FAIL_CLOSED:
PASS

EXPIRY_OR_RECHECK:
PASS

SUPERSESSION:
PASS

SCOPE_MISMATCH_FAIL_CLOSED:
PASS

CONFLICTING_ACTIVE_APPROVAL_FAIL_CLOSED:
PASS

CI_APPROVAL_ISSUANCE:
FORBIDDEN

LICENSE_EVIDENCE_REFERENCE_INTEGRITY:
PASS — candidate package license references are structurally present and remain separate from license disposition

OLD_REJECTED_CANDIDATES_REMAIN_UNAPPROVED:
PASS — no historical rejected SHA is accepted by the exact-subject model

V3_MIGRATION_ARTIFACT_SET_CHANGE:
FORBIDDEN

V3_MIGRATION_DEPENDENCY_GRAPH_CHANGE:
FORBIDDEN

V3_MIGRATION_RESOLVER_PROVENANCE_CHANGE:
FORBIDDEN

V3_MIGRATION_TARGET_CHANGE:
FORBIDDEN

V3_MIGRATION_ROLE_CHANGE:
FORBIDDEN

V2_APPROVAL_REUSE_FOR_V3_SUBJECT:
FORBIDDEN

CURRENT_INVENTORY_APPROVAL_COUNT:
0 / 4

CURRENT_TOOLCHAIN_PROVENANCE_APPROVAL_COUNT:
0 / 2

CVE_STAGE_A_REBIND:
PENDING

PYTHON_INVENTORY_GATE:
BLOCKED_PENDING_CODE_C_REGENERATION

QICR_REQUIRED:
RESOLVED

APPROVAL_PR:
PENDING — this branch; merge required before Code C consumes v3 contract

NEW_MAIN_QUALITY_BASELINE:
RECORDED_AFTER_MERGE

OWNER_OF_NEXT_FIX:
CODE_C

CODE_C_NEXT_ALLOWED_PHASE:
REGENERATE_VERSIONED_PYTHON_INVENTORY_ONLY
```

The contract smoke command is `pnpm compliance:approval:verify`; the focused
regression suite covers exact-byte mutation, wrong revocation hash, expiry,
recheck, supersession, conflicting approvals and scope mismatch.

## Packaged Native / Python Toolchain Provenance Contract — Issue #12

```text
BRANCH:
code-f/packaged-native-toolchain-provenance

BASELINE_SHA:
493de878db59eff1f699ab5a722662cac32eef44

CODE_F_PACKAGED_NATIVE_TOOLCHAIN_FIX:
PENDING_MAIN_MERGE — branch implementation and local evidence cannot declare formal main PASS.

PYTHON_ARTIFACT_SCHEMA_VERSION:
2 — unchanged wheel graph contract; v1 reader remains supported.

TOOLCHAIN_ARTIFACT_SCHEMA_VERSION:
1

PACKAGED_NATIVE_SCHEMA_VERSION:
2 — v1 loose/one-folder reader remains supported; one-file requires explicit rescan.

BUILD_ARTIFACT_PROVENANCE_SCHEMA_VERSION:
1

OWNER_MODEL:
PASS — WHEEL_OWNED_NATIVE / TOOLCHAIN_OWNED_NATIVE; UNKNOWN blocks reconciliation.

BUILD_TOOLCHAIN_RUNTIME_SEPARATION:
PASS — build-only components may be absent from CArchive; pip is optional when it did not participate.

CPYTHON_DISTRIBUTION_ARTIFACT_SUPPORT:
PASS — exact patch/target/distribution filename/source/hash required.

ONE_FILE_ARCHIVE_INSPECTION:
PASS — locked PyInstaller 6.22.2 official CArchiveReader; no worker execution or temp-directory inventory.

BOOTLOADER_PAYLOAD_SEPARATION:
PASS — observed bootloader layer, CArchive payload and final executable have distinct identities.

ZERO_FILE_SCAN_FAIL_CLOSED:
PASS

UNKNOWN_NATIVE_FAIL_CLOSED:
PASS

FINAL_WORKER_PROVENANCE:
PASS — commit/run/config/wheel manifests/toolchain manifest/layer hashes/final SHA-256.

BIT_FOR_BIT_REPRODUCIBLE_BUILD_REQUIRED:
NO

SBOM_LICENSE_VULNERABILITY_OWNER_SEPARATION:
PASS — wheel, toolchain, build artifact and build/runtime scopes remain explicit.

QUALITY_TOOL_SUPPLY_CHAIN:
PASS — exact platform PyInstaller archive-inspector graph, artifact hashes, provenance, licenses and OSV gate.

SCHEMA_BREAKING_CHANGE:
YES — Packaged Native Inventory v2; old semantics were not changed silently.

ADR_OR_CONTRACT_CHANGE:
docs/adr/ADR-002-packaged-native-toolchain-provenance.md

MAIN_QUALITY_BASELINE_SHA:
RECORDED_IN_FINAL_DELIVERY — only the merge commit on main can become the formal baseline.

ARCHITECTURE_QUESTION:
NONE
```
