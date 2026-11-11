# C3C Golden evaluation v2 — alternative joint matching

Scope: offline evaluation-only implementation approved by Brain1. Code F independent review and Brain1 final acceptance remain pending. No real-model authorization is implied.

## Version selection and immutable history

- Policy: `SHOT_PLAN_ALTERNATIVE_JOINT_MATCHING_V2`.
- Golden revision: `SHOT_PLAN_SEMANTIC_GOLDEN_V2`.
- New fixture SHA256: `99bf556ee381cd561ec82bd3f9986bd2698d5bef8d9c5932e4860facbbd1aa62`.
- Historical policy: `SHOT_PLAN_SEMANTIC_EVALUATION_V1`.
- Historical Golden SHA256 remains `cae36779b5ba91a8ed774e7302bb7ddffaae2bc40ac439dba17828427464d498`.
- Hash serialization: UTF-8 bytes of `JSON.stringify(fixtures)`; machine-readable authority is in `tests/fixtures/shot-plan-semantic-golden-v2-authority.json`.

The existing V1 evaluator and fixture source file are unchanged. V2 deep-clones V1 and appends only the approved #13 alternative. No source, required fact, forbidden outcome, review expectation or existing alternative is edited. #11 and the other 28 cases are identical to V1.

`selectShotPlanGoldenEvaluationPolicy(policy)` requires an explicit supported identifier; unknown identifiers throw. The existing Harness defaults to V1 for compatibility. V2 requires `evaluationPolicy: JOINT_ALTERNATIVE_EVALUATION_V2`; Prompt version never selects a scorer implicitly. The opt-in real canary can forward an explicit `REAL_SHOT_PLAN_GOLDEN_EVALUATION_POLICY`, validated before constructing its environment. Adding this selection does not authorize running it.

Each new report records the selected policy, revision, evaluator/fixture authority and actual fixture SHA256. V2 reports use `c3c-real-golden-evaluation-v2`; V1 keeps its existing report schema identity. The Harness checks the pinned revision hash before dispatch and retains exclusive evidence-file creation, preventing existing files from being overwritten. Historical v4 reports, the 39 requests, settlement records and official FAIL are not rescored or rewritten.

## Acceptance predicate

Canonical validity, exact source binding/coverage and ordered segmentation must pass. One and the same alternative must match every unit's exact fragment, route, route state, continuity state and allowed continuity action. Omitted Golden states mean RESOLVED, as before. An empty action set requires `null`, rather than serving as a wildcard.

Existing required facts, forbidden outcomes and expected NEEDS_REVIEW remain mandatory independent gates. V2 returns `joint_alternative_match`, matched alternative indexes and `overall_pass`. Per-dimension diagnostics can each pass against different alternatives, but their conjunction cannot bypass `overall_pass`; the Harness explicitly requires the joint predicate. Schema-valid, reconciled Candidate status alone cannot establish semantic PASS.

The source-binding check retains the historical Unicode code-point, ordered, non-whitespace coverage semantics, including exact adjacent context for duplicate fragments. No production canonical validator, normalizer, reconciler, Candidate authority or execution instruction changes are included.

## Approved #13 alternatives

| Alternative | Exact fragment                               | Route    | Action        | Route / continuity states |
| ----------- | -------------------------------------------- | -------- | ------------- | ------------------------- |
| A           | 这套饲养方法适用于猪，画面展示健康猪群活动。 | ANIMAL   | START_NEW     | RESOLVED / RESOLVED       |
| B1          | 这套饲养方法适用于猪，                       | NO_MATCH | START_NEW     | RESOLVED / RESOLVED       |
| B2          | 画面展示健康猪群活动。                       | ANIMAL   | SWITCH_VISUAL | RESOLVED / RESOLVED       |

B is a reasonable candidate with a possible extra visual transition, not a claim of optimal editing. No other two-unit route combination is approved. Wrong boundaries, units, states or actions fail; cross-route CONTINUE_PREVIOUS fails. Whole-text A remains valid. The past v4 FAIL stays unchanged.

## Compatibility and retained counterexamples

Every original alternative of the other 29 cases, including every permitted continuity-action combination, is checked unchanged. #11 retains its two-unit positive and schema-valid merged negative. Tests distinguish NEEDS_REVIEW from NO_MATCH, reject invalid duplicate anchors and source loss, exercise explicit policy selection and report isolation, and demonstrate mixed-alternative false positives cannot become PASS.

A deterministic single-unit route mutation sweep found **15 legacy false-positive combinations across 6 other fixtures**: alt-segmentation, same-route-boundaries, continuity-alternative, duplicate-anchor, product-name-animal-outcome and stable-animal-concept. Full reconstructible mutation records are retained in `tests/fixtures/shot-plan-semantic-legacy-route-counterexamples.json`, bound to the old Golden hash. V1 still reproduces them; V2 rejects them. This is a synthetic evaluator finding, not retrospective evaluation of any historical model output. No approved Golden expectation was relaxed to preserve a score.

## Independent review / stop boundary

Code F should verify single-alternative coupling, mandatory global constraints, explicit policy selection, pinned hashes, immutable V1 source/history, every original permitted action combination, the retained mutation counterexamples and the Harness final PASS gate. Prompt v5, product Schema/Zod, Gateway/Provider/Adapter, retries, reconciliation and execution contracts remain unchanged. Real Provider requests: 0. No real 30-case, budget increase, merge or C3D.
