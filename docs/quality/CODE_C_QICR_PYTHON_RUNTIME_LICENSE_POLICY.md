# Quality Infrastructure Change Request — MIT-CMU runtime wheel policy

Date: 2026-08-28 (Asia/Shanghai)

Status: `RESOLVED_BY_MAIN_56E8233` (historical)

Resolution: Code F PR #15 added the public `MIT-CMU` rule, exact Windows/Linux Pillow
bundled-license reviews, SBOM linkage, and notice materialization under License Policy
`2026.08.28.2` on `main@56e8233a93f0fbd69e7e0f752ce691e31624d69c`.

Code C rebased the unchanged evidence onto that baseline and reran the shared quality-tool lock plus
`tests/contract/python-spdx-license-policy.test.ts`. All 19 assertions passed, including the historical
PyInstaller/packaging expressions and both exact Pillow artifact hashes. C-1 resumed from this point; this
document remains immutable historical evidence of why the previous run stopped.

Owner requested: Code F

Blocked work: Code C C-1 CPython 3.13.15 standard-GIL production supply-chain closure for PR #8

Historical failing baseline: `84e7befb53cbcbc28fb39924ad36cce408d0760b`

Resolving baseline: `56e8233a93f0fbd69e7e0f752ce691e31624d69c`

## Actual assertion failure

Code C first verified that the new shared quality tooling passes the historical PyInstaller 6.22.2
`GPL-2.0-or-later WITH Bootloader-exception` and packaging 25.0
`Apache-2.0 OR BSD-2-Clause` evidence. It then evaluated Artifact License Evidence v1-equivalent records bound
to the exact Pillow 12.3.0 wheel hashes and hash-verified PEP 658 metadata selected for the approved standard
`cp313` Windows and Linux runtime targets.

| Target               | Exact wheel                                                                 | Wheel SHA-256                                                      | PEP 658 METADATA SHA-256                                           | Exact upstream expression | Policy v2 result |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------- | ---------------- |
| Windows x64 / cp313  | `pillow-12.3.0-cp313-cp313-win_amd64.whl`                                   | `1cca606cd25738df4ed873d5ad46bbdb3d83b5cbca291f6b4ff13a4df6b0bbe8` | `2c4378001803cfac65809a50722d46e0da4ce8061e717f103e5d52734bab30f5` | `MIT-CMU`                 | `FAIL`           |
| Linux x86_64 / cp313 | `pillow-12.3.0-cp313-cp313-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl` | `0847a763afefb695bc912d7c131e7e0632d4edc1d8698f58ddabec8e46b8b6d3` | `8fc07146cab33ef7582361dab6eac596d340b03ec648f18217da7894f73838c8` | `MIT-CMU`                 | `FAIL`           |

The exact files and metadata identities came from the canonical PyPI 12.3.0 release JSON and
`files.pythonhosted.org` PEP 658 metadata endpoints. Both metadata documents declare `Name: pillow`,
`Version: 12.3.0`, `License-Expression: MIT-CMU`, and `License-File: LICENSE`.

Shared evaluation identity:

```text
LICENSE_POLICY_VERSION: 2026.08.28.1
LICENSE_POLICY_SHA256: 93e0ad3c2c723492d5ea5e1d3dd634239c80822489678a35fc458782eb993f84
NORMALIZED_EXPRESSION: MIT-CMU
POLICY_RESULT: FAIL
REASON: SPDX identifier has no rule in the pinned commercial policy
ASSERTIONS_EXECUTED: 2
ASSERTIONS_FAILED: 2
```

This is not unknown metadata and not a request to rewrite Pillow's license. The pinned SPDX parser recognizes
and normalizes `MIT-CMU`; the public commercial policy simply has no decision rule for it. Pillow is a real
production runtime dependency and both approved architecture targets have standard `cp313` binary wheels.

## Requested public change

Code F should make a shared, reviewed, fail-closed policy decision for `MIT-CMU`:

1. add the explicit `MIT-CMU` rule and its retained obligations to the versioned public Python license policy;
2. add contract tests using Artifact License Evidence v1 for `RUNTIME_WHEEL` / `RUNTIME_DISTRIBUTION`;
3. prove unknown SPDX ids and metadata conflicts remain rejected;
4. publish the new policy version and SHA-256 so Code C can rerun the same two exact artifact assertions.

Code C must not add a package-name exception, private allowlist, private policy file, license rewrite, or bypass.
After this rule is available, Code C must still evaluate every remaining wheel/toolchain artifact; no unexecuted
expression is claimed as passing in this QICR.

## Mandatory-stop boundary

The baseline sync and continuation workaround audit passed. The historical PyInstaller/packaging blocker is
resolved. Everything after the Pillow assertion—including ADR-018 creation, standard-GIL runtime attestation,
`cp313t` negative control, formal inventories, hash installs, SBOM/vulnerability gates, one-file builds, native
reconciliation, regressions, remote CI, and push—is `BLOCKED_NOT_RERUN_AFTER_MANDATORY_STOP`.

That status describes the historical run only. It was cleared by the exact-evidence rerun above and is not
carried forward as a result for the resumed C-1 run.
