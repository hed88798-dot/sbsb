# ADR-004: MIT-CMU Commercial Policy and Bundled License Evidence

- Status: Accepted
- Date: 2026-08-28
- Owners: Code F / Quality, Release & Compliance
- Review reference: QICR-001

## Context

Pillow 12.3.0 cp313 Windows and Linux wheel evidence consistently declares `MIT-CMU`.
Policy `2026.08.28.1` parsed that identifier but correctly failed because it had no project
commercial rule. Exact-byte inspection also found third-party license sections in the
distributed license bundle, so a top-level MIT-CMU decision alone was insufficient.

## Decision

Policy `2026.08.28.2` adds only the global identifier rule
`MIT-CMU-commercial-v1`, based on SPDX License List 3.28.0 evidence. Closed-source
commercial use and distribution are approved with obligations to preserve copyright,
permission and license notices, retain them in supporting distribution material, and
avoid endorsement or publicity-name use without written permission. `MIT-CMU` remains
`MIT-CMU`; it is never rewritten as `MIT`.

The old policy remains immutable and reproduces the old missing-rule failure for the same
artifact evidence. The new result is a project policy decision, not a change to the wheel
or its SPDX fact.

QICR-001 adds an independent Bundled License Evidence v1 contract. Exact Pillow wheel
reviews are tied to the wheel hash, scan identity, complete license-evidence hash and
component set. They approve only those evidence bundles and do not create global rules
for FTL, IJG, Libpng, Zlib, LicenseRef or any license family. Unknown artifacts and
unreviewed expressions continue to fail closed.

Release assembly must emit the full bundled license text into `THIRD_PARTY_NOTICES`, bind
each top-level and bundled entry to the exact wheel identity, and keep bundled components
separate in SBOM output. A recorded obligation without a materialized notice is a release
failure.

## Consequences

- The MIT-CMU rule is reusable by any artifact with consistent evidence.
- Windows and Linux Pillow wheels remain separately auditable.
- New Pillow versions or wheels require new exact scans and bundled reviews.
- No Python 3.13, wheel compatibility, native-owner, or business architecture decision is
  reopened.
