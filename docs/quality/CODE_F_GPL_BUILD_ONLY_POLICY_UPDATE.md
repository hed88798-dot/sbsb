# Code F — Generic GPL Build-only Policy Update

This change supersedes the hard-block disposition recorded by the prior
`2026.08.29.1` review. It changes policy semantics only; it does not change
the `pyinstaller-hooks-contrib` license facts, coverage records, Worker, or
any of the 21 separate required reviews.

## Policy decision

Policy `2026.09.02.1` adds the package-independent
`COPYLEFT_BUILD_ONLY_USE-v1` rule. A GPL-covered component is
`ALLOW_WITH_CONDITIONS` only when all of the following are exact, positive
facts in the usage context:

- `BUILD_ONLY_USAGE_BINDING: PASS`
- `GPL_COMPONENT_DISTRIBUTED: NO`
- `GPL_COMPONENT_MEMBERS_IN_FINAL_ARTIFACT: 0`
- `COMPONENT_COVERAGE: COMPLETE`
- `FINAL_ARTIFACT_RECONCILIATION: PASS`
- `GPL_COVERED_CODE_COPIED_OR_INJECTED_INTO_FINAL_OUTPUT: NO`

Missing or contradictory evidence fails closed with
`ADDITIONAL_ENGINEERING_EVIDENCE_REQUIRED`. The underlying bare GPL SPDX
rules remain `FAIL` when no complete usage context is supplied. Distributed
roles never inherit a build-only result, and no package name or artifact SHA
allowlist is used. Third-party dependencies collected by a hook remain
independently evaluated under their own licenses.

The prior policy is preserved byte-for-byte at
`compliance/license-policy/python-spdx-v1/versions/2026.08.29.1.json`.

## Exact target and impact replay

The frozen target remains `pyinstaller-hooks-contrib==2026.7`, artifact
SHA-256 `24257a04c7a5a7a034cf28e39dcee20fbeeb9f043076729480f2e1b69904408a`.
Its two worker-build usages change from `FAIL` to `PASS` with disposition
`ALLOW_WITH_CONDITIONS`. The immutable current-universe partition is replayed
by `tools/license-policy/re-evaluate-usage-universe.mjs`:

```text
TOTAL_USAGE_REEVALUATED: 37
TARGET_HOOKS_USAGE_DISPOSITION_CHANGE_COUNT: 2
NON_TARGET_POLICY_DISPOSITION_DRIFT_COUNT: 0
LICENSE_DISPOSITION_PARTITION: PASS
PRE_CHANGE: PASS 14 / MANUAL_REVIEW 21 / FAIL 2
POST_CHANGE: PASS 16 / MANUAL_REVIEW 21 / FAIL 0
```

The 21 required reviews remain unchanged and are not approved by this round.
Code C must consume the new main baseline, rerun the complete 37-usage
License Closure, and stop with `HARD_BLOCKED_USAGE_COUNT: 0` and
`LICENSE_REVIEW_BUNDLE_STATUS: READY_FOR_CODE_F` before any later review.

## Verification

```text
BUILD_ONLY_GPL_REGRESSION: PASS
DISTRIBUTED_GPL_FAIL_CLOSED: PASS
GPL_OUTPUT_INJECTION_FAIL_CLOSED: PASS
CROSS_USAGE_NON_INHERITANCE: PASS
POLICY_VERSION_ARCHIVE_AND_LOCK: PASS
```
