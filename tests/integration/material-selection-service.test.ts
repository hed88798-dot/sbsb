import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShotSearchCandidateV1 } from '@app/contracts';
import { MaterialSelectionService } from '../../apps/desktop/src/main/material-selection-service.js';
import { adaptCodeCCandidates } from '../../packages/domain-auto-edit/src/index.js';
import { MaterialSelectionRepository, openDatabase } from '../../packages/local-db/src/index.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
let database: Database;
let repository: MaterialSelectionRepository;
let service: MaterialSelectionService;
let tick = 0;

function codeCCandidate(assetId: string, shotId: string, score: number): ShotSearchCandidateV1 {
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

function input(
  requestId: string,
  candidates: ShotSearchCandidateV1[],
  overrides: Record<string, string> = {},
) {
  return {
    intent: {
      schema_version: '1.0' as const,
      selection_request_id: requestId,
      batch_id: overrides.batch_id ?? 'batch_1',
      video_id: overrides.video_id ?? `video_${requestId}`,
      slot_id: overrides.slot_id ?? 'slot_1',
      material_family: 'ANIMAL' as const,
      candidate_set_id: `set_${requestId}`,
      candidate_set_contract_version: 'code-c-shot-search-v1' as const,
    },
    eligibleCandidates: candidates,
  };
}

beforeEach(async () => {
  tick = 0;
  const directory = mkdtempSync(join(tmpdir(), 'material-selection-'));
  const dbPath = join(directory, 'app.db');
  database = (await openDatabase({ dbPath, migrationsDirectory })).db;
  repository = new MaterialSelectionRepository(database);
  service = new MaterialSelectionService({
    repository,
    clock: () => `2026-09-09T00:00:${String(tick++).padStart(2, '0')}.000Z`,
  });
});

afterEach(() => database.close());

describe('Main-owned material selection transaction', () => {
  it('adapts the frozen Code C contract independent of transport order', () => {
    const candidates = [
      codeCCandidate('asset_b', 'shot_b', 0.8),
      codeCCandidate('asset_a', 'shot_a', 0.9),
    ];
    expect(adaptCodeCCandidates(candidates, 'ANIMAL')).toEqual(
      adaptCodeCCandidates([...candidates].reverse(), 'ANIMAL'),
    );
  });

  it('persists SELECTED and derives authoritative usage only from committed selected decisions', () => {
    const result = service.select(
      input('request_selected', [codeCCandidate('asset_a', 'shot_a', 0.9)]),
    );
    expect(repository.get('request_selected')).toEqual(result);
    expect(repository.listAuthoritativeUsage().selected_decisions).toHaveLength(1);
    expect(result.decision_receipt_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      database
        .prepare(
          `SELECT policy_snapshot_hash FROM material_selection_decisions
           WHERE selection_request_id = ?`,
        )
        .pluck()
        .get('request_selected'),
    ).toBe(result.policy_snapshot_hash);
  });

  it('persists NO_MATCH idempotently without incrementing usage', () => {
    const first = service.select(input('request_no_match', []));
    const retried = service.select(
      input('request_no_match', [codeCCandidate('asset_later', 'shot_later', 1)]),
    );
    expect(first).toEqual(retried);
    expect(first.status).toBe('NO_MATCH');
    expect(repository.listAuthoritativeUsage().selected_decisions).toHaveLength(0);
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(1);
  });

  it('returns the same committed selection after restart', async () => {
    const first = service.select(
      input('request_restart', [codeCCandidate('asset_a', 'shot_a', 1)]),
    );
    const dbPath = database.name;
    database.close();
    database = (await openDatabase({ dbPath, migrationsDirectory })).db;
    repository = new MaterialSelectionRepository(database);
    service = new MaterialSelectionService({ repository, clock: () => '2030-01-01T00:00:00.000Z' });
    const retried = service.select(
      input('request_restart', [codeCCandidate('asset_b', 'shot_b', 2)]),
    );
    expect(retried).toEqual(first);
  });

  it('serializes concurrent calls and prevents double counting', async () => {
    const calls = await Promise.all([
      Promise.resolve().then(() =>
        service.select(input('request_concurrent', [codeCCandidate('asset_a', 'shot_a', 1)])),
      ),
      Promise.resolve().then(() =>
        service.select(input('request_concurrent', [codeCCandidate('asset_a', 'shot_a', 1)])),
      ),
    ]);
    expect(calls[0]).toEqual(calls[1]);
    expect(repository.listAuthoritativeUsage().selected_decisions).toHaveLength(1);
  });

  it('serializes distinct concurrent requests against newly committed usage', async () => {
    const candidates = [
      codeCCandidate('asset_a', 'shot_a', 1),
      codeCCandidate('asset_b', 'shot_b', 0.9),
    ];
    const results = await Promise.all([
      Promise.resolve().then(() =>
        service.select(input('request_concurrent_a', candidates, { batch_id: 'shared_batch' })),
      ),
      Promise.resolve().then(() =>
        service.select(input('request_concurrent_b', candidates, { batch_id: 'shared_batch' })),
      ),
    ]);
    expect(new Set(results.map((result) => result.selected_asset_id)).size).toBe(2);
    expect(repository.listAuthoritativeUsage().selected_decisions).toHaveLength(2);
  });

  it('rejects attempts to inject authoritative history into Main intent', () => {
    const attemptedIntent = {
      ...input('request_injected', []).intent,
      usage_history_snapshot: { schema_version: '1.0', selected_decisions: [] },
    };
    expect(() => service.select({ intent: attemptedIntent, eligibleCandidates: [] })).toThrow();
  });

  it('fails closed when a purported Code C candidate violates the frozen schema', () => {
    const invalid = { ...codeCCandidate('asset_a', 'shot_a', 1), shot_id: '' };
    expect(() =>
      service.select({
        ...input('request_invalid', []),
        eligibleCandidates: [invalid],
      }),
    ).toThrow();
    expect(repository.get('request_invalid')).toBeNull();
  });
});
