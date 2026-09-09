import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MaterialSelectionService,
  stableSha256,
} from '../apps/desktop/dist-electron/main/material-selection-service.js';
import { MATERIAL_SELECTION_POLICY_V1 } from '../packages/domain-auto-edit/dist/index.js';
import { MaterialSelectionRepository, openDatabase } from '../packages/local-db/dist/index.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = JSON.parse(
  readFileSync(
    resolve(
      root,
      'tests/fixtures/material-selection/MATERIAL_SELECTION_10_VIDEO_REGRESSION_V1.json',
    ),
    'utf8',
  ),
);

function candidate(assetId, shotId, score) {
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

const reports = [];
for (const scenario of fixture.scenarios) {
  const directory = mkdtempSync(join(tmpdir(), `code-d-regression-${scenario.id}-`));
  try {
    const { db } = await openDatabase({
      dbPath: join(directory, 'app.db'),
      migrationsDirectory: resolve(root, 'migrations/desktop-sqlite'),
    });
    let tick = 0;
    const service = new MaterialSelectionService({
      repository: new MaterialSelectionRepository(db),
      clock: () => `2026-09-09T00:00:${String(tick++).padStart(2, '0')}.000Z`,
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
    const selectedAssets = results.map((result) => result.selected_asset_id);
    const selectedShots = results.map((result) => result.selected_shot_id);
    reports.push({
      scenario: scenario.id,
      selected_sequence: selectedShots,
      unique_assets: new Set(selectedAssets).size,
      unique_shots: new Set(selectedShots).size,
      repeat_count: selectedShots.length - new Set(selectedShots).size,
      degradation_count: results.filter((result) => result.degradation_level > 0).length,
      usage_distribution: Object.fromEntries(
        [...new Set(selectedAssets)]
          .sort()
          .map((asset) => [asset, selectedAssets.filter((selected) => selected === asset).length]),
      ),
      decision_receipt_hashes: results.map((result) => result.decision_receipt_hash),
    });
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      schema_version: fixture.schema_version,
      policy_id: MATERIAL_SELECTION_POLICY_V1.policy_id,
      policy_version: MATERIAL_SELECTION_POLICY_V1.policy_version,
      policy_sha256: stableSha256(MATERIAL_SELECTION_POLICY_V1),
      reports,
    },
    null,
    2,
  )}\n`,
);
