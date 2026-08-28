# ADR-002: Packaged Native and Python Toolchain Provenance

- Status: Accepted
- Date: 2026-08-28
- Owners: Code F / Quality, Release & Compliance
- Issue: #12

## Context

Packaged Native Inventory v1 models every native file as owned by a Python wheel and only scans loose files. A PyInstaller one-file executable contains a separate bootloader layer and an embedded CArchive. Its CPython runtime and PyInstaller support are legitimate toolchain-owned artifacts, not wheel-owned files. Reassigning them to a wheel, ignoring them, or treating an unparsed zero-file scan as success would corrupt provenance.

## Decision

The public contract is split into four explicit layers:

1. Python Artifact Inventory v2 remains the approved wheel graph; its semantics do not change.
2. Python Toolchain Artifact Inventory v1 records exact CPython, pip, PyInstaller and bootloader inputs, including artifact hashes, provenance, license, vulnerability review and build/runtime usage scopes.
3. Packaged Native Inventory v2 represents a statically parsed PyInstaller one-file artifact. It separates the bootloader layer from CArchive payload entries and supports `WHEEL_OWNED_NATIVE` and `TOOLCHAIN_OWNED_NATIVE`. Unknown owners and zero-native parse results fail closed.
4. Build Artifact Provenance v1 binds the final worker hash to the build commit, configuration hash, target, exact wheel manifests, exact toolchain manifest and the observed bootloader/archive layer hashes.

PyInstaller one-file inspection uses the locked official `PyInstaller.archive.readers.CArchiveReader` implementation. Every embedded native entry is extracted in memory and hashed from its actual payload bytes.

## Compatibility and migration

- Packaged Native Inventory v1 retains its original loose-file/one-folder semantics and reader unchanged.
- v2 is required for PyInstaller one-file artifacts. v1 cannot be automatically upgraded because it lacks the final executable, archive, toolchain and build provenance. Migration is an explicit re-inspection of the final one-file artifact with approved toolchain and build manifests.
- Existing Python Artifact Inventory v1/v2 readers and wheel ownership rules remain unchanged.
- Consumers may read v1 or v2 by `schema_version`; release reconciliation selects v2 whenever the final artifact type is `PYINSTALLER_ONEFILE`.
- v1 is deprecated for one-file claims immediately, but remains supported for truthful loose-file inventories until a separate removal decision.

## Reproducibility boundary

This gate requires every formal build to produce a unique final SHA-256 with complete input and build provenance. It does not require two independent PyInstaller builds to be byte-for-byte identical. A future reproducible-build requirement needs a separate ADR and gate.

## Consequences

- CPython runtime files must trace to an exact approved CPython distribution artifact.
- pip can remain build-only and is not expected inside the final runtime.
- The bootloader input hash, observed packaged bootloader-layer hash, CArchive payload hash and final executable hash are distinct identities.
- Any unparsed, zero-native, unknown-owner, missing, unexpected or hash-mismatched native payload blocks release.
