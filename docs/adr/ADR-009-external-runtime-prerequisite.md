# ADR-009: External runtime prerequisite contract

- Status: Accepted engineering design; distribution approval blocked
- Date: 2026-08-30
- Owner: Code F / Quality, Release & Compliance

## Context

Code C's artifact-bound PyInstaller analysis proves that the Windows x64 worker requires
`msvcp140.dll`, `msvcp140_1.dll`, `vcruntime140.dll`, and `vcruntime140_1.dll`. The raw selection
contains System32 copies and CPython-bundled VCRUNTIME copies. Those observations prove dependency
necessity but are not coherent or approved product distribution sources.

The existing internal-native reconciliation assumes that every selected requirement is materialized
and present in the final worker. That model cannot truthfully represent an installer-level runtime
prerequisite.

## Decision

Use `EXTERNAL_PREREQUISITE` as the engineering target. The entire four-DLL requirement family is
assigned to one Microsoft Visual C++ v14 x64 Redistributable provider. The one-file worker must not
materialize those external entries.

The shared contract separates raw observations (`O`), consumer requirements (`Q`), internal provider
bindings (`I`), and external provider bindings (`E`):

```text
O -> Q
Q = I union E
I intersection E = empty
```

Externalization applies to a capability/ABI requirement, not to the exact observed DLL bytes. The raw
System32 and CPython observations remain immutable and rejected for distribution. Internal entries
continue through native reconciliation and must be materialized/final; external entries must have an
approved prerequisite manifest and must not be materialized/final.

The bootstrap artifact is an exact immutable file. An already-installed runtime is accepted through a
versioned compatibility policy, so its DLL hashes need not equal bootstrap payload hashes. Windows
probe evidence binds an immutable provider identity derived from technical provider and compatibility
facts; signature, installation, legal, approval, and revocation state remain mutable review facts in
the separately hashed manifest.

## Current provider candidate

- Product: Microsoft Visual C++ v14 Redistributable (x64)
- Version: `14.51.36247.0`
- File: `VC_redist.x64.exe`
- SHA-256: `843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c`
- Deployment: central installer prerequisite
- Minimum accepted installed version: `14.51.36247.0`
- Newer compatible v14 runtime: accepted

The canonical source, expected Microsoft signer identity, compatibility evidence, consumer evidence
bindings, review expiry, and revocation state are recorded in the versioned prerequisite manifest.

## Compliance disposition

Technical contract validation does not grant redistribution rights. Microsoft documentation limits
redistribution to licensed Visual Studio users under applicable product terms. The repository does not
yet contain an approved attestation identifying that entitlement and commercial distributing entity.
Therefore bootstrap distribution approval and stable release remain blocked until Legal Review records
that evidence. No System32 or CPython DLL acquires a distribution role through this decision.

## Consequences

- QICR is required and owned by Code F.
- Missing/ambiguous/invented provider dispositions fail closed.
- Provider coverage, application/build-context/Analysis-TOC binding, hash integrity, expiry, and
  revocation are mandatory regressions.
- A Windows workflow must authenticate and install the exact bootstrap and prove the required DLL
  family is present.
- The release workflow requires the approved form of the contract and remains blocked while legal or
  technical evidence is incomplete.
- Full Electron installer detection, elevation, repair, reboot handling, logging, error UX, update, and
  rollback integration remain a Release Installer responsibility before stable release.
