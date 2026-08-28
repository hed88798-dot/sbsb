# Versioned SPDX License Policy

`python-spdx-v1/policy.json` is policy data, not artifact evidence and not parser code. Its canonical-JSON SHA-256 and version are locked in `compliance/quality-tooling/npm/spdx-expression-policy.lock.json`, so checkout line endings cannot change policy identity.

CI is verify-only. It must not download a current SPDX License List, Exception List, parser, or policy and immediately use it for a gate. The approved runtime identity is:

- parser: `spdx-expression-parse@5.0.0`
- license identifiers: `spdx-license-ids@3.0.23`, SPDX License List 3.28.0
- exception identifiers: `spdx-exceptions@2.5.0`, SPDX Exception List 3.23
- policy: `2026.08.28.2`

Policy `2026.08.28.1` is archived byte-for-byte under `python-spdx-v1/versions/` and
continues to reproduce `MIT-CMU` as a missing-rule failure. Policy `2026.08.28.2` adds
the identifier-level `MIT-CMU-commercial-v1` decision. It does not normalize `MIT-CMU`
to `MIT`, and it does not approve other SPDX identifiers by family or pattern.

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
