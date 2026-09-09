# Dependency Approval Request: Microsoft Visual C++ v14 x64 Runtime

## Status

```text
DEPENDENCY_TYPE: EXTERNAL_WINDOWS_RUNTIME_PREREQUISITE
RUNTIME_FAMILY: Microsoft Visual C++ v14 x64 Runtime
AMBIENT_TOOLCHAIN_CONTAMINATION: RESOLVED
MSVC_RUNTIME_DEPENDENCY: PROVISIONALLY_CONFIRMED_PENDING_IMPORT_CLOSURE
CURRENT_SYSTEM32_COPIES: REJECTED
RECOMMENDED_DEPLOYMENT: INSTALLER_LEVEL_PREREQUISITE
APP_LOCAL_EMBEDDING: NOT_APPROVED
CURRENT_WORKER_PACKAGING: BLOCKED
```

This request does not approve any file currently discovered in `C:\Windows\System32`. A filename,
version resource, Authenticode signature, publisher string, or byte match with another artifact is
not Redistributable artifact provenance.

## Required Code C evidence

The Windows Candidate emits the build-bound machine evidence and rendered review request at:

```text
artifacts/python-supply-chain/pyinstaller-build/windows/parsed/
  msvc-runtime-dependency-request.v1.json
  DEPENDENCY_APPROVAL_REQUEST_MSVC_RUNTIME_V1.md
```

Those artifacts contain the complete selected-native PE import graph, direct and transitive import
chains, importer hashes and approved owners, the PyInstaller-selected Runtime family, the independently
derived import-closure-required family, and hashes plus PE/version/signature metadata for rejected
System32 copies. The generated request is authoritative for an exact Build Context; this tracked file is
the stable review envelope.

## Contract capability finding

```text
EXTERNAL_PREREQUISITE_CONTRACT_CAPABILITY: CONTRACT_EXTENSION_REQUIRED
QICR_REQUIRED: YES
OWNER_OF_NEXT_FIX: CODE_F_DEPENDENCY_AND_RELEASE_APPROVAL
```

Packaging Selection Evidence v1 currently requires its authoritative raw native entries and selected
native entries to be identical. Native Reconciliation v3 requires every selected native to map to a
materialized native entry. The shared contracts therefore cannot yet express:

```text
Raw PyInstaller selected dependency
  -> approved external prerequisite
  -> excluded from internal package selection
  -> satisfied by installer detection/installation
```

Code C must not create a private exclusion schema. Code F must approve the exact Microsoft artifact,
redistribution and license basis, and the minimum shared External Prerequisite Contract extension.

## Safety disposition

Until that approval and installer-owner implementation exist:

- do not package the System32 copies;
- do not exclude Runtime DLLs by basename from the PyInstaller spec;
- do not classify Runtime files as system-safe;
- do not assume a customer machine already has the required Runtime;
- keep the Candidate Worker build blocked.
