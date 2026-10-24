# Code A Wave D1 Zod external-container audit

## Decision and fixed resource boundaries

- Architecture resolution: `PRE_ZOD_RESOURCE_SAFETY_BOUNDARY`.
- IPC contract/schema version remains `1.0`.
- `EXTERNAL_COLLECTION_MAX_ITEMS_V1 = 1024`.
- `PROVIDER_JOB_RESPONSE_MAX_BYTES_V1 = 4194304`.
- Product business schemas and their product semantics are unchanged.
- No data is truncated, sliced, batched, partially accepted, or silently discarded.

The Electron Main guard performs shallow property lookup plus `Array.isArray` and `.length`
only. It runs before the product request schemas. The Provider Job reader counts bytes read from
the response stream, stops above 4 MiB, parses JSON only inside the byte boundary, checks the
artifact array length, and only then invokes `providerJobV1Schema.safeParse`.

## Exposure matrix

`Zod bound` records an explicit finite Zod item bound. `Pre-Zod bound` records a trusted earlier
resource boundary. “Internal” means the container is not populated directly by Renderer,
network, uploaded/imported JSON, or another untrusted external payload at that parse site.

| File / schema container                                                                                      | Surface                               | External or untrusted | Zod bound       | Pre-Zod bound or classification                                               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------- | --------------- | ----------------------------------------------------------------------------- |
| `packages/contracts/src/index.ts` / `productDataV1Schema.aliases`                                            | IPC `products:create/update`          | Yes                   | No              | Main shallow item bound: 1024                                                 |
| `packages/contracts/src/index.ts` / `productDataV1Schema.contraindications`                                  | IPC `products:create/update`          | Yes                   | No              | Main shallow item bound: 1024                                                 |
| `packages/contracts/src/index.ts` / `productDataV1Schema.selling_points`                                     | IPC `products:create/update`          | Yes                   | No              | Main shallow item bound: 1024                                                 |
| `packages/contracts/src/index.ts` / `productDataV1Schema.forbidden_claims`                                   | IPC `products:create/update`          | Yes                   | No              | Main shallow item bound: 1024                                                 |
| `packages/contracts/src/index.ts` / `productDtoV1Schema.assets`                                              | IPC output / DB                       | No                    | No              | Internal DB-owned DTO output                                                  |
| `packages/contracts/src/index.ts` / `productFactSnapshotV1Schema.aliases`                                    | DB/internal copywriting snapshot      | No                    | No              | Trusted generated snapshot                                                    |
| `packages/contracts/src/index.ts` / `productFactSnapshotV1Schema.contraindications`                          | DB/internal copywriting snapshot      | No                    | No              | Trusted generated snapshot                                                    |
| `packages/contracts/src/index.ts` / `productFactSnapshotV1Schema.forbidden_claims`                           | DB/internal copywriting snapshot      | No                    | No              | Trusted generated snapshot                                                    |
| `packages/contracts/src/index.ts` / `copywritingResultV1Schema.fact_conflicts`                               | DB/internal result                    | No                    | No              | Deterministic fact-checker output                                             |
| `packages/contracts/src/index.ts` / `productAssetAddRequestV1Schema.paths`                                   | IPC `products:add-assets`             | Yes                   | No              | Main shallow item bound: 1024                                                 |
| `packages/contracts/src/index.ts` / `unknownableStringArraySchema`                                           | media-worker descriptor / DB          | Yes at worker ingress | No              | NDJSON line byte bound before JSON/Zod: 1 MiB; other uses internal            |
| `packages/contracts/src/index.ts` / `visualEvidenceV1Schema.value` string array branch                       | media-worker descriptor / DB          | Yes at worker ingress | No              | NDJSON line byte bound before JSON/Zod: 1 MiB; other uses internal            |
| `packages/contracts/src/index.ts` / `shotManifestV1Schema.keyframes`                                         | media-index generated manifest        | No                    | 1..3 items      | Trusted generated data                                                        |
| `packages/contracts/src/index.ts` / `assetRevisionManifestV1Schema.shots`                                    | media-index manifest / DB             | No                    | Minimum only    | Trusted local worker-generated authority; no direct IPC/network/import parser |
| `packages/contracts/src/index.ts` / `shotSearchFiltersV1Schema.species`                                      | Main-to-worker search request         | No                    | No              | Trusted Main-generated request                                                |
| `packages/contracts/src/index.ts` / `shotSearchFiltersV1Schema.scene`                                        | Main-to-worker search request         | No                    | No              | Trusted Main-generated request                                                |
| `packages/contracts/src/index.ts` / `imageEditProviderRequestV1Schema.inputs`                                | Gateway request                       | Yes                   | 1..4 items      | Fastify body limit: 1 MiB before schema parsing                               |
| `packages/contracts/src/index.ts` / `videoProviderRequestV1Schema.inputs`                                    | Gateway request                       | Yes                   | 0..1 items      | Fastify body limit: 1 MiB before schema parsing                               |
| `packages/contracts/src/index.ts` / `voiceCloneProviderRequestV1Schema.inputs`                               | Gateway request                       | Yes                   | Exactly 1 item  | Fastify body limit: 1 MiB before schema parsing                               |
| `packages/contracts/src/index.ts` / `lipSyncProviderRequestV1Schema.inputs`                                  | Gateway request                       | Yes                   | Exactly 2 items | Fastify body limit: 1 MiB before schema parsing                               |
| `packages/contracts/src/index.ts` / `providerJobV1Schema.artifacts`                                          | Provider/Gateway response             | Yes                   | No              | Stream byte bound: 4 MiB; shallow item bound before Zod: 1024                 |
| `packages/contracts/src/shot-planning.ts` / `shotPlanCandidateSlotV1Schema.review_warnings`                  | Shot Plan authority                   | No                    | No              | Trusted generated/internal authority                                          |
| `packages/contracts/src/shot-planning.ts` / `candidateShotPlanV1Schema.review_warnings`                      | Shot Plan authority                   | No                    | No              | Trusted generated/internal authority                                          |
| `packages/contracts/src/shot-planning.ts` / `candidateShotPlanV1Schema.slots`                                | Shot Plan authority                   | No                    | Minimum only    | Trusted generated/internal authority; no current external ingress on `main`   |
| `packages/contracts/src/timeline-planning.ts` / `confirmedShotPlanV1Schema.slots`                            | DB/internal authority                 | No                    | Minimum only    | Confirmed immutable authority snapshot                                        |
| `packages/contracts/src/timeline-planning.ts` / `narrationTimingSnapshotV1Schema.slot_timings`               | DB/internal authority                 | No                    | Minimum only    | Trusted narration authority snapshot                                          |
| `packages/contracts/src/timeline-planning.ts` / `narrationTimingSnapshotV1Schema.pause_intervals`            | DB/internal authority                 | No                    | No              | Trusted narration authority snapshot                                          |
| `packages/contracts/src/timeline-planning.ts` / `timelinePlanningRequestV1Schema.committed_selection_refs`   | Timeline orchestration                | No                    | No              | Trusted internal authority references                                         |
| `packages/contracts/src/material-selection.ts` / `usageHistorySnapshotV1Schema.selected_decisions`           | DB/internal authority                 | No                    | No              | Trusted committed ledger                                                      |
| `packages/contracts/src/material-selection.ts` / `materialSelectionRequestV1Schema.candidates`               | Code C/D internal boundary            | No                    | No              | Accepted internal candidate-set authority                                     |
| `packages/contracts/src/material-selection.ts` / `materialSelectionPolicyV1Schema.route_preferences.ANIMAL`  | Policy authority                      | No                    | Minimum only    | Frozen internal policy snapshot                                               |
| `packages/contracts/src/material-selection.ts` / `materialSelectionPolicyV1Schema.route_preferences.PRODUCT` | Policy authority                      | No                    | Minimum only    | Frozen internal policy snapshot                                               |
| `packages/contracts/src/material-selection.ts` / `candidateDecisionFactsV1Schema.hard_rejection_codes`       | Code C/D internal boundary            | No                    | No              | Trusted derived candidate facts                                               |
| `packages/contracts/src/material-selection.ts` / `selectionDecisionReceiptV1Schema.reason_codes`             | DB/internal receipt                   | No                    | Minimum only    | Trusted deterministic decision receipt                                        |
| `packages/contracts/src/material-selection.ts` / `selectionDecisionReceiptV1Schema.candidate_facts`          | DB/internal receipt                   | No                    | No              | Trusted deterministic decision receipt                                        |
| `packages/contracts/src/material-selection.ts` / `materialSelectionResultV1Schema.reason_codes`              | DB/internal result                    | No                    | Minimum only    | Trusted deterministic result                                                  |
| `packages/render/src/contracts.ts` / `renderRuntimeIdentityV1Schema.runtime_member_hashes`                   | packaged Runtime authority            | No                    | Minimum only    | Approved immutable Runtime snapshot                                           |
| `packages/render/src/contracts.ts` / `logicalRenderPlanV1Schema.video_operations`                            | Render planning                       | No                    | Minimum only    | Trusted deterministic plan                                                    |
| `packages/render/src/contracts.ts` / `renderExecutionSnapshotV1Schema.source_artifacts`                      | Render execution                      | No                    | Minimum only    | Trusted Main-generated snapshot                                               |
| `packages/render/src/contracts.ts` / `renderExecutionSnapshotV1Schema.source_artifacts[].segment_ids`        | Render execution                      | No                    | Minimum only    | Trusted Main-generated snapshot                                               |
| `packages/render/src/capability-profile.ts` / shared `stringArray` fields                                    | packaged Runtime capability authority | No                    | No              | Approved immutable capability profile                                         |
| `apps/desktop/src/preload/index.ts` / product list output                                                    | Main-to-Renderer output               | No                    | No              | Main/DB-owned output; not Renderer input                                      |
| `apps/desktop/src/preload/index.ts` / native image chooser output                                            | Main-to-Renderer output               | No                    | No              | Native dialog result; not Renderer input                                      |
| `apps/desktop/src/preload/index.ts` / job list output                                                        | Main-to-Renderer output               | No                    | No              | Main/DB-owned output; not Renderer input                                      |
| `apps/desktop/src/preload/index.ts` / Render Timeline source output                                          | Main-to-Renderer output               | No                    | No              | Main/DB-owned output; not Renderer input                                      |
| `apps/desktop/src/main/ipc.ts` / Render Timeline source output                                               | Main-to-Renderer output               | No                    | No              | Trusted Main-generated output                                                 |

Repository search found no `z.set(...)` or `z.map(...)` schema declarations. Runtime JavaScript
`Set`/`Map` collections are not Zod input containers and are outside this advisory audit.

## Verification expectations

- Arrays of 1024 items reach normal validation; arrays of 1025 items are rejected before the
  affected business schema.
- A Provider Job response of exactly 4 MiB reaches normal JSON processing; larger streamed
  responses fail while reading, including when `Content-Length` is absent or false.
- Provider Job artifacts of 1024 items reach Zod; 1025 items do not.
- Missing/non-array fields are left to normal Zod type validation.
- Zod contract semantics remain unchanged; the Zod 4.6.7 refined-object `.omit()` construction
  incompatibility is handled by deriving from the same unrefined base object, preserving the
  baseline 4.1.13 behavior.
