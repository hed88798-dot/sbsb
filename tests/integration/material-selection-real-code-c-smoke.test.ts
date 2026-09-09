import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ShotSearchCandidateV1 } from '@app/contracts';
import { MaterialSelectionService } from '../../apps/desktop/src/main/material-selection-service.js';
import { MaterialSelectionRepository, openDatabase } from '../../packages/local-db/src/index.js';

describe('read-only real Code C candidate smoke', () => {
  it('selects only among GQ006 V3 candidates already marked semantically eligible', async () => {
    const root = resolve(import.meta.dirname, '../..');
    const v3 = JSON.parse(
      readFileSync(
        resolve(root, 'tests/fixtures/real-retrieval/code-c-v3-golden-baseline.json'),
        'utf8',
      ),
    ) as {
      golden: { gq006: { top5_unique_assets: Array<{ asset_id: string; ground_truth: boolean }> } };
    };
    const derived = JSON.parse(
      readFileSync(
        resolve(root, 'tests/fixtures/material-selection/code-d-gq006-eligible-candidates-v1.json'),
        'utf8',
      ),
    ) as {
      eligible_candidates: Array<{
        asset_id: string;
        shot_id: string;
        semantic_score: number;
        start_ms: number;
        end_ms: number;
      }>;
    };
    const eligibleAssets = new Set(
      v3.golden.gq006.top5_unique_assets
        .filter((entry) => entry.ground_truth)
        .map((entry) => entry.asset_id),
    );
    expect(derived.eligible_candidates.every((entry) => eligibleAssets.has(entry.asset_id))).toBe(
      true,
    );
    const candidates: ShotSearchCandidateV1[] = derived.eligible_candidates.map((entry) => ({
      schema_version: '1.0',
      ...entry,
      revision: 1,
      descriptor: {
        schema_version: '1.0',
        shot_id: entry.shot_id,
        species: ['pig'],
        scene: 'farm',
        action: ['drinking'],
        health_state: 'unknown',
        people_present: false,
        product_present: false,
        shot_type: 'unknown',
        description: 'pig drinking water',
        quality: { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 },
        embedding_ref: `embedding_${entry.shot_id}`,
        industry_metadata: {},
        confidence: {},
        provenance: { source: 'code-c-v3' },
        evidence: {},
      },
    }));
    const directory = mkdtempSync(join(tmpdir(), 'real-code-c-selection-'));
    const { db } = await openDatabase({
      dbPath: join(directory, 'app.db'),
      migrationsDirectory: resolve(root, 'migrations/desktop-sqlite'),
    });
    const result = new MaterialSelectionService({
      repository: new MaterialSelectionRepository(db),
      clock: () => '2026-09-09T00:00:00.000Z',
    }).select({
      intent: {
        schema_version: '1.0',
        selection_request_id: 'gq006_smoke',
        batch_id: 'gq006_batch',
        video_id: 'gq006_video',
        slot_id: 'slot_1',
        material_family: 'ANIMAL',
        candidate_set_id: 'code-c-v3-gq006-short-zh',
        candidate_set_contract_version: 'code-c-shot-search-v1',
      },
      eligibleCandidates: candidates,
    });
    expect(result.status).toBe('SELECTED');
    expect(eligibleAssets.has(result.selected_asset_id!)).toBe(true);
    expect(candidates.some((candidate) => candidate.shot_id === result.selected_shot_id)).toBe(
      true,
    );
    db.close();
  });
});
