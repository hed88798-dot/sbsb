import { z } from 'zod';

const schemaVersion = z.literal('1.0');
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.string().trim().min(1).max(256);

export const materialFamilyV1Schema = z.enum(['ANIMAL', 'PRODUCT']);
export type MaterialFamilyV1 = z.infer<typeof materialFamilyV1Schema>;

export const materialSelectionStatusV1Schema = z.enum(['SELECTED', 'NO_MATCH']);
export type MaterialSelectionStatusV1 = z.infer<typeof materialSelectionStatusV1Schema>;

export const materialSelectionReasonCodeV1Schema = z.enum([
  'FRESH_UNUSED_CANDIDATE',
  'LOWEST_BATCH_USAGE',
  'RECENCY_PREFERRED',
  'LOWEST_TOTAL_USAGE',
  'SEMANTIC_RANK_PREFERRED',
  'SAME_ASSET_DIFFERENT_SHOT',
  'REPEAT_DUE_TO_SCARCITY',
  'NO_UPSTREAM_CANDIDATES',
  'ALL_CANDIDATES_HARD_REJECTED',
  'STABLE_IDENTITY_TIE_BREAK',
]);
export type MaterialSelectionReasonCodeV1 = z.infer<typeof materialSelectionReasonCodeV1Schema>;

export const materialCandidateV1Schema = z
  .object({
    schema_version: schemaVersion,
    asset_id: identity,
    shot_id: identity,
    semantic_rank: z.number().int().positive(),
    semantic_score: z.number().finite(),
    material_family: materialFamilyV1Schema,
    enabled: z.boolean().default(true),
    start_ms: z.number().int().nonnegative().optional(),
    end_ms: z.number().int().positive().optional(),
    revision: z.number().int().positive().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.start_ms !== undefined &&
      value.end_ms !== undefined &&
      value.end_ms <= value.start_ms
    ) {
      context.addIssue({ code: 'custom', message: 'end_ms must be greater than start_ms' });
    }
  });
export type MaterialCandidateV1 = z.infer<typeof materialCandidateV1Schema>;

export const materialUsageRecordV1Schema = z
  .object({
    selection_request_id: identity,
    batch_id: identity,
    video_id: identity,
    slot_id: identity,
    material_family: materialFamilyV1Schema,
    asset_id: identity,
    shot_id: identity,
    committed_at: z.string().datetime(),
    decision_receipt_hash: hash,
  })
  .strict();
export type MaterialUsageRecordV1 = z.infer<typeof materialUsageRecordV1Schema>;

export const usageHistorySnapshotV1Schema = z
  .object({
    schema_version: schemaVersion,
    selected_decisions: z.array(materialUsageRecordV1Schema),
  })
  .strict();
export type UsageHistorySnapshotV1 = z.infer<typeof usageHistorySnapshotV1Schema>;

export const materialSelectionRequestV1Schema = z
  .object({
    schema_version: schemaVersion,
    selection_request_id: identity,
    batch_id: identity,
    video_id: identity,
    slot_id: identity,
    material_family: materialFamilyV1Schema,
    candidate_set_id: identity,
    candidate_set_contract_version: z.literal('code-c-shot-search-v1'),
    candidates: z.array(materialCandidateV1Schema),
    usage_history_snapshot: usageHistorySnapshotV1Schema,
    policy_id: z.literal('material-selection-policy-v1'),
    policy_version: identity,
    candidate_set_hash: hash,
    history_snapshot_hash: hash,
    policy_snapshot_hash: hash,
  })
  .strict();
export type MaterialSelectionRequestV1 = z.infer<typeof materialSelectionRequestV1Schema>;

export const materialSelectionPreferenceV1Schema = z.enum([
  'FRESHNESS',
  'BATCH_SHOT_USAGE',
  'BATCH_ASSET_USAGE',
  'RECENCY',
  'TOTAL_SHOT_USAGE',
  'TOTAL_ASSET_USAGE',
  'SEMANTIC_RANK',
  'SEMANTIC_SCORE',
]);
export type MaterialSelectionPreferenceV1 = z.infer<typeof materialSelectionPreferenceV1Schema>;

export const materialSelectionPolicyV1Schema = z
  .object({
    schema_version: schemaVersion,
    policy_id: z.literal('material-selection-policy-v1'),
    policy_version: identity,
    same_video_exact_shot_repeat: z.literal('FORBIDDEN'),
    same_batch_shot_repeat: z.literal('AVOID'),
    same_batch_asset_repeat: z.literal('PENALIZE'),
    recent_use: z
      .object({ mode: z.literal('PENALIZE'), window_size: z.number().int().positive() })
      .strict(),
    high_frequency_asset: z.literal('PENALIZE'),
    semantic_rank: z.literal('PREFER_HIGHER'),
    scarcity_degradation: z.literal('ENABLED'),
    preference_order: z
      .object({
        ANIMAL: z.array(materialSelectionPreferenceV1Schema).min(1),
        PRODUCT: z.array(materialSelectionPreferenceV1Schema).min(1),
      })
      .strict(),
    tie_breaker: z.tuple([z.literal('asset_id'), z.literal('shot_id')]),
  })
  .strict();
export type MaterialSelectionPolicyV1 = z.infer<typeof materialSelectionPolicyV1Schema>;

export const candidateDecisionFactsV1Schema = z
  .object({
    asset_id: identity,
    shot_id: identity,
    hard_rejection_codes: z.array(
      z.enum(['DISABLED', 'MATERIAL_FAMILY_MISMATCH', 'SAME_VIDEO_EXACT_SHOT_REPEAT']),
    ),
    fresh: z.boolean(),
    recently_used: z.boolean(),
    batch_asset_usage: z.number().int().nonnegative(),
    batch_shot_usage: z.number().int().nonnegative(),
    total_asset_usage: z.number().int().nonnegative(),
    total_shot_usage: z.number().int().nonnegative(),
    semantic_rank: z.number().int().positive(),
    semantic_score: z.number().finite(),
  })
  .strict();
export type CandidateDecisionFactsV1 = z.infer<typeof candidateDecisionFactsV1Schema>;

export const selectionDecisionReceiptV1Schema = z
  .object({
    schema_version: schemaVersion,
    selection_request_id: identity,
    batch_id: identity,
    video_id: identity,
    slot_id: identity,
    status: materialSelectionStatusV1Schema,
    selected_asset_id: identity.nullable(),
    selected_shot_id: identity.nullable(),
    selected_semantic_rank: z.number().int().positive().nullable(),
    selected_semantic_score: z.number().finite().nullable(),
    degradation_level: z.number().int().nonnegative(),
    reason_codes: z.array(materialSelectionReasonCodeV1Schema).min(1),
    candidate_set_hash: hash,
    history_snapshot_hash: hash,
    policy_id: z.literal('material-selection-policy-v1'),
    policy_version: identity,
    policy_snapshot_hash: hash,
    candidate_facts: z.array(candidateDecisionFactsV1Schema),
  })
  .strict()
  .superRefine((value, context) => {
    const selectedValues = [
      value.selected_asset_id,
      value.selected_shot_id,
      value.selected_semantic_rank,
      value.selected_semantic_score,
    ];
    if (value.status === 'SELECTED' && selectedValues.some((entry) => entry === null)) {
      context.addIssue({
        code: 'custom',
        message: 'SELECTED requires a complete candidate identity',
      });
    }
    if (
      value.status === 'NO_MATCH' &&
      (selectedValues.some((entry) => entry !== null) || value.degradation_level !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'NO_MATCH cannot contain a selected candidate or degradation',
      });
    }
  });
export type SelectionDecisionReceiptV1 = z.infer<typeof selectionDecisionReceiptV1Schema>;

export const materialSelectionResultV1Schema = z
  .object({
    schema_version: schemaVersion,
    selection_request_id: identity,
    batch_id: identity,
    video_id: identity,
    slot_id: identity,
    status: materialSelectionStatusV1Schema,
    selected_asset_id: identity.nullable(),
    selected_shot_id: identity.nullable(),
    selected_semantic_rank: z.number().int().positive().nullable(),
    selected_semantic_score: z.number().finite().nullable(),
    degradation_level: z.number().int().nonnegative(),
    reason_codes: z.array(materialSelectionReasonCodeV1Schema).min(1),
    candidate_set_hash: hash,
    history_snapshot_hash: hash,
    policy_snapshot_hash: hash,
    decision_receipt_hash: hash,
    committed_at: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const selectedValues = [
      value.selected_asset_id,
      value.selected_shot_id,
      value.selected_semantic_rank,
      value.selected_semantic_score,
    ];
    if (value.status === 'SELECTED' && selectedValues.some((entry) => entry === null)) {
      context.addIssue({
        code: 'custom',
        message: 'SELECTED requires a complete candidate identity',
      });
    }
    if (
      value.status === 'NO_MATCH' &&
      (selectedValues.some((entry) => entry !== null) || value.degradation_level !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'NO_MATCH cannot contain a selected candidate or degradation',
      });
    }
  });
export type MaterialSelectionResultV1 = z.infer<typeof materialSelectionResultV1Schema>;

export const materialSelectionIntentV1Schema = z
  .object({
    schema_version: schemaVersion,
    selection_request_id: identity,
    batch_id: identity,
    video_id: identity,
    slot_id: identity,
    material_family: materialFamilyV1Schema,
    candidate_set_id: identity,
    candidate_set_contract_version: z.literal('code-c-shot-search-v1'),
  })
  .strict();
export type MaterialSelectionIntentV1 = z.infer<typeof materialSelectionIntentV1Schema>;
