# Code F — Generic Native Runtime Companion QICR

Status: PASS (contract publication only)

Baseline: `7d8d254944fbf22e32c13279afce61a94f4dbf28`

This QICR establishes the generic `NATIVE_RUNTIME_COMPANION_BUNDLE` subject. It is a
distribution and runtime contract, not an ffprobe-specific exception. The contract can be
used by any native product runtime companion with the same evidence requirements.

## Authority and identity

Each platform is an independent subject. A canonical manifest binds the companion ID, role,
target platform and architecture, normalized entrypoint, complete member closure, runtime
dependency declarations, source release, build recipe, environment descriptor, build context,
build configuration, loader policy, distribution locator, and retention policy.

`manifest_sha256` is the SHA-256 of the canonical JSON document with only that field removed.
`companion_identity_sha256` is the SHA-256 of the canonical identity payload. The identity
payload excludes license evidence and approval disposition, but includes artifact, provenance,
configuration, locator, and runtime-loader semantics. Consequently, changing a locator or
runtime declaration changes identity even when member bytes do not.

The published QICR record sidecar hashes canonical LF JSON bytes so its identity is stable on
both POSIX and Windows checkouts.

Artifact/provenance approval, license evidence, and license policy disposition remain separate
records. This contract does not approve any exact ffprobe artifact.

## Fail-closed runtime boundary

The loader policy is `COMPANION_BUNDLE_ONLY` with resolver mode
`EXPLICIT_BUNDLED_LOCATOR` and `system_path_fallback: false`. Internal runtime members are
separate from explicitly allowlisted `EXTERNAL_OS_PREREQUISITE` entries. An unresolved or
undeclared runtime dependency fails verification. The verifier rejects missing or extra files,
hash mismatches, wrong platform/architecture or provenance, an entrypoint outside the bundle,
path traversal, absolute paths, duplicate normalized paths, Windows case collisions, undeclared
links, escaped link targets, and PATH-resolved executables.

Dynamic libraries must be declared in the runtime closure and resolve only within the approved
bundle. External operating-system prerequisites are named and allowlisted; “whatever the OS
happens to provide” is not a valid declaration.

## Integration boundary

The subject is consumed by Packaging Selection, Native Reconciliation, Runtime Dependency
Reconciliation, Distribution Component Set, SBOM, NOTICE, and Final Distribution Binding. It
does not enter the Python Artifact Inventory. Exact artifact license evidence is evaluated later
from the exact bytes and build configuration.

The existing retention model is reused: GitHub Actions is transient transport only, final bytes
are retained under the project’s local `frozen-candidates/` logical root, and a recovery drill
is required. Future retention receipts must bind bundle identity, manifest/member/entrypoint
hashes, platform/architecture, retained bytes, and recovered bytes.

## Scope of this QICR

The schema, verifier, and negative regression matrix are published and tested on both Linux and
Windows-shaped subjects. No source download, native build, ffprobe packaging, Worker rebuild,
license/SBOM/NOTICE/vulnerability rebind, or Code C acceptance was performed. The exact Linux
and Windows ffprobe artifacts remain `NOT_YET_PRODUCED`.

Next owner after this QICR is Code C for the pinned-source, platform-specific exact companion
artifact build.
