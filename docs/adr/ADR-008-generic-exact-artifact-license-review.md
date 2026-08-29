# ADR-008: Generic Exact-Artifact License Review

- Status: Accepted
- Date: 2026-08-29
- Owners: Code F / Quality, Release & Compliance
- Extends: Artifact License Evidence v2; v1/v2 readers remain unchanged

## Context

Python wheels commonly publish a legacy `License` value, classifiers, or license files without a
PEP 639 `License-Expression`. Automatically rewriting values such as `Apache 2.0` to SPDX would
erase upstream facts and would be unsafe for ambiguous values such as `BSD`, `GPLv2+`, or custom
terms. Treating a manually entered inventory expression as though the wheel reported it has the
same audit defect.

## Decision

Artifact License Evidence v3 is the generic raw-evidence snapshot. It binds package/version,
filename, exact wheel SHA-256, METADATA SHA-256, the reported expression, legacy value, license
classifiers, and every detected LICENSE/COPYING/NOTICE identity. Its snapshot SHA-256 excludes
mutable policy output.

Artifact License Review v1 is a separate immutable decision record. It binds the exact artifact,
the v3 snapshot, a full reviewed SPDX expression, evidence references, reviewer identity/role,
authority policy, approval method/time/reference, and its own canonical record SHA-256. The
authority allowlist is versioned separately. CI verifies these records but cannot create an
approved record.

Review history is event-based. `SUPERSEDE` must name its predecessor and `REVOKE` must name the
assertion it invalidates. Independent active assertions or competing successors fail closed; no
resolver selects the newest timestamp. A revoked assertion invalidates downstream license, SBOM,
NOTICE, and release decisions.

The reviewed expression is a license fact assertion, not a commercial-use decision. It is parsed
by the existing full SPDX parser and then evaluated by the separately versioned project policy.
SBOM and NOTICE output retain both the upstream raw value and the reviewed assertion provenance.

## Compatibility and security

- Artifact License Evidence v1/v2 and PyInstaller usage-role binding retain their meanings.
- New generic reviews require v3 evidence and Review v1; no name/version allowlist is accepted.
- A new artifact SHA, METADATA/license-file snapshot, or version requires a new review.
- Machine suggestions remain explicitly unapproved and cannot satisfy a release gate.
- Evidence with no artifact-reported license fact or file remains fail closed even if an assertion
  is proposed; external evidence must first be captured in a future versioned evidence contract.

## Code C QICR fixtures

Seven exact Linux wheel evidence snapshots from workflow run `33243775925` are stored as small
regression fixtures without wheel binaries. They include the real FlatBuffers `Apache 2.0` case,
an evidence-insufficient SentencePiece case, and a PyInstaller-hooks multi-license assertion that
continues to reach the existing GPL policy block.
