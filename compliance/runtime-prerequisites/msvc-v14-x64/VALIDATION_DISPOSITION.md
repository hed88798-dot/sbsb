# MSVC v14 x64 validation-only disposition

- Disposition version: `2026.08.30.1`
- Baseline: `main@5cc44adaf6aff5ac92ef365c8387231b18e216bd`
- Consumer requirement: `code-c-msvc-v14-x64-5ead2a1`
- External prerequisite: `microsoft-vc-v14-x64-14.51.36247.0`
- Compatibility policy: `msvc-v14-x64-installed-runtime-compatibility@2026.08.30.1`
- Owner: Code F / Quality, Release & Compliance

## Decision

The product architecture and Code C engineering-validation disposition are approved as follows:

```text
TARGET_DISPOSITION: EXTERNAL_PREREQUISITE
RUNTIME_PROVIDER_CAPABILITY_APPROVAL: PASS
WORKER_EXTERNAL_RUNTIME_DISPOSITION: APPROVED_FOR_VALIDATION
VALIDATION_MODE: PREINSTALLED_COMPATIBLE_RUNTIME_ONLY
VALIDATION_AUTHORIZATION_SCOPE: CODE_C_WORKER_VALIDATION_ONLY
```

This approval means the worker may rely on a compatible Microsoft Visual C++ v14 x64 Runtime that
pre-existed the Code C validation action and satisfies the versioned compatibility policy. It does not
approve distribution, download, installation, copying, or customer delivery of `VC_redist.x64.exe`.

The existing External Runtime Prerequisite v1 contract already expresses this split. Its exact
provider identity, signature, installation probe, capability closure, and compatibility policy pass
the verify-only gate while its license and release approval remain `BLOCKED`. No schema change or
exception is required:

```text
pnpm compliance:runtime-prerequisite:verify   -> PASS (record=BLOCKED)
pnpm compliance:runtime-prerequisite:release  -> FAIL CLOSED
```

## Required worker-validation attestation

Every Code C Windows candidate that relies on this authorization must retain evidence for:

```text
VALIDATION_RUNTIME_MODE: PREINSTALLED_COMPATIBLE_RUNTIME_ONLY
INSTALLED_RUNTIME_FAMILY: Microsoft Visual C++ v14 x64 Runtime
INSTALLED_RUNTIME_VERSION: <observed version>
COMPATIBILITY_POLICY_ID: msvc-v14-x64-installed-runtime-compatibility
INSTALLED_RUNTIME_COMPATIBILITY: PASS
VC_REDIST_DOWNLOADED_BY_CODE_C: NO
VC_REDIST_BUNDLED_BY_CODE_C: NO
VC_REDIST_INSTALLED_BY_CODE_C: NO
```

The candidate must bind its consumer requirement ID/hash, external prerequisite ID/manifest hash,
Build Context ID/hash, Analysis TOC SHA-256, and the four-capability family. All four requirements use
the same external provider binding. Raw observations remain preserved; internal materialization is
`NO`; final CArchive presence is `ABSENT`.

Missing provider binding, an external entry in materialized/final contents, a failed compatibility
probe, or any Code C download/bundle/install action is a mandatory fail-closed stop.

## Redistribution and release prohibition

Until an authorized Legal Review is `PASS`:

```text
BOOTSTRAP_ARTIFACT_APPROVAL: BLOCKED_PENDING_LICENSE_REVIEW
VC_REDIST_REDISTRIBUTION: BLOCKED_PENDING_LICENSE_REVIEW
INSTALLER_BUNDLES_VC_REDIST: NO
INSTALLER_DOWNLOADS_AND_INSTALLS_VC_REDIST: NO
RELEASE_INSTALLER_AUTO_INSTALL: BLOCKED
RELEASE_INSTALLER_ACCEPTANCE: BLOCKED_PENDING_LICENSE_REVIEW
STABLE_RELEASE_ACCEPTANCE: BLOCKED_PENDING_LICENSE_REVIEW
```

The frozen bootstrap may be used by Code F only for the existing disposable quality probe that
establishes technical provider capability. It must not enter a Code C artifact, desktop installer,
offline bundle, update payload, or customer deliverable.

## Legal review track

Legal Review is active and must identify the actual licensee and use context before choosing a license
basis. Candidate products include Visual Studio Community 2026, Visual Studio Build Tools 2026,
Professional 2026, and Enterprise 2026; none is presumed applicable merely because the bootstrap is
publicly downloadable.

Official review entry points:

- [Visual Studio 2026 license directory](https://visualstudio.microsoft.com/license-terms/)
- [Visual Studio Community 2026 terms](https://visualstudio.microsoft.com/license-terms/vs2026-ga-community/)
- [Diagnostic and Build Tools for Visual Studio 2026 terms](https://visualstudio.microsoft.com/license-terms/vs2026-ga-diagnostic-buildtools/)
- [Visual C++ V14 Redistributable and Runtime 2026 terms](https://visualstudio.microsoft.com/license-terms/vs2026-ga-visualcpp-v14-redist-runtime/)
- [Visual Studio 2026 redistribution list](https://learn.microsoft.com/en-us/visualstudio/releases/2026/redistribution)

The final evidence must bind the licensee identity or role, licensed product/edition, exact license
version and terms hash, individual/organization use context, distribution entity, Visual Studio 2026
Redistribution List, unmodified bootstrap target, provider version/hash, reviewer, date, expiry, and
decision.

The following events invalidate or require review of a prior legal decision:

- licensee or distribution entity changes;
- project ownership or company transfer changes;
- use context changes between individual and organization;
- Visual Studio edition, License Terms, or Redistribution List changes;
- bootstrap artifact/version/hash changes;
- runtime servicing or redistribution policy changes.

No Community/individual conclusion automatically transfers to a future company, customer delivery
entity, organization, or software assignee.

## Code C resume authorization

```text
CODE_C_RESUME_AUTHORIZATION: PASS
SYNC_BASELINE: main@5cc44adaf6aff5ac92ef365c8387231b18e216bd
RUNTIME_DISPOSITION: EXTERNAL_PREREQUISITE
APPLICATION_REQUIRED_MSVC_DLL_FAMILY:
  - msvcp140.dll
  - msvcp140_1.dll
  - vcruntime140.dll
  - vcruntime140_1.dll
VALIDATION_RUNTIME_MODE: PREINSTALLED_COMPATIBLE_RUNTIME_ONLY
BOOTSTRAP_REDISTRIBUTION: NOT_AUTHORIZED
INSTALLER_REDISTRIBUTION: NOT_AUTHORIZED
```

This authorization permits worker packaging verification, Native Reconciliation v3, runtime smoke,
Python license work, CPython Stage B, SigLIP/index regression, large-asset validation, low-spec Windows
testing, and Golden Retrieval. It does not change any installer or stable-release gate.
