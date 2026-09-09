import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MaterialFamilyV1, ShotSearchCandidateV1 } from '@app/contracts';
import { MaterialSelectionService } from '../../apps/desktop/src/main/material-selection-service.js';
import { MaterialSelectionRepository, openDatabase } from '../../packages/local-db/src/index.js';

interface Scenario {
  id: string;
  material_family: MaterialFamilyV1;
  candidates: Array<[string, string, number]>;
  expected: {
    unique_assets: number;
    unique_shots: number;
    repeat_count: number;
    degradation_count: number;
  };
}

function candidate(assetId: string, shotId: string, score: number): ShotSearchCandidateV1 {
  return {
    schema_version: '1.0',
    asset_id: assetId,
    shot_id: shotId,
    start_ms: 0,
    end_ms: 1000,
    revision: 1,
    semantic_score: score,
    descriptor: {
      schema_version: '1.0',
      shot_id: shotId,
      species: 'unknown',
      scene: 'unknown',
      action: 'unknown',
      health_state: 'unknown',
      people_present: null,
      product_present: null,
      shot_type: 'unknown',
      description: '',
      quality: { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 },
      embedding_ref: `embedding_${shotId}`,
      industry_metadata: {},
      confidence: {},
      provenance: {},
      evidence: {},
    },
  };
}

describe('MATERIAL_SELECTION_10_VIDEO_REGRESSION_V1', () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../fixtures/material-selection/MATERIAL_SELECTION_10_VIDEO_REGRESSION_V1.json',
      ),
      'utf8',
    ),
  ) as { scenarios: Scenario[] };

  it.each(fixture.scenarios)(
    '$id reports deterministic diversity and scarcity metrics',
    async (scenario) => {
      const directory = mkdtempSync(join(tmpdir(), `selection-regression-${scenario.id}-`));
      const { db } = await openDatabase({
        dbPath: join(directory, 'app.db'),
        migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
      });
      let clockTick = 0;
      const service = new MaterialSelectionService({
        repository: new MaterialSelectionRepository(db),
        clock: () => `2026-09-09T00:00:${String(clockTick++).padStart(2, '0')}.000Z`,
      });
      const candidates = scenario.candidates.map(([asset, shot, score]) =>
        candidate(asset, shot, score),
      );
      const results = Array.from({ length: 10 }, (_, index) =>
        service.select({
          intent: {
            schema_version: '1.0',
            selection_request_id: `${scenario.id}_request_${index}`,
            batch_id: `${scenario.id}_batch`,
            video_id: `${scenario.id}_video_${index}`,
            slot_id: 'slot_1',
            material_family: scenario.material_family,
            candidate_set_id: `${scenario.id}_candidate_set`,
            candidate_set_contract_version: 'code-c-shot-search-v1',
          },
          eligibleCandidates: candidates,
        }),
      );
      const selectedAssets = results.map((result) => result.selected_asset_id!);
      const selectedShots = results.map((result) => result.selected_shot_id!);
      const report = {
        selected_sequence: selectedShots,
        unique_assets: new Set(selectedAssets).size,
        unique_shots: new Set(selectedShots).size,
        repeat_count: selectedShots.length - new Set(selectedShots).size,
        degradation_count: results.filter((result) => result.degradation_level > 0).length,
        usage_distribution: Object.fromEntries(
          [...new Set(selectedAssets)]
            .sort()
            .map((asset) => [
              asset,
              selectedAssets.filter((selected) => selected === asset).length,
            ]),
        ),
        decision_receipt_hashes: results.map((result) => result.decision_receipt_hash),
      };
      expect(report).toMatchObject(scenario.expected);
      expect(report.decision_receipt_hashes.every((value) => /^[a-f0-9]{64}$/u.test(value))).toBe(
        true,
      );
      db.close();
    },
  );
});
