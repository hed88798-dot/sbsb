# Code D Open-Source Reference Review

Review date: 2026-09-09  
Review mode: architecture-compatible patterns only  
Default outcome: `BORROW_PATTERN: YES`, `COPY_CODE: NO`, `PRODUCTION_DEPENDENCY: NO`

This is a commercial-use precheck, not legal advice. No reviewed source code or runtime dependency is incorporated, so no reviewed repository creates a distribution obligation for Code D V0.1.

## Reviewed references

| Repository                       | Exact reviewed commit                      | SPDX / commercial use | Relevant pattern                                                                           | Borrow                                                           | Reject / Code 0 compatibility                                                                                                                      | Obligations and risk                                                                                                                                                             | Production dependency |
| -------------------------------- | ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `harry0703/MoneyPrinterTurbo`    | `e14134d86a00830614bbb8feff194869c655f3e2` | MIT / ALLOWED         | Group clips by source, use one primary clip per source before overflow                     | unique-first and explicit overflow/fallback                      | Reject `random.shuffle`, file path identity and non-authoritative history. Python/video pipeline is not the domain/Main/SQLite boundary            | MIT copyright + permission notice required for copied substantial portions; no NOTICE; no copyleft/source disclosure; Python/media transitive risk avoided because no dependency | NO                    |
| `kubernetes/kubernetes`          | `82b6b6d3b2fc1b9882ea500b54fca32c8d862e68` | Apache-2.0 / ALLOWED  | Filter, Score, Reserve/Unreserve, Bind and idempotent cleanup                              | phase separation and reserve-before-commit reasoning             | Reject Kubernetes runtime, plugins, cluster state, API server and distributed scheduling. Pattern maps cleanly to pure selector + Main transaction | Apache license/attribution retention and conditional NOTICE handling would apply to copied/distributed code; no copyleft/source disclosure; massive Go dependency graph avoided  | NO                    |
| `recommenders-team/recommenders` | `0bb4b3690941ffb668118e31ccaf8a7d19f8212a` | MIT / ALLOWED         | diversity, novelty, coverage and ranking evaluation beyond accuracy                        | batch asset/shot coverage, repeat and usage-distribution metrics | Reject Python/Pandas recommender runtime and model training; evaluation ideas are architecture-compatible                                          | MIT copyright + permission notice if copied; no copyleft/source disclosure; scientific Python transitive risk avoided                                                            | NO                    |
| `open-policy-agent/opa`          | `152afb102c0cbf2380b8b43fe62932f0a63822a3` | Apache-2.0 / ALLOWED  | policy evaluates facts and returns a decision; execution/enforcement stays with the caller | strict Policy != Execution boundary                              | Reject Rego, Go runtime, HTTP/SDK integration and a second policy service. A typed TS object is sufficient                                         | Apache license/attribution and conditional NOTICE rules if copied; no copyleft/source disclosure; runtime/transitive risk avoided                                                | NO                    |
| `CacheControl/json-rules-engine` | `e1f1fda81bb384752531dc29a3817672df51d439` | ISC / ALLOWED         | JSON-serializable rules, explicit priorities and persistent representation                 | centralized typed policy snapshot and ordered preferences        | Reject general-purpose async rule evaluation and same-priority parallel semantics; unnecessary dependency for a small deterministic policy         | ISC copyright + permission notice if copied; no NOTICE/copyleft/source disclosure; npm transitive risk avoided                                                                   | NO                    |
| `TimefoldAI/timefold-solver`     | `022d34d8d7199fc9b8d7ad8d2f45eb1d27e703ba` | Apache-2.0 / ALLOWED  | hard constraints outrank soft preferences; constraint explanation                          | hard filter separated from relaxable scarcity preferences        | Reject Java 21/Kotlin solver, search optimization and second runtime. V0.1 is a bounded deterministic ranking problem                              | Apache license/attribution and conditional NOTICE rules if copied; no copyleft/source disclosure; Java/Python bridge risk avoided                                                | NO                    |

## Decision

The reference review supports a small, typed, deterministic, auditable TypeScript policy engine. Direct reuse would add architecture weight without improving the bounded V0.1 problem.

```text
CODE0_ARCHITECTURE_COMPATIBILITY: PASS
COMMERCIAL_LICENSE_PRECHECK: PASS
CODE_COPIED: NO
NEW_PRODUCTION_DEPENDENCIES: NONE
REJECT_DIRECT_REUSE: YES
```

## Pinned evidence links

- MoneyPrinterTurbo: [unique-first implementation](https://github.com/harry0703/MoneyPrinterTurbo/blob/e14134d86a00830614bbb8feff194869c655f3e2/app/services/video.py), [MIT license](https://github.com/harry0703/MoneyPrinterTurbo/blob/e14134d86a00830614bbb8feff194869c655f3e2/LICENSE)
- Kubernetes: [Scheduler Framework interfaces](https://github.com/kubernetes/kubernetes/blob/82b6b6d3b2fc1b9882ea500b54fca32c8d862e68/staging/src/k8s.io/kube-scheduler/framework/interface.go), [Apache-2.0 license](https://github.com/kubernetes/kubernetes/blob/82b6b6d3b2fc1b9882ea500b54fca32c8d862e68/LICENSE)
- Recommenders: [evaluation metrics](https://github.com/recommenders-team/recommenders/blob/0bb4b3690941ffb668118e31ccaf8a7d19f8212a/recommenders/evaluation/python_evaluation.py), [MIT license](https://github.com/recommenders-team/recommenders/blob/0bb4b3690941ffb668118e31ccaf8a7d19f8212a/LICENSE)
- OPA: [policy decision model](https://github.com/open-policy-agent/opa/blob/152afb102c0cbf2380b8b43fe62932f0a63822a3/README.md), [Apache-2.0 license](https://github.com/open-policy-agent/opa/blob/152afb102c0cbf2380b8b43fe62932f0a63822a3/LICENSE)
- json-rules-engine: [rule priority and JSON persistence](https://github.com/CacheControl/json-rules-engine/blob/e1f1fda81bb384752531dc29a3817672df51d439/docs/rules.md), [ISC license](https://github.com/CacheControl/json-rules-engine/blob/e1f1fda81bb384752531dc29a3817672df51d439/LICENSE)
- Timefold Solver: [hard/soft constraint documentation](https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/overview), [Apache-2.0 license](https://github.com/TimefoldAI/timefold-solver/blob/022d34d8d7199fc9b8d7ad8d2f45eb1d27e703ba/LICENSE.txt)
