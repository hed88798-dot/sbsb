import {
  materialSelectionPolicyV1Schema,
  materialSelectionRequestV1Schema,
  selectionDecisionReceiptV1Schema,
  type CandidateDecisionFactsV1,
  type MaterialCandidateV1,
  type MaterialSelectionPolicyV1,
  type MaterialSelectionPreferenceV1,
  type MaterialSelectionReasonCodeV1,
  type MaterialSelectionRequestV1,
  type MaterialUsageRecordV1,
  type SelectionDecisionReceiptV1,
} from '@app/contracts';

interface EvaluatedCandidate {
  candidate: MaterialCandidateV1;
  facts: CandidateDecisionFactsV1;
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function count(
  records: readonly MaterialUsageRecordV1[],
  predicate: (record: MaterialUsageRecordV1) => boolean,
): number {
  return records.reduce((total, record) => total + (predicate(record) ? 1 : 0), 0);
}

function evaluateCandidate(
  candidate: MaterialCandidateV1,
  request: MaterialSelectionRequestV1,
  recentKeys: ReadonlySet<string>,
): EvaluatedCandidate {
  const history = request.usage_history_snapshot.selected_decisions;
  const hardRejections: CandidateDecisionFactsV1['hard_rejection_codes'] = [];
  if (!candidate.enabled) hardRejections.push('DISABLED');
  if (candidate.material_family !== request.material_family) {
    hardRejections.push('MATERIAL_FAMILY_MISMATCH');
  }
  if (
    history.some(
      (record) => record.video_id === request.video_id && record.shot_id === candidate.shot_id,
    )
  ) {
    hardRejections.push('SAME_VIDEO_EXACT_SHOT_REPEAT');
  }
  const totalAssetUsage = count(history, (record) => record.asset_id === candidate.asset_id);
  const totalShotUsage = count(history, (record) => record.shot_id === candidate.shot_id);
  return {
    candidate,
    facts: {
      asset_id: candidate.asset_id,
      shot_id: candidate.shot_id,
      hard_rejection_codes: hardRejections,
      fresh: totalAssetUsage === 0 && totalShotUsage === 0,
      recently_used: recentKeys.has(`${candidate.asset_id}\u0000${candidate.shot_id}`),
      batch_asset_usage: count(
        history,
        (record) => record.batch_id === request.batch_id && record.asset_id === candidate.asset_id,
      ),
      batch_shot_usage: count(
        history,
        (record) => record.batch_id === request.batch_id && record.shot_id === candidate.shot_id,
      ),
      total_asset_usage: totalAssetUsage,
      total_shot_usage: totalShotUsage,
      semantic_rank: candidate.semantic_rank,
      semantic_score: candidate.semantic_score,
    },
  };
}

function comparePreference(
  left: CandidateDecisionFactsV1,
  right: CandidateDecisionFactsV1,
  preference: MaterialSelectionPreferenceV1,
): number {
  switch (preference) {
    case 'FRESHNESS':
      return Number(right.fresh) - Number(left.fresh);
    case 'BATCH_SHOT_USAGE':
      return left.batch_shot_usage - right.batch_shot_usage;
    case 'BATCH_ASSET_USAGE':
      return left.batch_asset_usage - right.batch_asset_usage;
    case 'RECENCY':
      return Number(left.recently_used) - Number(right.recently_used);
    case 'TOTAL_SHOT_USAGE':
      return left.total_shot_usage - right.total_shot_usage;
    case 'TOTAL_ASSET_USAGE':
      return left.total_asset_usage - right.total_asset_usage;
    case 'SEMANTIC_RANK':
      return left.semantic_rank - right.semantic_rank;
    case 'SEMANTIC_SCORE':
      return right.semantic_score - left.semantic_score;
  }
}

function compareEvaluated(
  left: EvaluatedCandidate,
  right: EvaluatedCandidate,
  policy: MaterialSelectionPolicyV1,
  family: MaterialSelectionRequestV1['material_family'],
): number {
  for (const preference of policy.preference_order[family]) {
    const compared = comparePreference(left.facts, right.facts, preference);
    if (compared !== 0) return compared;
  }
  return (
    compareStableText(left.candidate.asset_id, right.candidate.asset_id) ||
    compareStableText(left.candidate.shot_id, right.candidate.shot_id)
  );
}

function recentShotKeys(
  history: readonly MaterialUsageRecordV1[],
  windowSize: number,
): ReadonlySet<string> {
  const ordered = [...history].sort(
    (left, right) =>
      compareStableText(right.committed_at, left.committed_at) ||
      compareStableText(right.selection_request_id, left.selection_request_id),
  );
  return new Set(
    ordered.slice(0, windowSize).map((record) => `${record.asset_id}\u0000${record.shot_id}`),
  );
}

function noMatch(
  request: MaterialSelectionRequestV1,
  facts: CandidateDecisionFactsV1[],
  reason: 'NO_UPSTREAM_CANDIDATES' | 'ALL_CANDIDATES_HARD_REJECTED',
): SelectionDecisionReceiptV1 {
  return selectionDecisionReceiptV1Schema.parse({
    schema_version: '1.0',
    selection_request_id: request.selection_request_id,
    batch_id: request.batch_id,
    video_id: request.video_id,
    slot_id: request.slot_id,
    status: 'NO_MATCH',
    selected_asset_id: null,
    selected_shot_id: null,
    selected_semantic_rank: null,
    selected_semantic_score: null,
    degradation_level: 0,
    reason_codes: [reason],
    candidate_set_hash: request.candidate_set_hash,
    history_snapshot_hash: request.history_snapshot_hash,
    policy_id: request.policy_id,
    policy_version: request.policy_version,
    policy_snapshot_hash: request.policy_snapshot_hash,
    candidate_facts: facts,
  });
}

function selectScarcityPool(valid: EvaluatedCandidate[]): {
  pool: EvaluatedCandidate[];
  degradationLevel: number;
} {
  const unusedAssets = valid.filter(
    (entry) => entry.facts.batch_asset_usage === 0 && entry.facts.batch_shot_usage === 0,
  );
  if (unusedAssets.length > 0) return { pool: unusedAssets, degradationLevel: 0 };
  const unusedShots = valid.filter((entry) => entry.facts.batch_shot_usage === 0);
  if (unusedShots.length > 0) return { pool: unusedShots, degradationLevel: 1 };
  return { pool: valid, degradationLevel: valid.length === 1 ? 3 : 2 };
}

function selectionReasons(
  selected: EvaluatedCandidate,
  pool: EvaluatedCandidate[],
  degradationLevel: number,
): MaterialSelectionReasonCodeV1[] {
  const reasons: MaterialSelectionReasonCodeV1[] = [];
  if (selected.facts.fresh) reasons.push('FRESH_UNUSED_CANDIDATE');
  const minimumBatchUsage = Math.min(
    ...pool.map((entry) => entry.facts.batch_asset_usage + entry.facts.batch_shot_usage),
  );
  if (
    selected.facts.batch_asset_usage + selected.facts.batch_shot_usage === minimumBatchUsage &&
    pool.some(
      (entry) => entry.facts.batch_asset_usage + entry.facts.batch_shot_usage > minimumBatchUsage,
    )
  ) {
    reasons.push('LOWEST_BATCH_USAGE');
  }
  if (!selected.facts.recently_used && pool.some((entry) => entry.facts.recently_used)) {
    reasons.push('RECENCY_PREFERRED');
  }
  const minimumTotalUsage = Math.min(
    ...pool.map((entry) => entry.facts.total_asset_usage + entry.facts.total_shot_usage),
  );
  if (
    selected.facts.total_asset_usage + selected.facts.total_shot_usage === minimumTotalUsage &&
    pool.some(
      (entry) => entry.facts.total_asset_usage + entry.facts.total_shot_usage > minimumTotalUsage,
    )
  ) {
    reasons.push('LOWEST_TOTAL_USAGE');
  }
  if (
    selected.facts.semantic_rank === Math.min(...pool.map((entry) => entry.facts.semantic_rank))
  ) {
    reasons.push('SEMANTIC_RANK_PREFERRED');
  }
  if (selected.facts.batch_asset_usage > 0 && selected.facts.batch_shot_usage === 0) {
    reasons.push('SAME_ASSET_DIFFERENT_SHOT');
  }
  if (degradationLevel >= 2) reasons.push('REPEAT_DUE_TO_SCARCITY');
  return reasons.length > 0 ? reasons : ['STABLE_IDENTITY_TIE_BREAK'];
}

export function selectMaterial(
  rawRequest: MaterialSelectionRequestV1,
  rawPolicy: MaterialSelectionPolicyV1,
): SelectionDecisionReceiptV1 {
  const request = materialSelectionRequestV1Schema.parse(rawRequest);
  const policy = materialSelectionPolicyV1Schema.parse(rawPolicy);
  if (request.policy_id !== policy.policy_id || request.policy_version !== policy.policy_version) {
    throw new Error('MATERIAL_SELECTION_POLICY_IDENTITY_MISMATCH');
  }
  if (request.candidates.length === 0) return noMatch(request, [], 'NO_UPSTREAM_CANDIDATES');
  const recentKeys = recentShotKeys(
    request.usage_history_snapshot.selected_decisions,
    policy.recent_use.window_size,
  );
  const evaluated = [...request.candidates]
    .sort(
      (left, right) =>
        compareStableText(left.asset_id, right.asset_id) ||
        compareStableText(left.shot_id, right.shot_id),
    )
    .map((candidate) => evaluateCandidate(candidate, request, recentKeys));
  const valid = evaluated.filter((entry) => entry.facts.hard_rejection_codes.length === 0);
  if (valid.length === 0) {
    return noMatch(
      request,
      evaluated.map((entry) => entry.facts),
      'ALL_CANDIDATES_HARD_REJECTED',
    );
  }
  const scarcity = selectScarcityPool(valid);
  const selected = [...scarcity.pool].sort((left, right) =>
    compareEvaluated(left, right, policy, request.material_family),
  )[0]!;
  return selectionDecisionReceiptV1Schema.parse({
    schema_version: '1.0',
    selection_request_id: request.selection_request_id,
    batch_id: request.batch_id,
    video_id: request.video_id,
    slot_id: request.slot_id,
    status: 'SELECTED',
    selected_asset_id: selected.candidate.asset_id,
    selected_shot_id: selected.candidate.shot_id,
    selected_semantic_rank: selected.candidate.semantic_rank,
    selected_semantic_score: selected.candidate.semantic_score,
    degradation_level: scarcity.degradationLevel,
    reason_codes: selectionReasons(selected, scarcity.pool, scarcity.degradationLevel),
    candidate_set_hash: request.candidate_set_hash,
    history_snapshot_hash: request.history_snapshot_hash,
    policy_id: request.policy_id,
    policy_version: request.policy_version,
    policy_snapshot_hash: request.policy_snapshot_hash,
    candidate_facts: evaluated.map((entry) => entry.facts),
  });
}
