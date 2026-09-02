# Versioned SPDX License Policy

`python-spdx-v1/policy.json` is policy data, not artifact evidence and not parser code. Its canonical-JSON SHA-256 and version are locked in `compliance/quality-tooling/npm/spdx-expression-policy.lock.json`, so checkout line endings cannot change policy identity.

CI is verify-only. It must not download a current SPDX License List, Exception List, parser, or policy and immediately use it for a gate. The approved runtime identity is:

- parser: `spdx-expression-parse@5.0.0`
- license identifiers: `spdx-license-ids@3.0.23`, SPDX License List 3.28.0
- exception identifiers: `spdx-exceptions@2.5.0`, SPDX Exception List 3.23
- policy: `2026.09.02.1`

Policies `2026.08.28.1`, `2026.08.28.2`, and `2026.08.29.1` are archived byte-for-byte under
`python-spdx-v1/versions/`. The first continues to reproduce `MIT-CMU` as a missing-rule failure;
the second introduced the identifier-level `MIT-CMU-commercial-v1` decision. Policy `2026.08.29.1`
is the prior context-bound Artifact Usage Binding policy. Current policy `2026.09.02.1` adds the
generic `COPYLEFT_BUILD_ONLY_USE-v1` semantic: GPL build dependencies are
`ALLOW_WITH_CONDITIONS` only when exact build-only, coverage, reconciliation, non-distribution,
zero-final-member, and no-copy/no-injection facts are present. Missing facts remain fail-closed;
the bare SPDX license rules remain hard-fail outside that fully bound usage context.

Artifact License Evidence v2 separates immutable SHA-bound package/file-level license facts from
Artifact Usage Binding v1. A usage binding references Build Artifact Provenance v1 and independently
records dependency, functional and distribution roles, exact exception sources, policy identity and
build/runtime/customer reachability. License Policy Evaluation v3 validates this join; a PASS is
never a permanent artifact allowlist. Artifact License Evidence v1 and Evaluation v2 retain their
original meanings for historical replay.

Artifact License Evidence v3 and Artifact License Review v1 add a generic path for wheels that do
not report a valid SPDX `License-Expression`. V3 preserves raw METADATA/classifier/license-file
facts and an immutable snapshot identity. Review v1 separately binds an authorized full SPDX
assertion to that exact artifact and snapshot, with explicit supersession/revocation and a hashed
approval record. CI is verify-only: a machine suggestion or package-name mapping is never an
approval. See ADR-008.

Exact PyInstaller 6.22.2 Windows/Linux scan records under `compliance/license-evidence/` preserve
the package GPL-2.0-or-later with Bootloader exception, Apache-2.0 runtime hooks, and the dual-licensed
isolated module. The scanner hashes every file in each declared scope and fails if the wheel hash,
metadata, license-candidate set or evidence-file hash changes.

Wheel-level bundled license evidence is a separate contract. Exact scans under
`compliance/license-evidence/` record metadata, every license/notice candidate, native
payload hashes, component section identities, and the containing wheel SHA-256. A
bundled review is artifact-bound; a new wheel hash, license-file hash, component set, or
scan identity fails closed and requires a new review. This does not turn an artifact-
specific review into a global license allowlist.

An update requires a short reviewed PR that changes exact package versions/integrities/tarball hashes, dataset file hashes and upstream release identities as applicable; records license, source, provenance and vulnerability review for every new quality-tool artifact; changes the policy version whenever a rule or result can change; runs old artifact evidence through the new policy; archives the result diff; regenerates the SBOM; and passes Linux/Windows gates. An SPDX data or parser update without the corresponding lock identity change fails CI.

Artifact evidence is immutable input. Reviewers must never rewrite an artifact's declared expression to make a policy result pass. `acceptable_or_branches` and `selected_policy_branch` are decision data; the SBOM retains the complete declared expression.

For every decision that requires notice materialization, `tools/license-policy/notices.mjs`
binds the notice entry to the package/version, containing artifact SHA-256, source,
license-evidence path/hash, policy identity, and complete materialized license bundle.
Recording an obligation without producing the notice file is not a release PASS.
