import {
  shotSearchCandidateV1Schema,
  type MaterialCandidateV1,
  type MaterialFamilyV1,
  type ShotSearchCandidateV1,
} from '@app/contracts';

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareUpstreamCandidates(
  left: ShotSearchCandidateV1,
  right: ShotSearchCandidateV1,
): number {
  return (
    right.semantic_score - left.semantic_score ||
    compareStableText(left.asset_id, right.asset_id) ||
    compareStableText(left.shot_id, right.shot_id)
  );
}

/**
 * Compatibility adapter for the frozen Code C candidate contract. Semantic rank is derived from
 * Code C's score plus stable identities, making the result independent of transport array order.
 */
export function adaptCodeCCandidates(
  rawCandidates: readonly unknown[],
  materialFamily: MaterialFamilyV1,
): MaterialCandidateV1[] {
  const validated = rawCandidates.map((candidate) => shotSearchCandidateV1Schema.parse(candidate));
  const unique = new Map<string, ShotSearchCandidateV1>();
  for (const candidate of validated.sort(compareUpstreamCandidates)) {
    const key = `${candidate.asset_id}\u0000${candidate.shot_id}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].sort(compareUpstreamCandidates).map((candidate, index) => ({
    schema_version: '1.0',
    asset_id: candidate.asset_id,
    shot_id: candidate.shot_id,
    semantic_rank: index + 1,
    semantic_score: candidate.semantic_score,
    material_family: materialFamily,
    enabled: true,
    start_ms: candidate.start_ms,
    end_ms: candidate.end_ms,
    revision: candidate.revision,
    metadata: { descriptor: candidate.descriptor },
  }));
}
