# Code F — GPL build-only license policy review

## Scope and decision

This review is limited to the exact `pyinstaller-hooks-contrib==2026.7` wheel
and its two frozen worker-build usages. It is a usage-policy review, not a new
license-facts review and not an approval of any of the other 21 required
reviews.

The current policy already models `BUILD_ONLY_USE` and distributed usage as
separate, identity-bound distribution roles. The bare `GPL-2.0-or-later`
component is nevertheless a generic `FAIL` under policy version
`2026.08.29.1`; the PyInstaller Bootloader exception does not apply to this
bare component expression. Therefore the current engineering disposition is
`DISALLOWED` / hard-blocked, while the question of whether a future generic
build-only copyleft semantic should be permitted remains a legal/policy
question. This is not a legal conclusion that all GPL build tooling is
permanently forbidden.

```text
REVIEW_STATUS: PASS
MAIN_QUALITY_BASELINE: 370236e3ccca867575908511cd7a653c2954af4d
CURRENT_LICENSE_POLICY_VERSION: 2026.08.29.1
CURRENT_LICENSE_POLICY_SHA256: 5ffff7b24c75801e1a75a888b9d4b5e40cf29e0641dcc6b5d2d2562acae4545a
CURRENT_POLICY_CAN_DISTINGUISH_BUILD_ONLY_AND_DISTRIBUTED: PASS
CURRENT_POLICY_BUILD_ONLY_GPL_DISPOSITION: HARD_REJECT
PYINSTALLER_HOOKS_FINAL_POLICY_DISPOSITION: DISALLOWED
ENGINEERING_POLICY_DECISION: LEGAL_REVIEW_REQUIRED
QICR_REQUIRED: NO
POLICY_CHANGE_ALLOWED_WITHOUT_LEGAL_REVIEW: NO
LEGAL_REVIEW_REQUIRED: YES
POLICY_DECISION_SCOPE: GENERIC
PACKAGE_SPECIFIC_EXCEPTION: NO
```

## Exact factual binding

The license facts below are the frozen Code C closure facts supplied for this
review. They are retained as inputs; this review does not rewrite coverage
records or infer a commercial-use permission from them.

| Field                                     | Frozen value                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Package                                   | `pyinstaller-hooks-contrib==2026.7`                                         |
| Artifact SHA-256                          | `24257a04c7a5a7a034cf28e39dcee20fbeeb9f043076729480f2e1b69904408a`          |
| License relationship                      | `PER_COMPONENT`                                                             |
| Component coverage                        | `PASS`                                                                      |
| Coverage evidence SHA-256                 | `91d0baaff00773038e72c0a1fc9d5d2d38706b7a2b9c04f34296608f931b9cd0`          |
| GPL component                             | `_pyinstaller_hooks_contrib/**` excluding `rthooks/**` → `GPL-2.0-or-later` |
| Apache component                          | `_pyinstaller_hooks_contrib/rthooks/**` → `Apache-2.0`                      |
| GPL component used in build               | `YES`                                                                       |
| GPL members copied into final Worker      | `0`                                                                         |
| GPL component distributed in final Worker | `NO`                                                                        |
| Hooks wheel distributed in final Worker   | `NO`                                                                        |

The two usage records are independently bound to their worker-build contexts:

| Target  | Usage binding ID                      | Usage binding SHA-256                                              | Build context ID                      | Build context SHA-256                                              |
| ------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Linux   | `code-c-linux-worker-build-py31315`   | `de1538e8753bbee056f238f6483d3f9d080eb018ec74b5f5926a58a078fcf56c` | `code-c-linux-worker-build-py31315`   | `2a768d3ecd93a5321558d1bcfcc9b6ab709adad308c9b247b021e0be19dffa79` |
| Windows | `code-c-windows-worker-build-py31315` | `c7ed5092c627fdbad3d28c7cd85246a03c1cacbbb65664c377fce94d23de7cc7` | `code-c-windows-worker-build-py31315` | `2ad1ba91864c094756f229c70400f316a120cc246de3855734e2226c07096563` |

Both records have `ARTIFACT_ROLE: PYTHON_BUILD_DEPENDENCY` and
`DISTRIBUTION_ROLE: BUILD_ONLY_USE`. The exact artifact, coverage evidence,
build context, packaging selection, final CArchive, native reconciliation and
usage binding are treated as one join. Any future member or reachability drift
is a mandatory stop for Code C; it cannot be resolved by this policy review.

## Policy analysis

The evaluator includes the bound distribution role in the policy input and in
the evaluation identity, so a build-only usage and a distributed usage of the
same bytes are not interchangeable. The policy has a generic hard-fail rule
for bare GPL identifiers. Its approved PyInstaller exception is limited to the
explicit `GPL-2.0-or-later WITH Bootloader-exception` expression and its
documented role pairs; it is not a package-name exception and cannot be
inherited by `pyinstaller-hooks-contrib`.

Consequently:

1. `GPL-2.0-or-later` + `PYTHON_BUILD_DEPENDENCY` + `BUILD_ONLY_USE` remains
   `HARD_REJECT` under the current policy.
2. The same GPL component with a distributed role remains `FAIL` and cannot
   inherit a build-only outcome.
3. A build-only assertion with a member in the final Worker, missing usage
   binding, incomplete component coverage, or mismatched artifact/context must
   fail closed.
4. The same artifact may have separate build-only and distributed usages; each
   usage is evaluated independently.
5. A different package with the same license and usage facts receives the same
   generic result. No package-specific exception or SHA allowlist is added.

The engineering decision is therefore to preserve the current hard block and
request legal review before changing the generic GPL policy. `QICR_REQUIRED` is
`NO` for this round because the existing schemas and evaluator can represent
the usage/distribution distinction. A future legal-approved disposition change
would require a new immutable policy version and a complete replay of all 37
current usage evaluations before Code C reruns License Closure.

## Regression evidence

`tests/contract/gpl-build-only-policy-review.test.ts` covers the current
fail-closed policy and the generic (package-independent) binding semantics:

```text
BUILD_ONLY_GPL_REGRESSION: PASS
DISTRIBUTED_GPL_REGRESSION: PASS
FALSE_BUILD_ONLY_ASSERTION_FAIL_CLOSED: PASS
CROSS_USAGE_NON_INHERITANCE_REGRESSION: PASS
COMPONENT_COVERAGE_FAIL_CLOSED: PASS
MISSING_USAGE_BINDING_FAIL_CLOSED: PASS
```

These are policy regressions only. They do not approve the wheel for commercial
distribution and do not replace Code C's full closure output.

## Impact and next owner

No policy file, policy version, coverage record, dependency, Worker, Inventory,
Native, CVE, model or release artifact was changed. The current universe is
therefore unchanged: 37 usages, 14 automatic policy passes, 21 required
reviews, and 2 hard-blocked usages (one unique artifact). No full-universe
replay is claimed because no policy semantics changed; target and non-target
disposition drift are both zero.

```text
ARTIFACT_LICENSE_FACTS_REVIEW_REQUIRED: NO
USAGE_POLICY_REVIEW_REQUIRED: YES
POLICY_CHANGE_IMPACT_REEVALUATION: NOT_APPLICABLE
TOTAL_USAGE_REEVALUATED: NOT_APPLICABLE
TARGET_HOOKS_USAGE_DISPOSITION_CHANGE_COUNT: 0
NON_TARGET_POLICY_DISPOSITION_DRIFT_COUNT: 0
LICENSE_DISPOSITION_PARTITION: PASS
CURRENT_21_REQUIRED_REVIEWS: UNCHANGED
LICENSE_REVIEW_PERFORMED_THIS_ROUND: NO
LICENSE_REVIEW_BUNDLE_STATUS: NOT_READY
POLICY_PR: NOT_CREATED (no policy semantics changed)
NEW_LICENSE_POLICY_VERSION: UNCHANGED
NEW_LICENSE_POLICY_SHA256: NOT_APPLICABLE
OWNER_OF_NEXT_FIX: LEGAL_REVIEW
CODE_C_NOTIFICATION: NOT_SENT
```

The hard block remains in force until an authorized legal/policy decision is
recorded. If that decision changes the disposition, Code F must publish a new
versioned policy, replay all 37 usages, verify zero non-target drift, merge it
to `main`, and only then ask Code C to rerun the complete License Closure.
