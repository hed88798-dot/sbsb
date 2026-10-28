# Code B C3C Alibaba Model Studio Provider Preflight

Checked at: `2026-10-23T17:58:03Z`

This record covers documentation evidence and the frozen server-side wire policy only. It does not
record a real Provider call, a legal approval, or C3C semantic acceptance. The real Provider canary
and the 30-case evaluation remain disabled.

## Frozen execution identity

| Field                  | Frozen value                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Provider               | Alibaba Cloud Model Studio                                                                         |
| Region                 | China (Beijing)                                                                                    |
| Gateway model alias    | `text.semantic-shot-planning`                                                                      |
| Provider adapter alias | `alibaba-beijing-qwen37-plus-20260526-c3c-nonthinking`                                             |
| Provider model         | `qwen3.7-plus-2026-05-26`                                                                          |
| Endpoint shape         | `https://<redacted-workspace-id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions` |
| Thinking               | explicitly disabled (`enable_thinking: false`)                                                     |
| Temperature            | `0.7`                                                                                              |
| Structured output      | `response_format.type=json_schema`, `strict=true`                                                  |
| Schema name            | `ShotPlanSemanticProposalV1`                                                                       |
| Output limit on wire   | none; `max_tokens` and `max_completion_tokens` omitted                                             |
| Provider fingerprint   | not provided without a real response                                                               |

The dedicated adapter rejects a non-Beijing endpoint, absent or differently named strict
structured-output authority, a serialized Provider request larger than 128 KiB, pricing below the
reviewed Beijing rates, and any deployment identity that does not match the frozen
alias/model/capability/currency. The frozen C3C service remains the authority for the exact schema
document; the adapter pins only its expected name. The adapter exposes no arbitrary Provider
parameter map. The generic `OpenAiCompatibleTextAdapter` remains unchanged.

The deployment loader additionally requires this adapter to be the primary for
`text.semantic-shot-planning` at the standard tier, forbids a fallback on that route, and forbids
using the frozen adapter as another route's fallback.

## Official technical evidence

| Subject                              | Result                                                                                                                                                        | Official source                                                                                                      | Source date/version                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Exact model and Beijing availability | `qwen3.7-plus-2026-05-26` is an Alibaba-provided snapshot available in China (Beijing).                                                                       | [Qwen3.7 Plus model page](https://help.aliyun.com/zh/model-studio/qwen3-7-plus)                                      | Current page checked at the timestamp above; page did not expose a stable document version in the fetched content. |
| Model limits                         | Maximum input `991,808`, maximum output `131,072`, context `1,000,000` tokens.                                                                                | [Qwen3.7 Plus model page](https://help.aliyun.com/zh/model-studio/qwen3-7-plus)                                      | Same as above.                                                                                                     |
| Regional endpoint and key boundary   | Beijing workspaces use `<WorkspaceId>.cn-beijing.maas.aliyuncs.com`; regional API keys, endpoints, and model lists cannot be mixed.                           | [China (Beijing) access information](https://help.aliyun.com/zh/model-studio/beijing-access-information)             | Current page checked at the timestamp above.                                                                       |
| Full Chat Completions path           | OpenAI-compatible chat requests use `/compatible-mode/v1/chat/completions`.                                                                                   | [Qwen API via OpenAI Chat Completions](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions) | Current page checked at the timestamp above.                                                                       |
| JSON Schema strict mode              | Qwen3.7 Plus supports JSON Schema output using `response_format.type=json_schema`, with `name`, `strict`, and `schema`.                                       | [Structured output](https://help.aliyun.com/en/model-studio/qwen-structured-output)                                  | Updated `2026-09-21`.                                                                                              |
| Canonical schema keywords            | The documented set covers the canonical schema's `$defs`, local `$ref`, `const`, `allOf`, `if`/`then`, and `additionalProperties:false`.                      | [Structured output](https://help.aliyun.com/en/model-studio/qwen-structured-output)                                  | Updated `2026-09-21`.                                                                                              |
| Structured-output token guidance     | The structured-output guide instructs callers not to set `max_tokens`, because truncation can produce invalid JSON.                                           | [Structured output](https://help.aliyun.com/en/model-studio/qwen-structured-output)                                  | Updated `2026-09-21`.                                                                                              |
| Thinking default and switch          | Qwen3.7 Plus is hybrid-thinking and defaults to thinking enabled; direct HTTP uses top-level `enable_thinking`, so the frozen route explicitly sends `false`. | [Deep thinking](https://help.aliyun.com/zh/model-studio/deep-thinking)                                               | Current page checked at the timestamp above.                                                                       |
| Beijing pricing                      | For input length up to 256K: input `2 CNY / 1M tokens`, output `8 CNY / 1M tokens`; the 256K–1M tier is input `6`, output `24 CNY / 1M tokens`.               | [Model pricing](https://help.aliyun.com/zh/model-studio/model-pricing)                                               | Current price page checked at the timestamp above.                                                                 |

The adapter deterministically serializes the complete outbound Provider body before HTTP and
rejects it when its UTF-8 size exceeds `131072` bytes. This bound covers the prompt, messages,
canonical schema, response-format authority, and fixed Provider fields, structurally keeping the
route below the 256K input pricing tier. It reserves the complete low-tier ceiling:

```text
maximumAmount = 256000 * input_unit_cost
              + 131072 * output_unit_cost
```

The calculation intentionally ignores the generic `request.parameters.max_tokens` hint because it
is absent from the Alibaba strict-output wire. At current first-tier Beijing prices, the resulting
maximum is `1.560576 CNY`; only the `text.semantic-shot-planning` Gateway route receives the `2 CNY`
internal ceiling, while unrelated text routes remain at `1 CNY`. This is an internal safety-envelope
adjustment, not a shared contract change. The adapter also rejects configured input/output unit
prices below the reviewed Beijing rates, and fails closed if Provider usage unexpectedly reports
more than 256,000 prompt tokens; a higher conservative configured price remains valid.

## Provider policy evidence for later owner approval

The source for this section is the [Alibaba Cloud Model Studio Service Agreement](https://terms.alicdn.com/legal-agreement/terms/common_platform_service/20230728213935489/20230728213935489.html), effective `2026-09-02`, checked at the timestamp above. These are evidence summaries, not legal conclusions.

| Required approval field | Proposed evidence value                                                                                                                                                                                                                                       | Evidence status                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| API terms version       | Alibaba Cloud Model Studio Service Agreement, effective `2026-09-02`                                                                                                                                                                                          | `PASS` (document identified)                                                   |
| Commercial use          | The agreement contemplates customers developing applications and providing external services, subject to law, permissions, and customer responsibility; it does not provide a blanket approval for this product.                                              | `PASS` as published evidence; final approval remains with Brain1/project owner |
| Output ownership        | For Alibaba/affiliate models, where the customer lawfully owns the input, synthesized-content IP remains with the customer unless otherwise agreed or required by law; whether protectable IP exists remains the customer's responsibility.                   | `PASS` as conditional published evidence                                       |
| Training/retention      | Customer business data is processed to provide the service or meet legal duties; the agreement describes shortest-necessary retention and no model training without authorization, but does not state an exact Beijing API retention duration for this route. | `AMBIGUOUS`                                                                    |
| Region/data transfer    | Processing occurs in the country/region chosen for the service/model; choosing an overseas region invokes cross-border responsibilities. The frozen endpoint is Beijing.                                                                                      | `PASS` as published evidence                                                   |
| Prohibited content      | The agreement assigns content-law, safety, rights, and prohibited-use obligations to the customer and permits service controls for violations.                                                                                                                | `PASS` as published evidence                                                   |
| Attribution             | No general provider-brand attribution requirement for ordinary output was located in the reviewed agreement; trademark use requires authorization and legally required synthetic-content labeling remains the customer's duty.                                | `AMBIGUOUS` pending final legal review                                         |
| Model license metadata  | This is an Alibaba-hosted proprietary API snapshot, not a customer-distributed model-weight package. No separate redistributable weight license is asserted by this preflight.                                                                                | `AMBIGUOUS` for the approval record until owner/legal disposition              |

Proposed later canary approval records must quote or reference the agreement above and must not turn
the ambiguous retention, attribution, or model-license entries into favorable placeholders. A real
credential, workspace ID, `approved_by`, `approved_at`, approval expiry, and final commercial/legal
decision are deliberately absent from this repository.

## Verification and stop state

- Wire tests compare the complete request with the exact generated canonical schema binding and
  prove the forbidden fields are absent.
- Rejection tests prove there is one request only: no schema/strict/model/region/thinking downgrade.
- Error tests preserve `AUTH_FAILED`, `RATE_LIMITED`, `UPSTREAM_5XX`, `INVALID_PARAMS`, and
  `TIMEOUT_UNKNOWN`.
- Response handling consumes only final `message.content`; `reasoning_content` is ignored.
- No schema, prompt, golden, migration, UI, IPC, preload, or product-render change is part of this
  preflight.
- `REAL_PROVIDER_CANARY_RUN: NO`
- `C3C_30_CASE_REAL_EVALUATION_RUN: NO`

## Provider identity migration (2026-10-29)

Brain1 selected `qwen3.7-plus` as the new primary after the snapshot access failures. This section
supersedes the active identity and future-policy assertions above; the earlier preflight is retained
byte-for-byte as historical snapshot evidence. It is not the configuration for future executions.

| Field                     | New active identity                                     |
| ------------------------- | ------------------------------------------------------- |
| Provider                  | Alibaba Cloud Model Studio                              |
| Region                    | China (Beijing)                                         |
| Capability alias          | `text.semantic-shot-planning`                           |
| Provider alias            | `alibaba-beijing-qwen37-plus-c3c-nonthinking`           |
| Provider model            | `qwen3.7-plus`                                          |
| MODEL_VERSION_POLICY      | `ROLLING_PROVIDER_MODEL`                                |
| Old snapshot              | `qwen3.7-plus-2026-05-26`; historical evidence only     |
| Old provider alias active | `NO`; the alias containing `20260526` is not this route |

The rolling ID is not an immutable snapshot, even though the Brain1-frozen official Beijing
capability baseline describes its current functionality as equivalent to
`qwen3.7-plus-2026-05-26`. That baseline is structured output supported, context `1,000,000`,
maximum input `991,808` tokens and maximum output `131,072` tokens. These supplied baseline values
are not a new connectivity, availability, legal or semantic acceptance claim.

All four previous real canaries remain associated with `qwen3.7-plus-2026-05-26`, including the
repeated HTTP `403 / insufficient_quota` observations. Their execution identities, classifications
at execution time, request counts and outputs are not rewritten. No historical acceptance is
transferred to the new route; it is a separate future execution identity. Prior temporary approvals
for the snapshot alias/model do not constitute approval of the rolling alias/model.

The adapter and deployment loader share the new alias/model constants. The endpoint validator,
primary-only/no-fallback route policy, temperature `0.7`, explicit `enable_thinking=false`,
`response_format.type=json_schema`, schema name `ShotPlanSemanticProposalV1` and `strict=true`
remain unchanged. `max_tokens`, `max_completion_tokens`, `thinking_budget`, `reasoning_effort`,
`tools` and `stream` remain absent. No alternate endpoint, model or output-format fallback is added.

Pricing remains `0.000002 CNY/input token` and `0.000008 CNY/output token` for the protected low
tier. The route still limits complete serialized wire input to `131072` bytes, reserves `256000`
input tokens plus `131072` output tokens (`1.560576 CNY`), and uses the existing `2 CNY` Gateway
ceiling. Error classification, bounded diagnostics, secret handling and retry policy are unchanged.

Future real-model acceptance evidence must bind all of the following together:

| Evidence field               | Required value or state                                   |
| ---------------------------- | --------------------------------------------------------- |
| Provider alias               | `alibaba-beijing-qwen37-plus-c3c-nonthinking`             |
| Model ID / version policy    | `qwen3.7-plus` / `ROLLING_PROVIDER_MODEL`                 |
| Prompt template / version    | `shot-plan.semantic-proposer@2`                           |
| Schema authority / version   | `ShotPlanSemanticProposalV1` / `schema_version=1.0`       |
| Evaluation date              | Actual future execution timestamp; `NOT_RUN` in this task |
| Real-model acceptance result | `NOT_RUN`; no snapshot result substitutes for this model  |

Future Provider drift is evaluated through the unchanged C3C golden suite and acceptance process.
Actual non-thinking/strict-schema compatibility awaits a separately authorized synthetic canary
after Code F review. The 30 veterinary goldens, canonical/generated schema, prompt, reconciler,
Candidate/review/route/continuity semantics, UI/IPC/Timeline/Render and migrations are unchanged
(Desktop `009`, Gateway `1`; no new migration).

This migration makes zero real Provider requests, runs no real canary or 30-case real evaluation,
and does not authorize a merge or production use.
