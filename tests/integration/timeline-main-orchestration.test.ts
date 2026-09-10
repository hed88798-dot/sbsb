import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
  type ConfirmedShotPlanV1,
  type MaterialCandidateV1,
  type NarrationTimingSnapshotV1,
  type ShotSearchCandidateV1,
  type TimelinePlanningRequestV1,
} from '../../packages/contracts/src/index.js';
import {
  MaterialSelectionRepository,
  MediaIndexRepository,
  TimelinePlanRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
  computeTimelineDurationPolicyHash,
  computeTimelinePlanningRequestHash,
  type TimelineDurationPolicyV1,
} from '../../packages/timeline/src/index.js';
import {
  computeMaterialCandidateSetHashV1,
  computeMaterialSelectionReceiptHashV1,
  MaterialSelectionService,
  stableCanonicalJson,
  type SupplementalMaterialSelectionExecutionInputV1,
} from '../../apps/desktop/src/main/material-selection-service.js';
import {
  TimelineOrchestrationService,
  deriveSupplementalPlanningRequestIdV1,
  deriveSupplementalSelectionRequestIdV1,
} from '../../apps/desktop/src/main/timeline-orchestration-service.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
let database: Database;
let materialRepository: MaterialSelectionRepository;
let mediaRepository: MediaIndexRepository;
let timelineRepository: TimelinePlanRepository;
let materialService: MaterialSelectionService;
let orchestration: TimelineOrchestrationService;
let clockTick: number;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function policy(): TimelineDurationPolicyV1 {
  const preimage: Omit<TimelineDurationPolicyV1, 'policy_snapshot_hash'> = {
    schema_version: '1.0',
    policy_id: 'timeline-policy-v1',
    policy_version: '1.0.0',
    active_extension_mode: 'SAME_VISUAL_CONTINUITY',
    active_stitch_mode: 'WHEN_CURRENT_MATERIAL_EXHAUSTED',
    passive_extension_target_min_ms: 0,
    passive_extension_max_ms: 0,
    pause_coverage_mode: 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL',
    source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
  };
  return { ...preimage, policy_snapshot_hash: computeTimelineDurationPolicyHash(preimage) };
}

function descriptor(shotId: string): ShotSearchCandidateV1['descriptor'] {
  return {
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
  };
}

function seedCandidate(
  assetId: string,
  shotId: string,
  durationMs: number,
  semanticScore: number,
): { candidate: ShotSearchCandidateV1; sourcePath: string } {
  const bytes = `media:${assetId}:${shotId}:${durationMs}`;
  const directory = mkdtempSync(join(tmpdir(), 'timeline-e5-source-'));
  const sourcePath = join(directory, `${assetId}.mp4`);
  writeFileSync(sourcePath, bytes);
  const now = '2026-09-10T00:00:00.000Z';
  database
    .prepare(
      `INSERT INTO media_assets(
        asset_id, file_hash, media_type, status, active_revision, created_at, updated_at
      ) VALUES (?, ?, 'video', 'ACTIVE', 1, ?, ?)`,
    )
    .run(assetId, sha256(bytes), now, now);
  database
    .prepare(
      `INSERT INTO asset_revisions(
        asset_id, revision, file_hash, duration_ms, width, height, rotation, fps,
        index_signature_hash, generation_key_hash, index_signature_json, manifest_sha256,
        worker_version, state, created_at
      ) VALUES (?, 1, ?, ?, 100, 100, 0, 25, ?, ?, '{}', ?, 'worker', 'READY', ?)`,
    )
    .run(
      assetId,
      sha256(bytes),
      durationMs,
      sha256(`signature:${assetId}`),
      sha256(`generation:${assetId}`),
      sha256(`manifest:${assetId}`),
      now,
    );
  database
    .prepare(
      `INSERT INTO shots(
        shot_id, asset_id, revision, start_ms, end_ms, quality_score, analysis_status
      ) VALUES (?, ?, 1, 0, ?, 0.8, 'READY')`,
    )
    .run(shotId, assetId, durationMs);
  database
    .prepare(
      `INSERT INTO media_asset_locations(
        location_id, asset_id, source_path, normalized_path, size_bytes, mtime_ns,
        file_identity, location_status, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, '1', NULL, 'PRESENT', ?)`,
    )
    .run(`location_${assetId}`, assetId, sourcePath, sourcePath, Buffer.byteLength(bytes), now);
  return {
    candidate: {
      schema_version: '1.0',
      asset_id: assetId,
      shot_id: shotId,
      start_ms: 0,
      end_ms: durationMs,
      revision: 1,
      semantic_score: semanticScore,
      descriptor: descriptor(shotId),
    },
    sourcePath,
  };
}

function unpersistedCandidate(
  assetId: string,
  shotId: string,
  durationMs: number,
  semanticScore: number,
): ShotSearchCandidateV1 {
  return {
    schema_version: '1.0',
    asset_id: assetId,
    shot_id: shotId,
    start_ms: 0,
    end_ms: durationMs,
    revision: 1,
    semantic_score: semanticScore,
    descriptor: descriptor(shotId),
  };
}

function select(
  selectionRequestId: string,
  slotId: string,
  candidates: ShotSearchCandidateV1[],
  candidateSetId = `set_${slotId}`,
) {
  return materialService.select({
    intent: {
      schema_version: '1.0',
      selection_request_id: selectionRequestId,
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: slotId,
      material_family: 'ANIMAL',
      candidate_set_id: candidateSetId,
      candidate_set_contract_version: 'code-c-shot-search-v1',
    },
    eligibleCandidates: candidates,
  });
}

interface SlotInput {
  slotId: string;
  route: 'ANIMAL' | 'NO_MATCH';
  startMs: number;
  endMs: number;
  groupId?: string;
}

function shotPlan(slots: SlotInput[]): ConfirmedShotPlanV1 {
  const preimage: Omit<ConfirmedShotPlanV1, 'shot_plan_hash'> = {
    schema_version: '1.0',
    shot_plan_id: 'shot_plan_1',
    shot_plan_version: 1,
    source_document_id: 'document_1',
    source_document_version: 1,
    source_document_hash: sha256('document'),
    review_state: 'CONFIRMED',
    source_offset_unit: 'UNICODE_CODE_POINT',
    slots: slots.map((slot, index) => ({
      slot_id: slot.slotId,
      order_index: index,
      source_start: index * 2,
      source_end: index * 2 + 2,
      source_text: '文案',
      route: slot.route,
      visual_continuity_group_id: slot.groupId ?? `group_${slot.slotId}`,
    })),
  };
  return confirmedShotPlanV1Schema.parse({
    ...preimage,
    shot_plan_hash: computeConfirmedShotPlanHash(preimage),
  });
}

function timing(plan: ConfirmedShotPlanV1, slots: SlotInput[]): NarrationTimingSnapshotV1 {
  const preimage: Omit<NarrationTimingSnapshotV1, 'timing_snapshot_hash'> = {
    schema_version: '1.0',
    timing_snapshot_id: 'timing_1',
    timing_snapshot_version: 1,
    timing_kind: 'EXACT',
    shot_plan_id: plan.shot_plan_id,
    shot_plan_hash: plan.shot_plan_hash,
    source_document_id: plan.source_document_id,
    source_document_hash: plan.source_document_hash,
    narration_audio_id: 'audio_1',
    narration_audio_hash: sha256('audio'),
    total_duration_ms: Math.max(...slots.map((slot) => slot.endMs)),
    slot_timings: slots.map((slot) => ({
      slot_id: slot.slotId,
      start_ms: slot.startMs,
      end_ms: slot.endMs,
    })),
    pause_intervals: [],
  };
  return narrationTimingSnapshotV1Schema.parse({
    ...preimage,
    timing_snapshot_hash: computeNarrationTimingSnapshotHash(preimage),
  });
}

function planningRequest(
  planningRequestId: string,
  slots: SlotInput[],
  selections: Array<{
    selection_request_id: string;
    decision_receipt_hash: string;
    asset_id: string;
    shot_id: string;
  }>,
): TimelinePlanningRequestV1 {
  const durationPolicy = policy();
  const plan = shotPlan(slots);
  const exactTiming = timing(plan, slots);
  const preimage: Omit<TimelinePlanningRequestV1, 'timeline_request_hash'> = {
    schema_version: '1.0',
    planning_request_id: planningRequestId,
    confirmed_shot_plan: plan,
    narration_timing_snapshot: exactTiming,
    committed_selection_refs: selections,
    timeline_policy_id: durationPolicy.policy_id,
    timeline_policy_version: durationPolicy.policy_version,
    timeline_policy_snapshot_hash: durationPolicy.policy_snapshot_hash,
  };
  return timelinePlanningRequestV1Schema.parse({
    ...preimage,
    timeline_request_hash: computeTimelinePlanningRequestHash(preimage),
  });
}

function selectedRef(result: ReturnType<typeof select>) {
  if (result.status !== 'SELECTED') throw new Error('TEST_SELECTION_REQUIRED');
  return {
    selection_request_id: result.selection_request_id,
    decision_receipt_hash: result.decision_receipt_hash,
    asset_id: result.selected_asset_id!,
    shot_id: result.selected_shot_id!,
  };
}

function replaceCommittedCandidates(
  selectionRequestId: string,
  transform: (candidates: MaterialCandidateV1[]) => MaterialCandidateV1[],
): void {
  const evidence = materialRepository.getCommittedEvidence(selectionRequestId)!;
  const candidates = transform(structuredClone(evidence.request.candidates));
  const candidateSetHash = computeMaterialCandidateSetHashV1(candidates);
  const request = { ...evidence.request, candidates, candidate_set_hash: candidateSetHash };
  const receipt = { ...evidence.receipt, candidate_set_hash: candidateSetHash };
  const decisionReceiptHash = computeMaterialSelectionReceiptHashV1(receipt);
  const result = {
    ...evidence.result,
    candidate_set_hash: candidateSetHash,
    decision_receipt_hash: decisionReceiptHash,
  };
  database
    .prepare(
      `UPDATE material_selection_decisions
       SET candidate_set_hash = ?, decision_receipt_hash = ?,
           request_json = ?, decision_receipt_json = ?, result_json = ?
       WHERE selection_request_id = ?`,
    )
    .run(
      candidateSetHash,
      decisionReceiptHash,
      stableCanonicalJson(request),
      stableCanonicalJson(receipt),
      stableCanonicalJson(result),
      selectionRequestId,
    );
}

function createOrchestration(service = materialService): TimelineOrchestrationService {
  return new TimelineOrchestrationService({
    materialSelectionRepository: materialRepository,
    mediaIndexRepository: mediaRepository,
    timelinePlanRepository: timelineRepository,
    materialSelectionService: service,
  });
}

beforeEach(async () => {
  clockTick = 0;
  const directory = mkdtempSync(join(tmpdir(), 'timeline-e5-main-'));
  database = (await openDatabase({ dbPath: join(directory, 'app.db'), migrationsDirectory })).db;
  materialRepository = new MaterialSelectionRepository(database);
  mediaRepository = new MediaIndexRepository(database);
  timelineRepository = new TimelinePlanRepository(database, {
    clock: () => `2026-09-10T01:00:${String(clockTick++).padStart(2, '0')}.000Z`,
  });
  materialService = new MaterialSelectionService({
    repository: materialRepository,
    clock: () => `2026-09-10T00:00:${String(clockTick++).padStart(2, '0')}.000Z`,
  });
  orchestration = createOrchestration();
});

afterEach(() => database.close());

describe('Desktop Main Timeline orchestration', () => {
  it('plans and commits a normal initial V1 through E2, E3, and E4', () => {
    const a = seedCandidate('asset_a', 'shot_a', 1200, 0.9).candidate;
    const d1 = select('selection_a', 'slot_1', [a]);
    const request = planningRequest(
      'planning_initial',
      [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
      [selectedRef(d1)],
    );
    const committed = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: request,
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    expect(committed.version).toBe(1);
    expect(committed.duration_plan.additional_selection_requirements).toEqual([]);
    expect(committed.duration_plan.segments[0]!.selection_request_id).toBe('selection_a');
  });

  it('requires an explicit Main-only carrier for an initial Code D NO_MATCH', () => {
    const noMatch = select('selection_no_match', 'slot_1', []);
    const request = planningRequest(
      'planning_no_match',
      [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
      [],
    );
    expect(() =>
      orchestration.planAndCommitVersion({
        timeline_id: 'timeline_1',
        expected_parent_version: null,
        planning_request: request,
        duration_policy: policy(),
        committed_no_match_refs: [],
      }),
    ).toThrowError('INITIAL_NO_MATCH_EXPLICIT_CARRIER_REQUIRED');
    const committed = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: request,
      duration_policy: policy(),
      committed_no_match_refs: [
        { slot_id: 'slot_1', selection_request_id: noMatch.selection_request_id },
      ],
    });
    expect(committed.duration_plan.fallback_requirements[0]).toMatchObject({
      source: 'CODE_D_SELECTION_NO_MATCH',
      timeline_start_ms: 0,
      timeline_end_ms: 1000,
    });
  });

  it('fails closed when the exact selected candidate has no historical revision', () => {
    const a = seedCandidate('asset_a', 'shot_a', 1200, 0.9).candidate;
    const d1 = select('selection_a', 'slot_1', [a]);
    replaceCommittedCandidates('selection_a', (candidates) =>
      candidates.map((candidate) => {
        const withoutRevision = { ...candidate };
        delete withoutRevision.revision;
        return withoutRevision;
      }),
    );
    expect(() =>
      orchestration.planAndCommitVersion({
        timeline_id: 'timeline_1',
        expected_parent_version: null,
        planning_request: planningRequest(
          'planning_missing_revision',
          [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
          [selectedRef(materialRepository.get(d1.selection_request_id)!)],
        ),
        duration_policy: policy(),
        committed_no_match_refs: [],
      }),
    ).toThrowError('SELECTED_EXACT_CANDIDATE_NOT_RECOVERABLE');
  });

  it('fails closed when the selected asset/shot is not unique in the committed snapshot', () => {
    const a = seedCandidate('asset_a', 'shot_a', 1200, 0.9).candidate;
    const d1 = select('selection_a', 'slot_1', [a]);
    replaceCommittedCandidates('selection_a', (candidates) => [
      ...candidates,
      { ...candidates[0]!, semantic_rank: 2 },
    ]);
    expect(() =>
      orchestration.planAndCommitVersion({
        timeline_id: 'timeline_1',
        expected_parent_version: null,
        planning_request: planningRequest(
          'planning_duplicate_candidate',
          [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
          [selectedRef(materialRepository.get(d1.selection_request_id)!)],
        ),
        duration_policy: policy(),
        committed_no_match_refs: [],
      }),
    ).toThrowError('SELECTED_EXACT_CANDIDATE_NOT_RECOVERABLE');
  });

  it('commits a requirement-bearing V1 before any supplemental decision', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const d1 = select('selection_a', 'slot_1', [a]);
    const committed = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_initial',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    expect(committed.version).toBe(1);
    expect(committed.duration_plan.additional_selection_requirements[0]).toMatchObject({
      timeline_start_ms: 400,
      timeline_end_ms: 1000,
    });
    expect(database.prepare('SELECT count(*) FROM timeline_plan_versions').pluck().get()).toBe(1);
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(1);
  });

  it('vertical smoke A: supplemental SELECTED uses fresh history and ACTIVE_STITCH in V2', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const b = seedCandidate('asset_b', 'shot_b', 700, 0.8).candidate;
    const d1 = select('selection_a', 'slot_1', [a, b]);
    const v1 = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_initial',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    const parentBytes = stableCanonicalJson(v1);
    const v2 = orchestration.continueAdditionalSelection({
      timeline_id: 'timeline_1',
      parent_version: 1,
      requirement_id: 'additional_000001',
    });
    expect(v2.version).toBe(2);
    expect(v2.duration_plan.additional_selection_requirements).toEqual([]);
    expect(v2.duration_plan.segments.map((segment) => segment.source_shot_id)).toEqual([
      'shot_a',
      'shot_b',
    ]);
    expect(v2.duration_plan.segments[1]!.reason_codes).toContain('ACTIVE_STITCH');
    expect(v2.planning_request.committed_selection_refs.slice(0, 1)).toEqual(
      v1.planning_request.committed_selection_refs,
    );
    const supplementalId = v2.planning_request.committed_selection_refs[1]!.selection_request_id;
    const supplemental = materialRepository.getCommittedEvidence(supplementalId)!;
    expect(supplemental.request.usage_history_snapshot.selected_decisions).toContainEqual(
      expect.objectContaining({ selection_request_id: 'selection_a', shot_id: 'shot_a' }),
    );
    expect(supplemental.request.candidate_set_hash).toBe(
      materialRepository.getCommittedEvidence('selection_a')!.request.candidate_set_hash,
    );
    expect(stableCanonicalJson(supplemental.request.candidates)).toBe(
      stableCanonicalJson(
        materialRepository.getCommittedEvidence('selection_a')!.request.candidates,
      ),
    );
    expect(stableCanonicalJson(timelineRepository.getVersion('timeline_1', 1))).toBe(parentBytes);
  });

  it('vertical smoke B: supplemental NO_MATCH resolves only the exact gap in V2', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const d1 = select('selection_a', 'slot_1', [a]);
    const v1 = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_initial',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    const v2 = orchestration.continueAdditionalSelection({
      timeline_id: 'timeline_1',
      parent_version: 1,
      requirement_id: 'additional_000001',
    });
    expect(v2.duration_plan.segments[0]).toMatchObject({
      timeline_start_ms: 0,
      timeline_end_ms: 400,
      selection_request_id: 'selection_a',
    });
    expect(v2.duration_plan.fallback_requirements[0]).toMatchObject({
      requirement_id: 'additional_000001',
      source: 'CODE_D_SELECTION_NO_MATCH',
      timeline_start_ms: 400,
      timeline_end_ms: 1000,
    });
    expect(v2.planning_facts.slots[0]!.fallback).toBeNull();
    expect(v2.planning_facts.slots[0]!.selected_materials).toHaveLength(1);
    expect(timelineRepository.getVersion('timeline_1', 1)!.duration_plan).toEqual(v1.duration_plan);
  });

  it('derives stable supplemental selection and child planning identities across retries', () => {
    const selectionInput = {
      timeline_id: 'timeline_1',
      parent_version: 1,
      parent_duration_plan_hash: '1'.repeat(64),
      requirement_id: 'additional_000001',
      source_candidate_selection_request_id: 'selection_a',
      source_candidate_set_hash: '2'.repeat(64),
    };
    expect(deriveSupplementalSelectionRequestIdV1(selectionInput)).toBe(
      deriveSupplementalSelectionRequestIdV1(selectionInput),
    );
    const planningInput = {
      timeline_id: 'timeline_1',
      parent_version: 1,
      parent_commit_receipt_hash: '3'.repeat(64),
      parent_duration_plan_hash: '1'.repeat(64),
      requirement_id: 'additional_000001',
      supplemental_selection_request_id: 'selection_supplemental',
      supplemental_decision_receipt_hash: '4'.repeat(64),
    };
    expect(deriveSupplementalPlanningRequestIdV1(planningInput)).toBe(
      deriveSupplementalPlanningRequestIdV1(planningInput),
    );
    expect(
      deriveSupplementalSelectionRequestIdV1({ ...selectionInput, parent_version: 2 }),
    ).not.toBe(deriveSupplementalSelectionRequestIdV1(selectionInput));
  });

  it('recovers a D-committed/child-missing continuation and replays the committed child', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const b = seedCandidate('asset_b', 'shot_b', 700, 0.8).candidate;
    const d1 = select('selection_a', 'slot_1', [a, b]);
    const v1 = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_initial',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    const source = materialRepository.getCommittedEvidence('selection_a')!;
    const supplementalId = deriveSupplementalSelectionRequestIdV1({
      timeline_id: 'timeline_1',
      parent_version: 1,
      parent_duration_plan_hash: v1.duration_plan.duration_plan_hash,
      requirement_id: 'additional_000001',
      source_candidate_selection_request_id: 'selection_a',
      source_candidate_set_hash: source.request.candidate_set_hash,
    });
    materialService.selectFromCommittedCandidateSnapshot({
      source_selection_request_id: 'selection_a',
      selection_request_id: supplementalId,
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: 'slot_1',
      material_family: 'ANIMAL',
    });
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(2);
    const first = orchestration.continueAdditionalSelection({
      timeline_id: 'timeline_1',
      parent_version: 1,
      requirement_id: 'additional_000001',
    });
    const second = orchestration.continueAdditionalSelection({
      timeline_id: 'timeline_1',
      parent_version: 1,
      requirement_id: 'additional_000001',
    });
    expect(second).toEqual(first);
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(2);
    expect(database.prepare('SELECT count(*) FROM timeline_plan_versions').pluck().get()).toBe(2);
  });

  it('fails before D when any reused candidate is not executable and never filters it', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const missing = unpersistedCandidate('asset_missing', 'shot_missing', 700, 0.8);
    const d1 = select('selection_a', 'slot_1', [a, missing]);
    orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_initial',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    expect(() =>
      orchestration.continueAdditionalSelection({
        timeline_id: 'timeline_1',
        parent_version: 1,
        requirement_id: 'additional_000001',
      }),
    ).toThrowError('SUPPLEMENTAL_CANDIDATE_SNAPSHOT_NOT_EXECUTABLE');
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(1);
  });

  it('fails before a new D decision when the parent is stale', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const d1 = select('selection_a', 'slot_1', [a]);
    const slots: SlotInput[] = [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }];
    orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest('planning_v1', slots, [selectedRef(d1)]),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: 1,
      planning_request: planningRequest('planning_other_v2', slots, [selectedRef(d1)]),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    expect(() =>
      orchestration.continueAdditionalSelection({
        timeline_id: 'timeline_1',
        parent_version: 1,
        requirement_id: 'additional_000001',
      }),
    ).toThrowError('TIMELINE_CONTINUATION_PARENT_STALE');
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(1);
  });

  it('fails closed when D exists but its child is missing and the parent became stale', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const d1 = select('selection_a', 'slot_1', [a]);
    const slots: SlotInput[] = [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }];
    const v1 = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest('planning_v1', slots, [selectedRef(d1)]),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    const source = materialRepository.getCommittedEvidence('selection_a')!;
    const supplementalId = deriveSupplementalSelectionRequestIdV1({
      timeline_id: 'timeline_1',
      parent_version: 1,
      parent_duration_plan_hash: v1.duration_plan.duration_plan_hash,
      requirement_id: 'additional_000001',
      source_candidate_selection_request_id: 'selection_a',
      source_candidate_set_hash: source.request.candidate_set_hash,
    });
    materialService.selectFromCommittedCandidateSnapshot({
      source_selection_request_id: 'selection_a',
      selection_request_id: supplementalId,
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: 'slot_1',
      material_family: 'ANIMAL',
    });
    orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: 1,
      planning_request: planningRequest('planning_other_v2', slots, [selectedRef(d1)]),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    expect(() =>
      orchestration.continueAdditionalSelection({
        timeline_id: 'timeline_1',
        parent_version: 1,
        requirement_id: 'additional_000001',
      }),
    ).toThrowError('TIMELINE_CONTINUATION_VERSION_CONFLICT');
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(2);
  });

  it('rechecks the supplemental SELECTED media after D commits', () => {
    const a = seedCandidate('asset_a', 'shot_a', 400, 0.9).candidate;
    const b = seedCandidate('asset_b', 'shot_b', 700, 0.8);
    const d1 = select('selection_a', 'slot_1', [a, b.candidate]);
    orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_initial',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    class MutatingSelectionService extends MaterialSelectionService {
      override selectFromCommittedCandidateSnapshot(
        input: SupplementalMaterialSelectionExecutionInputV1,
      ) {
        const result = super.selectFromCommittedCandidateSnapshot(input);
        writeFileSync(b.sourcePath, 'changed-after-selection');
        return result;
      }
    }
    const mutating = new MutatingSelectionService({ repository: materialRepository });
    const service = createOrchestration(mutating);
    expect(() =>
      service.continueAdditionalSelection({
        timeline_id: 'timeline_1',
        parent_version: 1,
        requirement_id: 'additional_000001',
      }),
    ).toThrowError('SUPPLEMENTAL_SELECTED_MEDIA_NOT_EXECUTABLE');
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(2);
    expect(database.prepare('SELECT count(*) FROM timeline_plan_versions').pluck().get()).toBe(1);
  });

  it('restores initial whole-slot NO_MATCH authority from parent without caller input', () => {
    const c = seedCandidate('asset_c', 'shot_c', 400, 0.9).candidate;
    const noMatch = select('selection_initial_no_match', 'slot_no_match', []);
    const d1 = select('selection_c', 'slot_short', [c]);
    const slots: SlotInput[] = [
      { slotId: 'slot_no_match', route: 'ANIMAL', startMs: 0, endMs: 200 },
      { slotId: 'slot_short', route: 'ANIMAL', startMs: 200, endMs: 1200 },
    ];
    const v1 = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest('planning_initial', slots, [selectedRef(d1)]),
      duration_policy: policy(),
      committed_no_match_refs: [
        {
          slot_id: 'slot_no_match',
          selection_request_id: noMatch.selection_request_id,
        },
      ],
    });
    const v2 = orchestration.continueAdditionalSelection({
      timeline_id: 'timeline_1',
      parent_version: 1,
      requirement_id: 'additional_000001',
    });
    const restored = v2.planning_facts.slots.find((slot) => slot.slot_id === 'slot_no_match')!;
    expect(restored.fallback).toMatchObject({
      source: 'CODE_D_SELECTION_NO_MATCH',
      selection_request_id: 'selection_initial_no_match',
    });
    expect(v1.planning_facts.slots[0]!.fallback).toEqual(restored.fallback);
  });

  it('fails closed when parent initial NO_MATCH evidence cannot be recovered', () => {
    const c = seedCandidate('asset_c', 'shot_c', 400, 0.9).candidate;
    const noMatch = select('selection_initial_no_match', 'slot_no_match', []);
    const d1 = select('selection_c', 'slot_short', [c]);
    const slots: SlotInput[] = [
      { slotId: 'slot_no_match', route: 'ANIMAL', startMs: 0, endMs: 200 },
      { slotId: 'slot_short', route: 'ANIMAL', startMs: 200, endMs: 1200 },
    ];
    orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest('planning_initial', slots, [selectedRef(d1)]),
      duration_policy: policy(),
      committed_no_match_refs: [
        {
          slot_id: 'slot_no_match',
          selection_request_id: noMatch.selection_request_id,
        },
      ],
    });
    database
      .prepare(
        `UPDATE material_selection_decisions SET decision_receipt_hash = ?
         WHERE selection_request_id = ?`,
      )
      .run('0'.repeat(64), 'selection_initial_no_match');
    expect(() =>
      orchestration.continueAdditionalSelection({
        timeline_id: 'timeline_1',
        parent_version: 1,
        requirement_id: 'additional_000001',
      }),
    ).toThrow();
  });

  it('detects a same-slot supplemental candidate-authority fork before another D selection', () => {
    const a = seedCandidate('asset_a', 'shot_a', 300, 0.9).candidate;
    const b = seedCandidate('asset_b', 'shot_b', 200, 0.8).candidate;
    const d1 = select('selection_a', 'slot_1', [a], 'candidate_authority_a');
    const fork = select('selection_fork', 'slot_1', [b], 'candidate_authority_fork');
    orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_forked',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1), selectedRef(fork)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    const before = database
      .prepare('SELECT count(*) FROM material_selection_decisions')
      .pluck()
      .get();
    expect(() =>
      orchestration.continueAdditionalSelection({
        timeline_id: 'timeline_1',
        parent_version: 1,
        requirement_id: 'additional_000001',
      }),
    ).toThrowError('SUPPLEMENTAL_CANDIDATE_AUTHORITY_FORK');
    expect(
      database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(before);
  });

  it('keeps one candidate authority across D1, D2, and D3 continuations', () => {
    const a = seedCandidate('asset_a', 'shot_a', 300, 0.9).candidate;
    const b = seedCandidate('asset_b', 'shot_b', 300, 0.8).candidate;
    const c = seedCandidate('asset_c', 'shot_c', 400, 0.7).candidate;
    const d1 = select('selection_a', 'slot_1', [a, b, c]);
    const v1 = orchestration.planAndCommitVersion({
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: planningRequest(
        'planning_initial',
        [{ slotId: 'slot_1', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
        [selectedRef(d1)],
      ),
      duration_policy: policy(),
      committed_no_match_refs: [],
    });
    const v2 = orchestration.continueAdditionalSelection({
      timeline_id: 'timeline_1',
      parent_version: v1.version,
      requirement_id: 'additional_000001',
    });
    expect(v2.duration_plan.additional_selection_requirements).toHaveLength(1);
    const v3 = orchestration.continueAdditionalSelection({
      timeline_id: 'timeline_1',
      parent_version: v2.version,
      requirement_id: 'additional_000001',
    });
    expect(v3.duration_plan.additional_selection_requirements).toEqual([]);
    const requestIds = v3.planning_request.committed_selection_refs.map(
      (reference) => reference.selection_request_id,
    );
    const authorities = requestIds.map(
      (requestId) => materialRepository.getCommittedEvidence(requestId)!.request,
    );
    expect(new Set(authorities.map((request) => request.candidate_set_id)).size).toBe(1);
    expect(new Set(authorities.map((request) => request.candidate_set_hash)).size).toBe(1);
    expect(
      new Set(authorities.map((request) => stableCanonicalJson(request.candidates))).size,
    ).toBe(1);
  });

  it('contains no Code C query, latest-by-slot lookup, unbounded loop, or Timeline mutation logic', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../apps/desktop/src/main/timeline-orchestration-service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/query_text|ShotSearch|listSearchableShots|semantic.search/iu);
    expect(source).not.toMatch(/ORDER BY committed_at|latest.*slot|while\s*\(/iu);
    expect(source).not.toMatch(/ffmpeg|renderer|digital.human/iu);
    expect(source).not.toMatch(/createHash|JSON\.stringify|computeMaterialCandidateSetHash/iu);
    expect(source).toContain('normalizeTimelinePlanningFactsV1');
    expect(source).toContain('planTimelineDurationV1');
    expect(source).toContain('resolveTimelineSupplementalNoMatchV1');
  });
});
