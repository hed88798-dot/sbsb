# ARCHITECTURE QUESTION — C3C Golden #13 alternative route coupling

Status: DESIGN ONLY / PENDING_BRAIN1_REVIEW. No evaluator or Golden changes in this PR.

## 问题

Brain1 accepts the two-unit NO_MATCH / START_NEW → ANIMAL / SWITCH_VISUAL interpretation as semantically acceptable, while v4 official technical/automated results remain FAIL. The original full-text ANIMAL / START_NEW alternative must remain valid. The additional boundary may cost another visual transition; it is not evidence of optimal editing.

## 现有契约

`evaluateShotPlanSemanticProposalV1` filters alternatives by the exact ordered fragment list. Its `route` dimension checks `required_facts.allowed_routes`, not every alternative unit's route. Its `continuity` dimension checks route/continuity states and actions against matching fragment lists, but does not compare route values.

For #13, the only required fact is “健康猪群活动” with allowed route ANIMAL. Adding a two-unit alternative alone could therefore accept PRODUCT → ANIMAL with the same fragments/actions/states: the second unit satisfies the required fact, and the first unit's PRODUCT is not rejected. A global ban on ANIMAL for the prefix would instead break the original whole-text ANIMAL alternative. A ban on PRODUCT alone does not express the entire approved coupled combination.

## 为什么不能直接实现

The current fixture mechanisms do not clearly encode “this exact segmentation AND these per-unit routes/states/actions” as one alternative-level acceptance predicate. Merely appending the alternative would expand acceptance beyond the approved combination. Prompt-only authorization does not authorize changing the frozen judge. This question does not block the separately approved v5 prompt changes.

## 建议方案（待批准）

Introduce a versioned evaluation-only semantic policy, separate from product IPC, canonical proposal schema, repositories, reconciliation, Candidate authority and execution contracts. Retain the v4 evaluator/Golden and historical results unchanged. In a new explicitly selected evaluation revision, a matching alternative must jointly satisfy exact fragment order, each route, route state, continuity state and allowed action; preserve source coverage, required facts, review state and forbidden-outcome checks. A pass must come from one coherent alternative, not segmentation from one and routes/actions from another.

For #13 retain A0 (whole text, ANIMAL / START_NEW) and propose A1:

```json
{
  "units": [
    {
      "exact_fragment": "这套饲养方法适用于猪，",
      "route": "NO_MATCH",
      "route_state": "RESOLVED",
      "continuity_state": "RESOLVED",
      "continuity_actions": ["START_NEW"]
    },
    {
      "exact_fragment": "画面展示健康猪群活动。",
      "route": "ANIMAL",
      "route_state": "RESOLVED",
      "continuity_state": "RESOLVED",
      "continuity_actions": ["SWITCH_VISUAL"]
    }
  ]
}
```

Version naming and policy activation require Brain1 approval. Do not add a permissive implicit fallback to the old scorer for an unsupported policy. Do not feed benchmark identifiers or source sentences into the production prompt.

## 影响范围

Evaluation helpers, evaluation revision metadata and deterministic regression tests only, if separately authorized. Product execution contracts need no change. All other 29 Golden definitions, including #11's two-unit requirement, remain unchanged. Joint matching may reveal previously untested false-positive route combinations in other fixtures; report those for review rather than silently changing expectations. Do not recompute/overwrite v4 official scores.

## 负例/兼容测试方案（未实现）

- Accept A0 and A1; reject PRODUCT → ANIMAL, NO_MATCH → PRODUCT and ANIMAL → ANIMAL for the A1 fragment list unless separately adjudicated.
- Reject wrong split point, extra/omitted/reordered units, modified source text, or mixing A0 routes with A1 segmentation.
- Reject cross-route CONTINUE_PREVIOUS, wrong first action, wrong states, and actions borrowed from another alternative.
- Preserve every approved alternative of the other 29 fixtures; preserve genuine NEEDS_REVIEW and same-route continuity alternatives.
- Mutation matrix changes one route, boundary, state or action at a time; each unsupported combination must fail. Validate policy/version selection and immutable historical evidence.
- Keep protocol validation and reconciliation independent: a schema-valid, source-reconciled Candidate can still fail the new benchmark policy.

## 是否阻塞当前工作

NO for Prompt v5 offline implementation. YES for adding the #13 alternative or implementing the proposed evaluator policy. Code A stops that part until architecture approval; no production/public contract changes are proposed or implemented here.
