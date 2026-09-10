import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShotSearchCandidateV1 } from '@app/contracts';
import {
  MaterialSelectionRepository,
  MediaIndexRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import {
  MaterialSelectionService,
  verifyCommittedMaterialSelectionEvidenceV1,
} from '../../apps/desktop/src/main/material-selection-service.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
let database: Database;
let materialRepository: MaterialSelectionRepository;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function candidate(assetId = 'asset_1', shotId = 'shot_1'): ShotSearchCandidateV1 {
  return {
    schema_version: '1.0',
    asset_id: assetId,
    shot_id: shotId,
    start_ms: 100,
    end_ms: 500,
    revision: 1,
    semantic_score: 0.9,
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

function select(requestId: string, candidates: ShotSearchCandidateV1[]) {
  return new MaterialSelectionService({
    repository: materialRepository,
    clock: () => '2026-09-10T00:00:00.000Z',
  }).select({
    intent: {
      schema_version: '1.0',
      selection_request_id: requestId,
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: 'slot_1',
      material_family: 'ANIMAL',
      candidate_set_id: 'candidate_set_1',
      candidate_set_contract_version: 'code-c-shot-search-v1',
    },
    eligibleCandidates: candidates,
  });
}

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'timeline-e5-boundary-'));
  database = (await openDatabase({ dbPath: join(directory, 'app.db'), migrationsDirectory })).db;
  materialRepository = new MaterialSelectionRepository(database);
});

afterEach(() => database.close());

describe('typed committed Code D evidence read', () => {
  it('reads and verifies complete SELECTED evidence', () => {
    const result = select('selection_selected', [candidate()]);
    const evidence = materialRepository.getCommittedEvidence(result.selection_request_id)!;
    expect(verifyCommittedMaterialSelectionEvidenceV1(evidence)).toEqual(evidence);
    expect(evidence.request.candidates[0]).toMatchObject({
      asset_id: 'asset_1',
      shot_id: 'shot_1',
      revision: 1,
      start_ms: 100,
      end_ms: 500,
    });
  });

  it('reads and verifies complete NO_MATCH evidence', () => {
    const result = select('selection_no_match', []);
    const evidence = materialRepository.getCommittedEvidence(result.selection_request_id)!;
    expect(verifyCommittedMaterialSelectionEvidenceV1(evidence).result.status).toBe('NO_MATCH');
  });

  it.each(['request_json', 'decision_receipt_json', 'result_json'] as const)(
    'fails closed when %s identity is corrupted',
    (column) => {
      select('selection_corrupt', [candidate()]);
      const row = database
        .prepare(`SELECT ${column} AS bytes FROM material_selection_decisions`)
        .get() as { bytes: string };
      const value = JSON.parse(row.bytes) as Record<string, unknown>;
      value.slot_id = 'slot_corrupt';
      database
        .prepare(`UPDATE material_selection_decisions SET ${column} = ?`)
        .run(JSON.stringify(value));
      expect(() => materialRepository.getCommittedEvidence('selection_corrupt')).toThrow();
    },
  );

  it('fails closed when the receipt hash is corrupted', () => {
    select('selection_bad_receipt', [candidate()]);
    const row = database.prepare('SELECT result_json FROM material_selection_decisions').get() as {
      result_json: string;
    };
    const result = JSON.parse(row.result_json) as Record<string, unknown>;
    result.decision_receipt_hash = '0'.repeat(64);
    database
      .prepare(
        `UPDATE material_selection_decisions
         SET decision_receipt_hash = ?, result_json = ?`,
      )
      .run('0'.repeat(64), JSON.stringify(result));
    const evidence = materialRepository.getCommittedEvidence('selection_bad_receipt')!;
    expect(() => verifyCommittedMaterialSelectionEvidenceV1(evidence)).toThrowError(
      'MATERIAL_SELECTION_COMMITTED_EVIDENCE_INTEGRITY_MISMATCH',
    );
  });

  it('fails closed when the candidate-set hash is corrupted', () => {
    select('selection_bad_candidates', [candidate()]);
    const row = database
      .prepare(
        `SELECT request_json, decision_receipt_json, result_json
         FROM material_selection_decisions`,
      )
      .get() as Record<string, string>;
    const request = JSON.parse(row.request_json!) as Record<string, unknown>;
    const receipt = JSON.parse(row.decision_receipt_json!) as Record<string, unknown>;
    const result = JSON.parse(row.result_json!) as Record<string, unknown>;
    for (const value of [request, receipt, result]) value.candidate_set_hash = '0'.repeat(64);
    database
      .prepare(
        `UPDATE material_selection_decisions SET candidate_set_hash = ?,
         request_json = ?, decision_receipt_json = ?, result_json = ?`,
      )
      .run(
        '0'.repeat(64),
        JSON.stringify(request),
        JSON.stringify(receipt),
        JSON.stringify(result),
      );
    const evidence = materialRepository.getCommittedEvidence('selection_bad_candidates')!;
    expect(() => verifyCommittedMaterialSelectionEvidenceV1(evidence)).toThrowError(
      'MATERIAL_SELECTION_COMMITTED_EVIDENCE_INTEGRITY_MISMATCH',
    );
  });

  it.each([
    ['history_snapshot_hash', 'history_snapshot_hash'],
    ['policy_snapshot_hash', 'policy_snapshot_hash'],
  ] as const)('fails closed when the frozen %s is corrupted', (column, field) => {
    select(`selection_bad_${field}`, [candidate()]);
    const row = database
      .prepare(
        `SELECT request_json, decision_receipt_json, result_json
         FROM material_selection_decisions
         WHERE selection_request_id = ?`,
      )
      .get(`selection_bad_${field}`) as Record<string, string>;
    const request = JSON.parse(row.request_json!) as Record<string, unknown>;
    const receipt = JSON.parse(row.decision_receipt_json!) as Record<string, unknown>;
    const result = JSON.parse(row.result_json!) as Record<string, unknown>;
    for (const value of [request, receipt, result]) value[field] = '0'.repeat(64);
    database
      .prepare(
        `UPDATE material_selection_decisions SET ${column} = ?,
         request_json = ?, decision_receipt_json = ?, result_json = ?
         WHERE selection_request_id = ?`,
      )
      .run(
        '0'.repeat(64),
        JSON.stringify(request),
        JSON.stringify(receipt),
        JSON.stringify(result),
        `selection_bad_${field}`,
      );
    const evidence = materialRepository.getCommittedEvidence(`selection_bad_${field}`)!;
    expect(() => verifyCommittedMaterialSelectionEvidenceV1(evidence)).toThrowError(
      'MATERIAL_SELECTION_COMMITTED_EVIDENCE_INTEGRITY_MISMATCH',
    );
  });
});

describe('exact historical media execution validity', () => {
  function seedExactMedia(
    options: {
      sourceBytes?: string;
      storedHash?: string;
      locationStatus?: 'PRESENT' | 'MISSING';
    } = {},
  ) {
    const sourceBytes = options.sourceBytes ?? 'revision-one-source';
    const sourcePath = join(mkdtempSync(join(tmpdir(), 'timeline-e5-media-')), 'source.mp4');
    writeFileSync(sourcePath, sourceBytes);
    const now = '2026-09-10T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO media_assets(
          asset_id, file_hash, media_type, status, active_revision, created_at, updated_at
        ) VALUES (?, ?, 'video', 'ACTIVE', 2, ?, ?)`,
      )
      .run('asset_exact', sha256('active-revision-two'), now, now);
    database
      .prepare(
        `INSERT INTO asset_revisions(
          asset_id, revision, file_hash, duration_ms, width, height, rotation, fps,
          index_signature_hash, generation_key_hash, index_signature_json, manifest_sha256,
          worker_version, state, created_at
        ) VALUES (?, ?, ?, 1000, 100, 100, 0, 25, ?, ?, '{}', ?, 'worker', 'READY', ?)`,
      )
      .run(
        'asset_exact',
        1,
        options.storedHash ?? sha256(sourceBytes),
        '1'.repeat(64),
        '2'.repeat(64),
        '3'.repeat(64),
        now,
      );
    database
      .prepare(
        `INSERT INTO asset_revisions(
          asset_id, revision, file_hash, duration_ms, width, height, rotation, fps,
          index_signature_hash, generation_key_hash, index_signature_json, manifest_sha256,
          worker_version, state, created_at
        ) VALUES (?, 2, ?, 1000, 100, 100, 0, 25, ?, ?, '{}', ?, 'worker', 'READY', ?)`,
      )
      .run(
        'asset_exact',
        sha256('active-revision-two'),
        '4'.repeat(64),
        '5'.repeat(64),
        '6'.repeat(64),
        now,
      );
    database
      .prepare(
        `INSERT INTO shots(
          shot_id, asset_id, revision, start_ms, end_ms, quality_score, analysis_status
        ) VALUES ('shot_exact', 'asset_exact', 1, 100, 500, 0.8, 'READY')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO media_asset_locations(
          location_id, asset_id, source_path, normalized_path, size_bytes, mtime_ns,
          file_identity, location_status, last_seen_at
        ) VALUES ('location_exact', 'asset_exact', ?, ?, ?, '1', NULL, ?, ?)`,
      )
      .run(
        sourcePath,
        sourcePath,
        Buffer.byteLength(sourceBytes),
        options.locationStatus ?? 'PRESENT',
        now,
      );
    return sourcePath;
  }

  function assertExact(repository: MediaIndexRepository) {
    return repository.assertExactShotExecutable({
      asset_id: 'asset_exact',
      revision: 1,
      shot_id: 'shot_exact',
      start_ms: 100,
      end_ms: 500,
    });
  }

  it('accepts an exact historical non-active revision when its bytes remain valid', () => {
    const sourcePath = seedExactMedia();
    expect(assertExact(new MediaIndexRepository(database))).toMatchObject({
      revision: 1,
      sourcePath: realpathSync(sourcePath),
    });
  });

  it('rejects a missing exact revision instead of using the active revision', () => {
    seedExactMedia();
    expect(() =>
      new MediaIndexRepository(database).assertExactShotExecutable({
        asset_id: 'asset_exact',
        revision: 3,
        shot_id: 'shot_exact',
        start_ms: 100,
        end_ms: 500,
      }),
    ).toThrowError('EXACT_MEDIA_REVISION_NOT_EXECUTABLE');
  });

  it('rejects a wrong committed shot range', () => {
    seedExactMedia();
    expect(() =>
      new MediaIndexRepository(database).assertExactShotExecutable({
        asset_id: 'asset_exact',
        revision: 1,
        shot_id: 'shot_exact',
        start_ms: 0,
        end_ms: 500,
      }),
    ).toThrowError('EXACT_MEDIA_REVISION_NOT_EXECUTABLE');
  });

  it('rejects a source file that is no longer present', () => {
    seedExactMedia({ locationStatus: 'MISSING' });
    expect(() => assertExact(new MediaIndexRepository(database))).toThrowError(
      'EXACT_MEDIA_REVISION_NOT_EXECUTABLE',
    );
  });

  it('rejects source bytes that do not match the exact revision hash', () => {
    seedExactMedia({ storedHash: sha256('different-bytes') });
    expect(() => assertExact(new MediaIndexRepository(database))).toThrowError(
      'EXACT_MEDIA_REVISION_NOT_EXECUTABLE',
    );
  });
});
