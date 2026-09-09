import { materialSelectionPolicyV1Schema, type MaterialSelectionPolicyV1 } from '@app/contracts';

export const MATERIAL_SELECTION_POLICY_V1 = materialSelectionPolicyV1Schema.parse({
  schema_version: '1.0',
  policy_id: 'material-selection-policy-v1',
  policy_version: '1.0.0',
  same_video_exact_shot_repeat: 'FORBIDDEN',
  same_batch_shot_repeat: 'AVOID',
  same_batch_asset_repeat: 'PENALIZE',
  recent_use: { mode: 'PENALIZE', window_size: 5 },
  high_frequency_asset: 'PENALIZE',
  semantic_rank: 'PREFER_HIGHER',
  scarcity_degradation: 'ENABLED',
  preference_order: {
    ANIMAL: [
      'FRESHNESS',
      'BATCH_SHOT_USAGE',
      'BATCH_ASSET_USAGE',
      'RECENCY',
      'TOTAL_SHOT_USAGE',
      'TOTAL_ASSET_USAGE',
      'SEMANTIC_RANK',
      'SEMANTIC_SCORE',
    ],
    PRODUCT: [
      'BATCH_SHOT_USAGE',
      'RECENCY',
      'BATCH_ASSET_USAGE',
      'TOTAL_ASSET_USAGE',
      'TOTAL_SHOT_USAGE',
      'SEMANTIC_RANK',
      'FRESHNESS',
      'SEMANTIC_SCORE',
    ],
  },
  tie_breaker: ['asset_id', 'shot_id'],
}) satisfies MaterialSelectionPolicyV1;
