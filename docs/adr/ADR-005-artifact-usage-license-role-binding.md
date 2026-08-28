# ADR-005: Artifact usage and license-role binding

- Status: Accepted
- Date: 2026-08-29
- Owners: Code F / Quality, Release & Compliance
- Review reference: QICR-002

## Context

A Python wheel has stable byte identity and license facts, but its commercial decision depends on
how those exact bytes are used. PyInstaller 6.22.2 appears in the dependency graph as
`PYTHON_BUILD_DEPENDENCY` while functioning as `PYINSTALLER_BUILD_TOOL` for a specific worker
build. Treating either role as the artifact's permanent identity loses one fact and allows a PASS
from one context to leak into another.

Exact Windows/Linux wheel inspection also found path-scoped terms in the distributed COPYING file.
A package-level SPDX expression alone would erase the Apache-2.0 runtime-hook terms and the dual
license of `PyInstaller.isolated`.

## Decision

Three versioned layers are used:

1. Artifact License Evidence v2 records `urn:sha256:<digest>` identity, provenance, package-level
   terms, and actual file-level scopes. It has no usage role or policy decision.
2. Artifact Usage Binding v1 references the exact artifact, Build Artifact Provenance v1 identity,
   dependency/functional/distribution roles, exact exception evidence, policy identity and
   build/runtime/notice reachability.
3. License Policy Evaluation v3 validates the join and then adapts the functional/distribution
   context into the existing SPDX evaluator. Every package and file-level scope must pass.

Canonical identity is exact SHA-256. Package name/version never reconcile different bytes. The
build-context identity is the canonical JSON SHA-256 of the existing Build Artifact Provenance v1
record, so no parallel build identity system is introduced.

For the current worker build, `BUILD_ONLY` maps to the existing policy's `BUILD_ONLY_USE` value;
this is an explicit adapter and does not redefine the v1 evidence `distribution_role` field.
Policy decisions are context-bound, not artifact allowlists.

## Compatibility

Artifact License Evidence v1 and License Policy Evaluation v2 remain supported with their original
semantics. Policy versions `2026.08.28.1` and `2026.08.28.2` are immutable replay inputs. New
worker-build consumers use v2 evidence, v1 usage binding and v3 evaluation. This is additive and
does not require a destructive migration of historical records.

## Consequences

- The same wheel can pass as a build-only PyInstaller tool and fail as a product runtime or
  redistributed toolchain.
- Exception evidence is bound to artifact hash, build context, roles and policy version.
- PyInstaller, its bootloader, and the generated final worker remain independent records.
- Build SBOM/internal evidence and runtime SBOM/customer notices have separately auditable
  reachability.
- Python 3.13.15 standard-GIL architecture and `cp313` remain unchanged.
