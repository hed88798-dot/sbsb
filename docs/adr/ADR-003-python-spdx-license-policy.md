# ADR-003: Python SPDX License Evidence and Policy Evaluation

- Status: Accepted
- Date: 2026-08-28
- Owners: Code F / Quality, Release & Compliance
- Issue: Python SPDX License Expression Policy remediation

## Context

The Python license gate treated a complete license expression as one allow-list string. That model rejected valid `OR` and `WITH` expressions and could not explain whether an exception applied to a build tool, a bootloader, or a generated worker. It also mixed artifact declarations with the project's commercial distribution decision.

## Decision

The contract now has three independent layers:

1. Artifact License Evidence v1 records immutable artifact identity, the complete detected expression, provenance, metadata and hashed license/NOTICE/COPYING evidence. Evidence conflicts never resolve in the project's favor automatically.
2. `spdx-expression-parse` 5.0.0 parses the expression using exactly pinned `spdx-license-ids` 3.0.23 (SPDX License List 3.28.0) and `spdx-exceptions` 2.5.0 (SPDX Exception List 3.23). CI verifies the approved package/data hashes and never updates these datasets online. Policy identity uses canonical JSON so it is stable across operating-system checkout line endings.
3. License Policy Evaluation v2 evaluates the AST under versioned policy `2026.08.28.1`. `OR` retains all acceptable branches and an independent optional selection, `AND` aggregates obligations, and `WITH` requires an exact artifact-role and distribution-role rule plus exception evidence.

The PyInstaller bootloader exception is approved only for the explicit build-only, bootloader-inclusion, and generated-application roles in policy. Redistribution of the PyInstaller package, source, or a modified toolchain remains manual review. A bare GPL expression stays blocked.

## Compatibility and migration

- Python Artifact Inventory v1/v2, Python Toolchain Inventory v1, Packaged Native Inventory v2 and Build Artifact Provenance v1 retain their existing evidence meanings.
- The generated Python license report changes from schema v1's flat `policy_decision` fields to License Policy Evaluation v2's evidence plus structured decisions. This is an intentional report-schema breaking change; consumers must select by `schema_version`.
- Existing inventories can be re-evaluated under a newer explicit policy file. Comparison reports identify artifact hashes whose policy result changed.
- SBOM license expressions remain the complete artifact declarations. A policy-selected branch, when present, is emitted as a separate property.

## Consequences

- Parser, SPDX data, canonical policy data and results are independently identifiable and deterministic.
- CPython, pip, PyInstaller, the bootloader, wheels and the final worker retain the ownership layers introduced by ADR-002.
- Policy or SPDX data upgrades require a reviewed lock/policy identity change and historical re-evaluation; CI is verify-only.
- This ADR does not change or approve the production Python baseline. Python 3.13 remains outside this decision.
