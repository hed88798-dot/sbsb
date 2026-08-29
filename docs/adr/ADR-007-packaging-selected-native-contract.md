# ADR-007: Packaging Selected Native Contract

- Status: Accepted
- Date: 2026-08-29
- Owners: Code F / Quality, Release & Compliance
- Supersedes: ADR-002 reconciliation semantics for new evidence; v2 reader remains supported

## Context

Packaged Native Inventory v2 treated every native file found in an approved wheel or CPython distribution as required in the final PyInstaller CArchive. That assumption is false: an approved artifact defines what may be used, while PyInstaller's Analysis/PKG/EXE graph defines what the build selected. The old gate therefore reported 15 legitimate wheel entries as missing even though none appeared in the authoritative selected set.

The failing Code C run also showed why SHA-only sets are insufficient. One payload can have multiple logical source or destination records, PyInstaller typecode `n` is symlink metadata rather than native content, and equal hashes require source-path provenance to resolve ownership.

## Decision

New builds use two versioned contracts:

1. Packaging Selection Evidence v1 binds a complete canonical selected-entry manifest to the build context, PyInstaller/parser versions, Analysis/PKG/EXE/PYZ TOC hashes, build log and spec. Its authoritative native entries and producer-selected entries must be identical as multisets. An omitted or invented selected entry fails closed.
2. Native Reconciliation v3 separates the approved native universe, explicitly approved late-stage system/derived inputs, materialized entries and final CArchive entries. The verifier enforces approved provenance, selected-to-materialized traceability, required-selected-to-final completeness and final-to-materialized provenance.

The source of truth is an entry manifest (logical multiset), not `Set<SHA256>`. Every record binds an entry ID, source artifact identity and hash, source path, destination/internal path, payload hash, owner kind, target and build context. SHA aggregation is derived only for reporting.

The invariants are:

- Approved does not mean selected or required in the final worker. `APPROVED_NOT_SELECTED` is valid.
- Every selected native must have exactly one approved provenance record in either the approved universe or explicit late-stage approvals.
- Every selected native must map to exactly one materialized record. Relocation is allowed only when declared and payload/provenance remain bound.
- Every selected record marked `required_in_final` must map through materialization to the final CArchive.
- Every final native must map to materialized and selected evidence. Merely matching an approved SHA is insufficient.
- Derived native records require approved source, tool hash, configuration hash, output hash and build-context provenance.
- Equal payload hashes remain separate records. Ownership is resolved by source artifact and selected source path; indistinguishable candidates fail closed.

## Build-context invalidation

Selection evidence binds the code commit, target OS/architecture/CPython patch, CPython artifact, PyInstaller artifact, wheel graph, build spec and source import graph, plus the raw TOC hashes. A change to any bound input, PyInstaller/parser version, hook/dependency graph or spec requires a new evidence ID and recapture.

## Symlink semantics

PyInstaller CArchive typecode `n` is `SYMLINK_METADATA`, even when its path ends in `.so`, `.dll`, `.pyd` or `.dylib`. It is excluded from all native counts. The gate still requires UTF-8 encoding, safe relative paths, a non-self target inside the packaged namespace and resolution to a selected packaged entry. Invalid metadata fails closed.

## SBOM, license and vulnerability scopes

Dependency and build SBOMs continue to include approved wheel and toolchain artifacts even when some native members are not selected. License and vulnerability review retain that build/dependency scope. Runtime SBOM native records are generated only from the verified final-native manifest and are marked `RUNTIME_FINAL_WORKER`; approved-but-not-selected files must not be claimed as runtime content.

## Compatibility and migration

- Packaged Native Inventory v1 and v2 readers and historical fixtures remain unchanged.
- v2 evidence is not silently reinterpreted. The adapter rejects migration unless authoritative Packaging Selection Evidence v1 and a complete Native Reconciliation v3 document are supplied.
- Historical v2 tests continue to replay their original semantics. New PyInstaller acceptance uses v3.
- The schemas are intentionally breaking because v2 `expected` cannot truthfully express selected/materialized/final layers.

## Code C evidence reconciliation

For build context `code-c-pyinstaller-2a7c2da1104bf6d7d2fdc2b871da9de5`, the machine evidence records 151 approved dependency/toolchain entries, 117 selected, 117 materialized, 117 final native payloads and 32 symlink metadata records. The selected set contains 106 entries from the approved universe plus 11 separately approved system build-runtime entries. Therefore:

- `A ∩ B = 106`
- `A \ B = 45`
- `B \ A = 11`
- `B ∩ D = 117`, `B \ D = 0`, `D \ B = 0`
- `D ∩ C = 117`, `D \ C = 0`, `C \ D = 0`

The old gate's 15 missing records are a narrower legacy `V2_EXPECTED_BUT_FINAL_MISSING` domain, all classified `APPROVED_NOT_SELECTED`. They are not `151 - 117`; that arithmetic equals 34 because the two manifests have different membership domains.
