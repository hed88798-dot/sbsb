import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShotPlanAuthorityService } from '../../apps/desktop/src/main/shot-plan-authority-service.js';
import { SourceDocumentAuthorityService } from '../../apps/desktop/src/main/source-document-authority-service.js';
import type {
  CandidateShotPlanV1,
  CanonicalSourceDocumentV1,
  ShotPlanCandidateResolutionV1,
  ShotPlanRouteV1,
} from '../../packages/contracts/src/index.js';
import {
  CopywritingRepository,
  ShotPlanAuthorityRepository,
  SourceDocumentRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import {
  computeConfirmedShotPlanHash,
  parseConfirmedShotPlanV1,
} from '../../packages/timeline/src/index.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
const now = '2026-09-17T01:02:03.000Z';
let database: Database;
let repository: ShotPlanAuthorityRepository;
let sourceRepository: SourceDocumentRepository;
let service: ShotPlanAuthorityService;
let sourceAuthority: SourceDocumentAuthorityService;
let idCounter: number;

function insertSource(
  text: string,
  options: { scriptId?: string; version?: number } = {},
): CanonicalSourceDocumentV1 {
  const scriptId = options.scriptId ?? `script_${idCounter++}`;
  const version = options.version ?? 1;
  database
    .prepare(
      `INSERT OR IGNORE INTO scripts(script_id, product_id, current_version, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?)`,
    )
    .run(scriptId, version, now, now);
  database
    .prepare(
      `INSERT INTO script_versions(
        script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
        fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
        provider_model, request_snapshot_hash, created_at
      ) VALUES (?, ?, ?, ?, 'SUCCEEDED', NULL, '[]', 'test', '1', 'mock', 'mock', ?, ?)`,
    )
    .run(scriptId, version, text, text, 'a'.repeat(64), now);
  database
    .prepare('UPDATE scripts SET current_version = ?, updated_at = ? WHERE script_id = ?')
    .run(version, now, scriptId);
  return sourceAuthority.ensureFromScriptVersion({ script_id: scriptId, script_version: version });
}

function slot(
  source: string,
  start: number,
  end: number,
  options: {
    order?: number;
    route?: ShotPlanRouteV1 | null;
    routeState?: ShotPlanCandidateResolutionV1;
    group?: string | null;
    continuityState?: ShotPlanCandidateResolutionV1;
    blockingWarning?: boolean;
  } = {},
) {
  return {
    order_index: options.order ?? 0,
    source_start: start,
    source_end: end,
    source_text: Array.from(source).slice(start, end).join(''),
    route: options.route === undefined ? ('ANIMAL' as const) : options.route,
    route_state: options.routeState ?? ('RESOLVED' as const),
    visual_continuity_group_id: options.group === undefined ? 'group_1' : options.group,
    continuity_state: options.continuityState ?? ('RESOLVED' as const),
    rationale: 'product-facing rationale',
    review_warnings: options.blockingWarning
      ? [{ code: 'REVIEW_REQUIRED', severity: 'BLOCKING' as const, message: '需要人工确认' }]
      : [],
  };
}

function createCandidate(
  source: CanonicalSourceDocumentV1,
  options: {
    slots?: ReturnType<typeof slot>[];
    segmentationState?: ShotPlanCandidateResolutionV1;
  } = {},
) {
  return service.createCandidate({
    source_document_id: source.source_document_id,
    source_document_version: source.source_document_version,
    source_document_hash: source.source_document_hash,
    segmentation_state: options.segmentationState ?? 'RESOLVED',
    slots: options.slots ?? [slot(source.text, 0, Array.from(source.text).length)],
  });
}

function intent(candidate: CandidateShotPlanV1) {
  return {
    candidate_id: candidate.candidate_id,
    candidate_revision: candidate.candidate_revision,
    source_document_id: candidate.source_document_id,
    source_document_version: candidate.source_document_version,
    source_document_hash: candidate.source_document_hash,
  };
}

function bypassSourceDocumentProtection(): void {
  database.exec('DROP TRIGGER source_document_versions_reject_update');
}

function corruptSourceDocumentText(source: CanonicalSourceDocumentV1): void {
  bypassSourceDocumentProtection();
  database
    .prepare(
      `UPDATE source_document_versions
       SET text = ?
       WHERE source_document_id = ? AND version = ?`,
    )
    .run(`${source.text}（已篡改）`, source.source_document_id, source.source_document_version);
}

beforeEach(async () => {
  idCounter = 1;
  const directory = mkdtempSync(join(tmpdir(), 'shot-plan-authority-'));
  database = (await openDatabase({ dbPath: join(directory, 'app.db'), migrationsDirectory })).db;
  sourceRepository = new SourceDocumentRepository(database);
  sourceAuthority = new SourceDocumentAuthorityService({
    scripts: new CopywritingRepository(database),
    sourceDocuments: sourceRepository,
    clock: () => now,
  });
  repository = new ShotPlanAuthorityRepository(database);
  service = new ShotPlanAuthorityService({
    repository,
    sourceDocuments: sourceRepository,
    clock: () => now,
    id: (kind) => `${kind}_${idCounter++}`,
  });
});

afterEach(() => {
  if (database.open) database.close();
});

describe('Shot Plan authority foundation', () => {
  it('creates a non-executable candidate bound to the exact Source Document at revision 1', () => {
    const source = insertSource('猪群咳喘');
    const record = createCandidate(source);
    expect(record.candidate).toMatchObject({
      candidate_revision: 1,
      candidate_status: 'ACTIVE',
      source_document_id: source.source_document_id,
      source_document_version: source.source_document_version,
      source_document_hash: source.source_document_hash,
      source_offset_unit: 'UNICODE_CODE_POINT',
    });
    expect(record.candidate).not.toHaveProperty('shot_plan_hash');
  });

  it('rejects a missing Source Document', () => {
    expect(() =>
      service.createCandidate({
        source_document_id: 'missing',
        source_document_version: 1,
        source_document_hash: 'a'.repeat(64),
        segmentation_state: 'RESOLVED',
        slots: [slot('猪群', 0, 2)],
      }),
    ).toThrow('SHOT_PLAN_SOURCE_DOCUMENT_NOT_FOUND');
  });

  it('rejects a mismatched Source Document hash', () => {
    const source = insertSource('猪群');
    expect(() =>
      service.createCandidate({
        source_document_id: source.source_document_id,
        source_document_version: source.source_document_version,
        source_document_hash: 'f'.repeat(64),
        segmentation_state: 'RESOLVED',
        slots: [slot(source.text, 0, 2)],
      }),
    ).toThrow('SHOT_PLAN_SOURCE_DOCUMENT_HASH_MISMATCH');
  });

  it('uses Unicode code-point slicing rather than UTF-16 offsets', () => {
    const source = insertSource('猪🐖群');
    const record = createCandidate(source, {
      segmentationState: 'NEEDS_REVIEW',
      slots: [slot(source.text, 1, 2)],
    });
    expect(record.candidate.slots[0]!.source_text).toBe('🐖');
    expect(record.candidate.slots[0]!.source_end).toBe(2);
  });

  it('accepts an astral-plane emoji inside an exactly covered confirmed range', () => {
    const source = insertSource('猪🐖群');
    const candidate = createCandidate(source).candidate;
    expect(service.confirmCandidate(intent(candidate)).plan.slots[0]!.source_text).toBe('猪🐖群');
  });

  it('rejects source_text that differs from the exact source slice', () => {
    const source = insertSource('猪群');
    const wrong = slot(source.text, 0, 2);
    wrong.source_text = '猪 群';
    expect(() => createCandidate(source, { slots: [wrong] })).toThrow(
      'SHOT_PLAN_SOURCE_TEXT_MISMATCH',
    );
  });

  it('rejects overlapping ranges', () => {
    const source = insertSource('猪群咳喘');
    expect(() =>
      createCandidate(source, {
        slots: [slot(source.text, 0, 3), slot(source.text, 2, 4, { order: 1 })],
      }),
    ).toThrow('SHOT_PLAN_SOURCE_RANGE_OVERLAP');
  });

  it('rejects uncovered meaningful content at confirmation', () => {
    const source = insertSource('猪群咳喘');
    const candidate = createCandidate(source, { slots: [slot(source.text, 0, 2)] }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow(
      'SHOT_PLAN_NON_WHITESPACE_GAP',
    );
  });

  it('accepts whitespace-only uncovered gaps', () => {
    const source = insertSource('猪群 \n咳喘');
    const candidate = createCandidate(source, {
      slots: [slot(source.text, 0, 2), slot(source.text, 4, 6, { order: 1 })],
    }).candidate;
    expect(service.confirmCandidate(intent(candidate)).plan.shot_plan_version).toBe(1);
  });

  it.each([
    ['space', ' '],
    ['tab', '\t'],
    ['line feed', '\n'],
    ['ideographic space', '\u3000'],
  ])('accepts an uncovered Unicode %s gap', (_label, whitespace) => {
    const source = insertSource(`猪群${whitespace}咳喘`);
    const rightStart = 2 + Array.from(whitespace).length;
    const candidate = createCandidate(source, {
      slots: [slot(source.text, 0, 2), slot(source.text, rightStart, rightStart + 2, { order: 1 })],
    }).candidate;
    expect(service.confirmCandidate(intent(candidate)).plan.shot_plan_version).toBe(1);
  });

  it.each([
    ['punctuation', '猪群，咳喘', 2, 3],
    ['dash separator', '猪群——咳喘', 2, 4],
    ['list marker', '猪群•咳喘', 2, 3],
    ['dosage symbol', '100%有效', 3, 4],
  ])('rejects a %s gap', (_label, text, leftEnd, rightStart) => {
    const source = insertSource(text);
    const candidate = createCandidate(source, {
      slots: [
        slot(source.text, 0, leftEnd),
        slot(source.text, rightStart, Array.from(text).length, { order: 1 }),
      ],
    }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow(
      'SHOT_PLAN_NON_WHITESPACE_GAP',
    );
  });

  it('requires canonical order_index 0..N-1', () => {
    const source = insertSource('猪群咳喘');
    expect(() =>
      createCandidate(source, { slots: [slot(source.text, 0, 4, { order: 1 })] }),
    ).toThrow('SHOT_PLAN_ORDER_INDEX_INVALID');
  });

  it('enforces slot source ordering', () => {
    const source = insertSource('猪群咳喘');
    expect(() =>
      createCandidate(source, {
        slots: [slot(source.text, 2, 4), slot(source.text, 0, 2, { order: 1 })],
      }),
    ).toThrow();
  });

  it('rejects an invalid route outside the frozen enum', () => {
    const source = insertSource('猪群');
    const invalid = slot(source.text, 0, 2) as ReturnType<typeof slot> & { route: string };
    invalid.route = 'DIGITAL_HUMAN';
    expect(() => createCandidate(source, { slots: [invalid] })).toThrow();
  });

  it('blocks unresolved route confirmation without converting it to NO_MATCH', () => {
    const source = insertSource('表达不清');
    const candidate = createCandidate(source, {
      slots: [slot(source.text, 0, 4, { route: null, routeState: 'NEEDS_REVIEW' })],
    }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow('SHOT_PLAN_ROUTE_UNRESOLVED');
    expect(candidate.slots[0]!.route).toBeNull();
  });

  it('blocks unresolved segmentation confirmation', () => {
    const source = insertSource('猪群咳喘');
    const candidate = createCandidate(source, { segmentationState: 'NEEDS_REVIEW' }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow(
      'SHOT_PLAN_SEGMENTATION_UNRESOLVED',
    );
  });

  it('blocks unresolved continuity confirmation', () => {
    const source = insertSource('猪群咳喘');
    const candidate = createCandidate(source, {
      slots: [
        slot(source.text, 0, 4, {
          group: null,
          continuityState: 'NEEDS_REVIEW',
        }),
      ],
    }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow(
      'SHOT_PLAN_CONTINUITY_UNRESOLVED',
    );
  });

  it('blocks an unresolved blocking warning', () => {
    const source = insertSource('猪群咳喘');
    const candidate = createCandidate(source, {
      slots: [slot(source.text, 0, 4, { blockingWarning: true })],
    }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow('SHOT_PLAN_BLOCKING_WARNING');
  });

  it('permits informational review warnings after the facts are resolved', () => {
    const source = insertSource('猪群咳喘');
    const candidate = service.createCandidate({
      source_document_id: source.source_document_id,
      source_document_version: source.source_document_version,
      source_document_hash: source.source_document_hash,
      segmentation_state: 'RESOLVED',
      review_warnings: [{ code: 'STYLE_NOTE', severity: 'INFORMATIONAL', message: '建议检查节奏' }],
      slots: [slot(source.text, 0, 4)],
    }).candidate;
    expect(service.confirmCandidate(intent(candidate)).plan.shot_plan_version).toBe(1);
  });

  it('allows one continuity group across adjacent same-route slots', () => {
    const source = insertSource('轻咳喘气');
    const candidate = createCandidate(source, {
      slots: [
        slot(source.text, 0, 2, { group: 'symptom' }),
        slot(source.text, 2, 4, { order: 1, group: 'symptom' }),
      ],
    }).candidate;
    expect(service.confirmCandidate(intent(candidate)).plan.slots).toHaveLength(2);
  });

  it('allows same-route slots to intentionally use different groups', () => {
    const source = insertSource('猪群产房');
    const candidate = createCandidate(source, {
      slots: [
        slot(source.text, 0, 2, { group: 'animals' }),
        slot(source.text, 2, 4, { order: 1, group: 'barn' }),
      ],
    }).candidate;
    expect(
      service.confirmCandidate(intent(candidate)).plan.slots[1]!.visual_continuity_group_id,
    ).toBe('barn');
  });

  it('rejects one continuity group across a V1 route change', () => {
    const source = insertSource('猪群产品');
    const candidate = createCandidate(source, {
      slots: [
        slot(source.text, 0, 2, { group: 'same', route: 'ANIMAL' }),
        slot(source.text, 2, 4, { order: 1, group: 'same', route: 'PRODUCT' }),
      ],
    }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow(
      'SHOT_PLAN_CONTINUITY_ROUTE_MISMATCH',
    );
  });

  it('rejects continuity-group reuse after interruption', () => {
    const source = insertSource('甲乙丙');
    const candidate = createCandidate(source, {
      slots: [
        slot(source.text, 0, 1, { group: 'a' }),
        slot(source.text, 1, 2, { order: 1, group: 'b' }),
        slot(source.text, 2, 3, { order: 2, group: 'a' }),
      ],
    }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow(
      'SHOT_PLAN_CONTINUITY_GROUP_REUSED',
    );
  });

  it('strips candidate rationale, warnings, and resolution metadata from confirmed authority', () => {
    const source = insertSource('猪群');
    const confirmed = service.confirmCandidate(intent(createCandidate(source).candidate)).plan;
    expect(confirmed.slots[0]).not.toHaveProperty('rationale');
    expect(confirmed.slots[0]).not.toHaveProperty('review_warnings');
    expect(confirmed.slots[0]).not.toHaveProperty('route_state');
  });

  it('creates first confirmed authority version 1 with the existing Code E hash', () => {
    const source = insertSource('猪群');
    const confirmed = service.confirmCandidate(intent(createCandidate(source).candidate)).plan;
    expect(confirmed.shot_plan_version).toBe(1);
    expect(computeConfirmedShotPlanHash(confirmed)).toBe(confirmed.shot_plan_hash);
    expect(parseConfirmedShotPlanV1(confirmed)).toEqual(confirmed);
  });

  it('creates N+1 after a confirmed semantic edit in the same lineage', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const first = service.confirmCandidate(intent(candidate));
    const edited = service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'PRODUCT',
    }).candidate;
    const second = service.confirmCandidate(intent(edited));
    expect(second.plan.shot_plan_id).toBe(first.plan.shot_plan_id);
    expect(second.plan.shot_plan_version).toBe(2);
  });

  it('does not consume confirmed versions for Candidate revisions', () => {
    const source = insertSource('猪群');
    let candidate = createCandidate(source).candidate;
    candidate = service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'PRODUCT',
    }).candidate;
    candidate = service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 2,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'ANIMAL',
    }).candidate;
    expect(service.confirmCandidate(intent(candidate)).plan.shot_plan_version).toBe(1);
  });

  it('does not allocate a confirmed version for a rejected Candidate', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const rejected = service.rejectCandidate({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
    }).candidate;
    expect(() => service.confirmCandidate(intent(rejected))).toThrow(
      'SHOT_PLAN_CANDIDATE_NOT_ACTIVE',
    );
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
  });

  it('allocates a new shot_plan_id for a new Source Document version', () => {
    const firstSource = insertSource('版本一', { scriptId: 'script_versions', version: 1 });
    const first = service.confirmCandidate(intent(createCandidate(firstSource).candidate));
    const secondSource = insertSource('版本二', { scriptId: 'script_versions', version: 2 });
    const second = service.confirmCandidate(intent(createCandidate(secondSource).candidate));
    expect(second.plan.shot_plan_id).not.toBe(first.plan.shot_plan_id);
  });

  it('rejects a parallel V1 lineage for the same exact Source Document', () => {
    const source = insertSource('猪群');
    const left = createCandidate(source).candidate;
    const right = createCandidate(source).candidate;
    service.confirmCandidate(intent(left));
    expect(() => service.confirmCandidate(intent(right))).toThrow(
      'SHOT_PLAN_PARALLEL_LINEAGE_NOT_ALLOWED',
    );
  });

  it('rejects UPDATE and DELETE of confirmed authority', () => {
    const source = insertSource('猪群');
    const confirmed = service.confirmCandidate(intent(createCandidate(source).candidate)).plan;
    expect(() =>
      database
        .prepare(
          'UPDATE confirmed_shot_plan_versions SET shot_plan_hash = ? WHERE shot_plan_id = ?',
        )
        .run('f'.repeat(64), confirmed.shot_plan_id),
    ).toThrow('CONFIRMED_SHOT_PLAN_VERSIONS_APPEND_ONLY');
    expect(() =>
      database
        .prepare('DELETE FROM confirmed_shot_plan_versions WHERE shot_plan_id = ?')
        .run(confirmed.shot_plan_id),
    ).toThrow('CONFIRMED_SHOT_PLAN_VERSIONS_APPEND_ONLY');
  });

  it('trusted reads revalidate canonical hash and reject stored tampering', () => {
    const source = insertSource('猪群');
    const confirmed = service.confirmCandidate(intent(createCandidate(source).candidate)).plan;
    database.exec('DROP TRIGGER confirmed_shot_plan_versions_reject_update');
    database
      .prepare('UPDATE confirmed_shot_plan_versions SET shot_plan_hash = ? WHERE shot_plan_id = ?')
      .run('f'.repeat(64), confirmed.shot_plan_id);
    expect(() => service.getConfirmedVersion(confirmed.shot_plan_id, 1)).toThrow(
      'CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('trusted Candidate reads reject a stored Source Document hash divergence', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    database
      .prepare(
        `UPDATE shot_plan_candidates
         SET source_document_hash = ?, candidate_json = json_set(candidate_json, '$.source_document_hash', ?)
         WHERE candidate_id = ?`,
      )
      .run('f'.repeat(64), 'f'.repeat(64), candidate.candidate_id);
    expect(() => service.getCandidate(candidate.candidate_id)).toThrow(
      'SHOT_PLAN_CANDIDATE_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('trusted Candidate reads transitively reject corrupted Source text with unchanged hash', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    corruptSourceDocumentText(source);
    expect(() => repository.getCandidate(candidate.candidate_id)).toThrow(
      'SHOT_PLAN_CANDIDATE_STORED_INTEGRITY_MISMATCH',
    );
    expect(() => repository.requireCandidate(candidate.candidate_id)).toThrow(
      'SHOT_PLAN_CANDIDATE_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('trusted Confirmed reads transitively reject corrupted Source text with unchanged hash', () => {
    const source = insertSource('猪群');
    const confirmed = service.confirmCandidate(intent(createCandidate(source).candidate));
    corruptSourceDocumentText(source);
    expect(() =>
      repository.getConfirmedVersion(confirmed.plan.shot_plan_id, confirmed.plan.shot_plan_version),
    ).toThrow('CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH');
  });

  it('latest Confirmed read transitively rejects corrupted Source text with unchanged hash', () => {
    const source = insertSource('猪群');
    service.confirmCandidate(intent(createCandidate(source).candidate));
    corruptSourceDocumentText(source);
    expect(() =>
      repository.getLatestConfirmedBySource(
        source.source_document_id,
        source.source_document_version,
      ),
    ).toThrow('CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH');
  });

  it('confirmation lookup transitively rejects corrupted Source text with unchanged hash', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    service.confirmCandidate(intent(candidate));
    corruptSourceDocumentText(source);
    expect(() => repository.findConfirmation(intent(candidate))).toThrow(
      'CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('trusted Shot Plan reads inherit C2 Source metadata integrity rejection', () => {
    const source = insertSource('猪群');
    const confirmed = service.confirmCandidate(intent(createCandidate(source).candidate));
    bypassSourceDocumentProtection();
    database.pragma('ignore_check_constraints = ON');
    try {
      database
        .prepare(
          `UPDATE source_document_versions
           SET source_offset_unit = 'UTF16_CODE_UNIT'
           WHERE source_document_id = ? AND version = ?`,
        )
        .run(source.source_document_id, source.source_document_version);
    } finally {
      database.pragma('ignore_check_constraints = OFF');
    }
    expect(() =>
      repository.getConfirmedVersion(confirmed.plan.shot_plan_id, confirmed.plan.shot_plan_version),
    ).toThrow('CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH');
  });

  it('rolls back lineage and version allocation when confirmation fails atomically', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    expect(() =>
      repository.confirmCandidate({
        intent: intent(candidate),
        new_shot_plan_id: 'plan_atomic',
        created_at: now,
        build: () => {
          throw new Error('SIMULATED_CONFIRMATION_FAILURE');
        },
      }),
    ).toThrow('SIMULATED_CONFIRMATION_FAILURE');
    expect(database.prepare('SELECT COUNT(*) FROM shot_plan_lineages').pluck().get()).toBe(0);
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
  });

  it('reuses duplicate confirmation and never consumes N+1', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const first = service.confirmCandidate(intent(candidate));
    const duplicate = service.confirmCandidate(intent(candidate));
    expect(duplicate).toEqual(first);
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(1);
  });

  it('reuses an exact prior confirmation intent even after the Candidate advances', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const first = service.confirmCandidate(intent(candidate));
    service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'PRODUCT',
    });
    expect(service.confirmCandidate(intent(candidate))).toEqual(first);
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(1);
  });

  it('serializes concurrent logical confirmation attempts through one idempotent authority', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const results = [
      service.confirmCandidate(intent(candidate)),
      service.confirmCandidate(intent(candidate)),
    ];
    expect(new Set(results.map((result) => result.plan.shot_plan_hash)).size).toBe(1);
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(1);
  });

  it('successful mutation requires the exact expected revision and increments exactly once', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const edited = service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'PRODUCT',
    }).candidate;
    expect(edited.candidate_revision).toBe(2);
  });

  it('rejects stale Candidate mutation without last-write-wins', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'PRODUCT',
    });
    expect(() =>
      service.editContinuity({
        candidate_id: candidate.candidate_id,
        expected_candidate_revision: 1,
        slot_id: candidate.slots[0]!.slot_id,
        visual_continuity_group_id: 'stale_group',
      }),
    ).toThrow('SHOT_PLAN_CANDIDATE_REVISION_CONFLICT');
    expect(service.getCandidate(candidate.candidate_id)?.candidate.candidate_revision).toBe(2);
  });

  it('confirmation binds the exact candidate revision reviewed by the caller', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const confirmed = service.confirmCandidate(intent(candidate));
    expect(confirmed.candidate_id).toBe(candidate.candidate_id);
    expect(confirmed.candidate_revision).toBe(1);
  });

  it('rejects stale confirmation after a Candidate mutation', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'PRODUCT',
    });
    expect(() => service.confirmCandidate(intent(candidate))).toThrow(
      'SHOT_PLAN_CONFIRMATION_STALE',
    );
  });

  it('preserves slot_id for route-only edits', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const edited = service.editRoute({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      route: 'PRODUCT',
    }).candidate;
    expect(edited.slots[0]!.slot_id).toBe(candidate.slots[0]!.slot_id);
  });

  it('preserves slot_id for continuity-only edits', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const edited = service.editContinuity({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      visual_continuity_group_id: 'new_group',
    }).candidate;
    expect(edited.slots[0]!.slot_id).toBe(candidate.slots[0]!.slot_id);
  });

  it('preserves slot_id for one-slot-to-one-slot boundary edits', () => {
    const source = insertSource(' 猪群 ');
    const candidate = createCandidate(source, {
      slots: [slot(source.text, 1, 3)],
    }).candidate;
    const edited = service.editBoundary({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      source_start: 0,
      source_end: 3,
    }).candidate;
    expect(edited.slots[0]!.slot_id).toBe(candidate.slots[0]!.slot_id);
  });

  it('preserves slot_id when resolving review metadata without topology change', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source, { segmentationState: 'NEEDS_REVIEW' }).candidate;
    const resolved = service.resolveReview({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      segmentation_state: 'RESOLVED',
    }).candidate;
    expect(resolved.slots[0]!.slot_id).toBe(candidate.slots[0]!.slot_id);
  });

  it('retires the original slot_id and allocates new IDs for every split child', () => {
    const source = insertSource('猪群咳喘');
    const candidate = createCandidate(source).candidate;
    const split = service.splitSlot({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      split_at: 2,
    }).candidate;
    expect(split.slots).toHaveLength(2);
    expect(split.slots.every((entry) => entry.slot_id !== candidate.slots[0]!.slot_id)).toBe(true);
    expect(new Set(split.slots.map((entry) => entry.slot_id)).size).toBe(2);
  });

  it('retires all input IDs and allocates one new slot_id for merge', () => {
    const source = insertSource('猪群咳喘');
    const candidate = createCandidate(source, {
      slots: [slot(source.text, 0, 2), slot(source.text, 2, 4, { order: 1 })],
    }).candidate;
    const oldIds = candidate.slots.map((entry) => entry.slot_id);
    const merged = service.mergeSlots({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_ids: oldIds,
      route: 'ANIMAL',
      visual_continuity_group_id: 'merged_group',
    }).candidate;
    expect(merged.slots).toHaveLength(1);
    expect(oldIds).not.toContain(merged.slots[0]!.slot_id);
  });

  it('recomputes order_index independently from opaque slot IDs after split', () => {
    const source = insertSource('猪群咳喘');
    const candidate = createCandidate(source).candidate;
    const split = service.splitSlot({
      candidate_id: candidate.candidate_id,
      expected_candidate_revision: 1,
      slot_id: candidate.slots[0]!.slot_id,
      split_at: 2,
    }).candidate;
    expect(split.slots.map((entry) => entry.order_index)).toEqual([0, 1]);
    expect(split.slots.every((entry) => !entry.slot_id.includes(String(entry.order_index)))).toBe(
      true,
    );
  });

  it('retains unchanged slot identity across confirmed N to N+1', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    const first = service.confirmCandidate(intent(candidate));
    const editCandidate = service.createCandidateFromConfirmed({
      shot_plan_id: first.plan.shot_plan_id,
      shot_plan_version: 1,
    }).candidate;
    const second = service.confirmCandidate(intent(editCandidate));
    expect(second.plan.shot_plan_version).toBe(2);
    expect(second.plan.slots[0]!.slot_id).toBe(first.plan.slots[0]!.slot_id);
  });

  it('does not derive opaque slot identity from content, range, route, or order', () => {
    const leftSource = insertSource('猪群');
    const rightSource = insertSource('猪群');
    const left = createCandidate(leftSource).candidate.slots[0]!;
    const right = createCandidate(rightSource).candidate.slots[0]!;
    expect(right).toMatchObject({
      source_start: left.source_start,
      source_end: left.source_end,
      source_text: left.source_text,
      route: left.route,
      order_index: left.order_index,
    });
    expect(right.slot_id).not.toBe(left.slot_id);
  });

  it('failed Candidate mutation does not advance revision', () => {
    const source = insertSource('猪群');
    const candidate = createCandidate(source).candidate;
    expect(() =>
      service.editBoundary({
        candidate_id: candidate.candidate_id,
        expected_candidate_revision: 1,
        slot_id: candidate.slots[0]!.slot_id,
        source_start: 2,
        source_end: 2,
      }),
    ).toThrow();
    expect(service.getCandidate(candidate.candidate_id)?.candidate.candidate_revision).toBe(1);
  });

  it('failed confirmation does not consume a confirmed version', () => {
    const source = insertSource('猪群，咳喘');
    const candidate = createCandidate(source, {
      slots: [slot(source.text, 0, 2), slot(source.text, 3, 5, { order: 1 })],
    }).candidate;
    expect(() => service.confirmCandidate(intent(candidate))).toThrow();
    expect(database.prepare('SELECT COUNT(*) FROM shot_plan_lineages').pluck().get()).toBe(0);
    expect(
      database.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
  });

  it('keeps the accepted Source Document authority independently trusted', () => {
    const source = insertSource('猪群');
    expect(
      sourceRepository.getVersion(source.source_document_id, source.source_document_version),
    ).toEqual(source);
  });
});
