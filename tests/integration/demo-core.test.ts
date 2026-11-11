import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DemoCoreService } from '../../apps/desktop/src/main/demo-core-service.js';
import { ShotPlanAuthorityRepository, openDatabase } from '../../packages/local-db/src/index.js';
import { ShotPlanAuthorityService } from '../../apps/desktop/src/main/shot-plan-authority-service.js';
import { SourceDocumentRepository } from '../../packages/local-db/src/index.js';

let database: Database;
let service: DemoCoreService;
beforeEach(async () => {
  database = (
    await openDatabase({
      dbPath: join(mkdtempSync(join(tmpdir(), 'demo-core-')), 'fresh.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    })
  ).db;
  service = new DemoCoreService({ database });
});
afterEach(() => database.close());
function intent(candidate: ReturnType<DemoCoreService['propose']>['candidate']) {
  return {
    candidate_id: candidate.candidate_id,
    candidate_revision: candidate.candidate_revision,
    source_document_id: candidate.source_document_id,
    source_document_version: candidate.source_document_version,
    source_document_hash: candidate.source_document_hash,
  };
}
function authority() {
  return new ShotPlanAuthorityService({
    repository: new ShotPlanAuthorityRepository(database),
    sourceDocuments: new SourceDocumentRepository(database),
  });
}
describe('offline Demo core with a fresh database', () => {
  it('keeps trailing whitespace in the final spoken slot without creating a blank shot', () => {
    const text = '第一句。第二句。\n  ';
    const { candidate } = service.propose({ text, route: 'PRODUCT' });
    expect(candidate.slots).toHaveLength(2);
    expect(candidate.slots.map((slot) => slot.source_text).join('')).toBe(text);
    expect(candidate.slots.every((slot) => slot.source_text.trim().length > 0)).toBe(true);
  });
  it('persists exact user input and needs explicit confirmation, surviving a service restart', () => {
    const text = '🐷健康猪群活动。观察采食情况！做好日常记录。';
    const proposed = service.propose({ text, route: 'ANIMAL' });
    expect(proposed.mode).toBe('OFFLINE_DETERMINISTIC');
    expect(proposed.stage).toBe('PROPOSED');
    expect(proposed.confirmed).toBeNull();
    expect(proposed.candidate.slots).toHaveLength(3);
    expect(proposed.candidate.slots.map((slot) => slot.source_text).join('')).toBe(text);
    expect(proposed.candidate.slots[0]?.source_end).toBe(Array.from('🐷健康猪群活动。').length);
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
    const confirmed = service.confirm(intent(proposed.candidate));
    expect(confirmed.stage).toBe('CONFIRMED');
    expect(confirmed.confirmed?.review_state).toBe('CONFIRMED');
    expect(
      new DemoCoreService({ database }).get({ candidate_id: proposed.candidate.candidate_id }),
    ).toEqual(confirmed);
    expect(service.confirm(intent(proposed.candidate))).toEqual(confirmed);
    expect(database.prepare('SELECT COUNT(*) FROM provider_call_summaries').pluck().get()).toBe(0);
    expect(database.prepare('SELECT provider_alias FROM script_versions').pluck().get()).toBe(
      'local-user-input',
    );
  });
  it('rejects stale revision, forged source binding and rejected candidates', () => {
    const { candidate } = service.propose({ text: '真实产品。检查包装。', route: 'PRODUCT' });
    expect(() => service.confirm({ ...intent(candidate), candidate_revision: 99 })).toThrow(
      'STALE',
    );
    expect(() =>
      service.confirm({ ...intent(candidate), source_document_hash: '0'.repeat(64) }),
    ).toThrow('HASH_MISMATCH');
    const rejected = authority().rejectCandidate({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
    });
    expect(() => service.confirm(intent(rejected.candidate))).toThrow('NOT_ACTIVE');
  });
  it('retains existing authority blocking warnings and unresolved state gates', () => {
    const { candidate } = service.propose({ text: '观察动物。记录变化。', route: 'ANIMAL' });
    const unresolved = authority().resolveReview({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      segmentation_state: 'NEEDS_REVIEW',
    });
    expect(() => service.confirm(intent(unresolved.candidate))).toThrow('SEGMENTATION_UNRESOLVED');
    const blocked = authority().resolveReview({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 2,
      segmentation_state: 'RESOLVED',
      review_warnings: [{ code: 'BLOCK', severity: 'BLOCKING', message: '待核对' }],
    });
    expect(() => service.confirm(intent(blocked.candidate))).toThrow('BLOCKING_WARNING');
  });
  it('bounds input and preserves full coverage when more than three sentences are supplied', () => {
    for (const text of ['', '  ', 'x'.repeat(8001)])
      expect(() => service.propose({ text, route: 'ANIMAL' })).toThrow();
    const { candidate } = service.propose({ text: '一。二。三。四。', route: 'PRODUCT' });
    expect(candidate.slots).toHaveLength(3);
    expect(candidate.slots.map((slot) => slot.source_text).join('')).toBe('一。二。三。四。');
    expect(service.confirm(intent(candidate)).confirmed?.slots).toHaveLength(3);
  });
});
