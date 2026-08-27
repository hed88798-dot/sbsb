import {
  shotSearchCandidateV1Schema,
  type ShotSearchCandidateV1,
  type VisualDescriptorV1,
} from '@app/contracts';

export interface ExactSearchScoreRow {
  asset_id: string;
  shot_id: string;
  revision: number;
  start_ms: number;
  end_ms: number;
  semantic_score: number;
}

export interface SearchDescriptorRow {
  assetId: string;
  shotId: string;
  revision: number;
  startMs: number;
  endMs: number;
  descriptor: VisualDescriptorV1;
}

export function hydrateSearchCandidates(
  scores: ExactSearchScoreRow[],
  descriptors: SearchDescriptorRow[],
): ShotSearchCandidateV1[] {
  const byShot = new Map(descriptors.map((row) => [row.shotId, row]));
  return scores.flatMap((score) => {
    const row = byShot.get(score.shot_id);
    if (
      !row ||
      row.assetId !== score.asset_id ||
      row.revision !== score.revision ||
      row.startMs !== score.start_ms ||
      row.endMs !== score.end_ms
    ) {
      return [];
    }
    return [
      shotSearchCandidateV1Schema.parse({
        schema_version: '1.0',
        ...score,
        descriptor: row.descriptor,
      }),
    ];
  });
}
