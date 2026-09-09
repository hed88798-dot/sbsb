import { describe, expect, it } from 'vitest';
import type {
  MaterialCandidateV1,
  MaterialSelectionRequestV1,
  MaterialUsageRecordV1,
} from '@app/contracts';
import {
  MATERIAL_SELECTION_POLICY_V1,
  selectMaterial,
} from '../../packages/domain-auto-edit/src/index.js';

const hash = 'a'.repeat(64);

function candidate(asset: string, shot: string, rank: number, score = 1): MaterialCandidateV1 {
  return {
    schema_version: '1.0',
    asset_id: asset,
    shot_id: shot,
    semantic_rank: rank,
    semantic_score: score,
    material_family: 'ANIMAL',
    enabled: true,
    metadata: {},
  };
}

function usage(
  input: Partial<MaterialUsageRecordV1> & Pick<MaterialUsageRecordV1, 'asset_id' | 'shot_id'>,
): MaterialUsageRecordV1 {
  return {
    selection_request_id: input.selection_request_id ?? `used_${input.asset_id}_${input.shot_id}`,
    batch_id: input.batch_id ?? 'old_batch',
    video_id: input.video_id ?? 'old_video',
    slot_id: input.slot_id ?? 'old_slot',
    material_family: input.material_family ?? 'ANIMAL',
    asset_id: input.asset_id,
    shot_id: input.shot_id,
    committed_at: input.committed_at ?? '2026-09-01T00:00:00.000Z',
    decision_receipt_hash: input.decision_receipt_hash ?? hash,
  };
}

function request(
  candidates: MaterialCandidateV1[],
  history: MaterialUsageRecordV1[] = [],
): MaterialSelectionRequestV1 {
  return {
    schema_version: '1.0',
    selection_request_id: 'request_1',
    batch_id: 'batch_1',
    video_id: 'video_1',
    slot_id: 'slot_1',
    material_family: 'ANIMAL',
    candidate_set_id: 'candidate_set_1',
    candidate_set_contract_version: 'code-c-shot-search-v1',
    candidates,
    usage_history_snapshot: { schema_version: '1.0', selected_decisions: history },
    policy_id: 'material-selection-policy-v1',
    policy_version: MATERIAL_SELECTION_POLICY_V1.policy_version,
    candidate_set_hash: hash,
    history_snapshot_hash: hash,
    policy_snapshot_hash: hash,
  };
}

describe('material-selection-policy-v1', () => {
  it('is deterministic and independent of candidate array order', () => {
    const candidates = [
      candidate('asset_b', 'shot_b', 2, 0.8),
      candidate('asset_a', 'shot_a', 1, 0.9),
    ];
    const forward = selectMaterial(request(candidates), MATERIAL_SELECTION_POLICY_V1);
    const reversed = selectMaterial(
      request([...candidates].reverse()),
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(forward).toEqual(reversed);
    expect(forward.selected_shot_id).toBe('shot_a');
  });

  it('never repeats an exact Shot inside the same video', () => {
    const history = [
      usage({ asset_id: 'asset_a', shot_id: 'shot_a', batch_id: 'batch_1', video_id: 'video_1' }),
    ];
    const result = selectMaterial(
      request([candidate('asset_a', 'shot_a', 1), candidate('asset_b', 'shot_b', 2)], history),
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(result.selected_shot_id).toBe('shot_b');
    expect(result.candidate_facts[0]?.hard_rejection_codes).toContain(
      'SAME_VIDEO_EXACT_SHOT_REPEAT',
    );
  });

  it('prefers fresh, non-recent and lower-frequency material before semantic rank', () => {
    const history = [
      usage({ asset_id: 'asset_a', shot_id: 'shot_a', committed_at: '2026-09-03T00:00:00.000Z' }),
      usage({
        asset_id: 'asset_a',
        shot_id: 'shot_a',
        selection_request_id: 'used_a_2',
        committed_at: '2026-09-02T00:00:00.000Z',
      }),
    ];
    const fresh = selectMaterial(
      request([candidate('asset_a', 'shot_a', 1), candidate('asset_b', 'shot_b', 2)], history),
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(fresh.selected_asset_id).toBe('asset_b');
    expect(fresh.reason_codes).toEqual(
      expect.arrayContaining(['FRESH_UNUSED_CANDIDATE', 'RECENCY_PREFERRED']),
    );

    const balancedHistory = [
      ...history,
      usage({
        asset_id: 'asset_b',
        shot_id: 'shot_b',
        selection_request_id: 'used_b',
        committed_at: '2026-08-01T00:00:00.000Z',
      }),
      usage({
        asset_id: 'asset_c',
        shot_id: 'shot_c',
        selection_request_id: 'latest',
        committed_at: '2026-09-04T00:00:00.000Z',
      }),
    ];
    const balanced = selectMaterial(
      request(
        [candidate('asset_a', 'shot_a', 1), candidate('asset_b', 'shot_b', 2)],
        balancedHistory,
      ),
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(balanced.selected_asset_id).toBe('asset_b');
  });

  it('allows same Asset with a different Shot at degradation level 1', () => {
    const history = [usage({ asset_id: 'asset_a', shot_id: 'shot_old', batch_id: 'batch_1' })];
    const result = selectMaterial(
      request([candidate('asset_a', 'shot_new', 1)], history),
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(result.status).toBe('SELECTED');
    expect(result.degradation_level).toBe(1);
    expect(result.reason_codes).toContain('SAME_ASSET_DIFFERENT_SHOT');
  });

  it('degrades under scarcity without violating hard constraints', () => {
    const history = [
      usage({
        asset_id: 'asset_a',
        shot_id: 'shot_a',
        batch_id: 'batch_1',
        video_id: 'other_video',
      }),
    ];
    const repeated = selectMaterial(
      request([candidate('asset_a', 'shot_a', 1)], history),
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(repeated).toMatchObject({ status: 'SELECTED', degradation_level: 3 });
    expect(repeated.reason_codes).toContain('REPEAT_DUE_TO_SCARCITY');

    const hardInvalid = selectMaterial(
      request(
        [candidate('asset_a', 'shot_a', 1)],
        [
          usage({
            asset_id: 'asset_a',
            shot_id: 'shot_a',
            batch_id: 'batch_1',
            video_id: 'video_1',
          }),
        ],
      ),
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(hardInvalid).toMatchObject({ status: 'NO_MATCH', degradation_level: 0 });
    expect(hardInvalid.reason_codes).toEqual(['ALL_CANDIDATES_HARD_REJECTED']);
  });

  it('returns persisted-domain NO_MATCH semantics for an empty upstream set', () => {
    const result = selectMaterial(request([]), MATERIAL_SELECTION_POLICY_V1);
    expect(result).toMatchObject({
      status: 'NO_MATCH',
      selected_asset_id: null,
      selected_shot_id: null,
      reason_codes: ['NO_UPSTREAM_CANDIDATES'],
    });
  });

  it('fails closed on structurally invalid candidates', () => {
    const invalid = { ...candidate('asset_a', 'shot_a', 1), asset_id: '' };
    expect(() => selectMaterial(request([invalid]), MATERIAL_SELECTION_POLICY_V1)).toThrow();
  });
});
