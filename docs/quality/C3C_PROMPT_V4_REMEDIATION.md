# C3C Prompt v4 precedence and structural conformance

Base: `1d814ededf0eae4cbddc1496c2201ee34c50828e` (Security Wave E4 / PR #83).

Prompt identity remains `shot-plan.semantic-proposer`; version advances from `3` to `4`.
Provider, model, wire settings, strict structured output, canonical schema and normalization are unchanged.

The prompt now states that explicit observable animal or product evidence survives an attached abstract or normative phrase. Concrete product specifications need no imperative “show” wording. Explicit checking of a package/label remains PRODUCT even for compliance text; merely citing label authority does not establish viewing intent. Animal-state observation remains ANIMAL despite management verbs. Pure abstract instructions without concrete visual evidence remain NO_MATCH. Independent observable state dimensions may require separate semantic units while retaining visual continuity.

Warnings must use the existing object-array schema with `code`, `severity` and `message`; severity is INFORMATIONAL or BLOCKING. Invalid string warnings remain invalid. No warning repair, route repair or continuity repair was added. The only compatibility normalization remains OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1.

## Approved Golden changes

- #4 retains null route / NEEDS_REVIEW, adds first-unit START_NEW / RESOLVED continuity, and retains its original review continuity alternative.
- #18 changes its reference-only label-authority unit from PRODUCT to NO_MATCH. Exact fragments, segmentation and SWITCH_VISUAL remain unchanged.
- The other 28 fixtures retain their original semantic hashes. In particular #11, #14, #17 and #22 remain regressions for the captured v3 outputs.

## Offline captured v3 replay

`tests/fixtures/shot-planning/captured-prompt-v3-offline.json` is a deterministic excerpt from the completed v3 evaluation, not a new model run. It preserves the original summary, the last-attempt canonical proposal for each of the 29 technically complete cases, and the captured noncanonical evidence for #4. It also records per-Golden hashes and the two pre-correction Goldens so tests can bound the approved changes.

Original evidence hashes (SHA256 of complete original file bytes):

- Cases: `c3657c90d11339571c69040ce120b03e89b36ca726c60fd56001b47694ccc54a`.
- Summary: `e947f8c96fd73997ee31b51469727233130ba61db46a1398ebb93bdeea886277`.

The original v3 report remains 29 technically complete, 24 automated PASS, 5 automated FAIL and 1 NOT_EVALUATED, with 39 Provider requests costing 0.168930 CNY. It is not rewritten by this remediation.

Against the corrected Goldens, the offline captures yield 25 compatible canonical proposals, 4 semantic failures (#11/#14/#17/#22), and 1 noncanonical case (#4). Only #18 changes from automated FAIL to compatible. #4 still has no canonical proposal: the original bounded raw evidence identifies a string warning through `invalid_warning_type`, without preserving that warning's text. This task neither reconstructs it nor invents a canonical result.

These offline results support adjudication of historical v3 evidence. They are not Prompt v4 model-quality acceptance. Production prompt tests exclude fixture identifiers, source fragments and expected JSON from the general rules.

## Local static acceptance

- Focused C3B/C3C, prompt, Golden, reconciler and normalization suites: 240 PASS.
- Full Vitest: 1445 PASS / 6 skipped; media-worker: 26 PASS / 1 existing model-pack skip.
- Format, lint, workspace typecheck, strict evaluation-helper typecheck, package resolution, dependency direction, portability, workflow security, secret/license scan, vulnerability gate, Golden verification, build and SBOM: PASS.
- Security baseline: Critical 0 / High 0 / Moderate 0 / existing approved Low 1. Dependency and lockfile bytes are unchanged. License first-pass: 700 packages, 0 manual review.
- Schemas, generated schema binding, Zod, normalization implementation, Provider/wire, Render, Runtime and migrations are unchanged.
- Real Provider requests in this task: 0. Real 30-case run: NO. Product Render rerun: NO.

Exact-head Linux and Windows workflow evidence belongs in the stacked Draft PR after local validation; local macOS results do not establish Windows acceptance.

## Review and authorization boundary

No real Provider request, canary, 30-case evaluation or product Render is authorized in this task. Code F static semantic review must precede any Brain1 decision about a fresh complete v4 evaluation. PR #82 and PR #83 remain unchanged; this work is a new stacked Draft PR and must not merge them.
