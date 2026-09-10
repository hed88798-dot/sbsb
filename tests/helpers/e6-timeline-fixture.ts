import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
  type ConfirmedShotPlanV1,
  type NarrationTimingSnapshotV1,
  type ShotSearchCandidateV1,
  type TimelinePlanningRequestV1,
} from '../../packages/contracts/src/index.js';
import {
  MaterialSelectionRepository,
  MediaIndexRepository,
  TimelinePlanRepository,
  openDatabase,
  type CommittedTimelinePlanVersionV1,
  type TimelinePlanCommitInputV1,
} from '../../packages/local-db/src/index.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
  computeTimelineDurationPolicyHash,
  computeTimelinePlanningRequestHash,
  type TimelineDurationPolicyV1,
} from '../../packages/timeline/src/index.js';
import { MaterialSelectionService } from '../../apps/desktop/src/main/material-selection-service.js';
import { TimelineOrchestrationService } from '../../apps/desktop/src/main/timeline-orchestration-service.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');

export interface E6SlotInput {
  slotId: string;
  route: 'ANIMAL' | 'NO_MATCH';
  startMs: number;
  endMs: number;
  groupId?: string;
}

export function e6Sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function descriptor(shotId: string): ShotSearchCandidateV1['descriptor'] {
  return {
    schema_version: '1.0',
    shot_id: shotId,
    species: ['pig'],
    scene: 'farm',
    action: ['drinking'],
    health_state: 'unknown',
    people_present: false,
    product_present: false,
    shot_type: 'unknown',
    description: 'authorized material fixture',
    quality: { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 },
    embedding_ref: `embedding_${shotId}`,
    industry_metadata: {},
    confidence: {},
    provenance: { source: 'frozen-code-c-evidence' },
    evidence: {},
  };
}

function shotPlan(slots: readonly E6SlotInput[]): ConfirmedShotPlanV1 {
  const preimage: Omit<ConfirmedShotPlanV1, 'shot_plan_hash'> = {
    schema_version: '1.0',
    shot_plan_id: 'e6_shot_plan',
    shot_plan_version: 1,
    source_document_id: 'e6_document',
    source_document_version: 1,
    source_document_hash: e6Sha256('e6-document'),
    review_state: 'CONFIRMED',
    source_offset_unit: 'UNICODE_CODE_POINT',
    slots: slots.map((slot, orderIndex) => ({
      slot_id: slot.slotId,
      order_index: orderIndex,
      source_start: orderIndex * 2,
      source_end: orderIndex * 2 + 2,
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

function narrationTiming(
  plan: ConfirmedShotPlanV1,
  slots: readonly E6SlotInput[],
): NarrationTimingSnapshotV1 {
  const preimage: Omit<NarrationTimingSnapshotV1, 'timing_snapshot_hash'> = {
    schema_version: '1.0',
    timing_snapshot_id: 'e6_timing',
    timing_snapshot_version: 1,
    timing_kind: 'EXACT',
    shot_plan_id: plan.shot_plan_id,
    shot_plan_hash: plan.shot_plan_hash,
    source_document_id: plan.source_document_id,
    source_document_hash: plan.source_document_hash,
    narration_audio_id: 'e6_audio',
    narration_audio_hash: e6Sha256('e6-audio'),
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

export function e6DurationPolicy(): TimelineDurationPolicyV1 {
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

export class CrashBeforeTimelineCommitRepository extends TimelinePlanRepository {
  captureNextCommit = false;
  capturedInput: TimelinePlanCommitInputV1 | null = null;

  override commitVersion(input: TimelinePlanCommitInputV1): CommittedTimelinePlanVersionV1 {
    if (this.captureNextCommit) {
      this.captureNextCommit = false;
      this.capturedInput = structuredClone(input);
      throw new Error('SIMULATED_CRASH_BEFORE_E4_COMMIT');
    }
    return super.commitVersion(input);
  }
}

export class E6TimelineFixture {
  readonly directory = mkdtempSync(join(tmpdir(), 'timeline-e6-closeout-'));
  readonly dbPath = join(this.directory, 'app.db');
  database!: Database;
  materialRepository!: MaterialSelectionRepository;
  mediaRepository!: MediaIndexRepository;
  timelineRepository!: TimelinePlanRepository;
  materialService!: MaterialSelectionService;
  orchestration!: TimelineOrchestrationService;
  #clockTick = 0;

  async open(): Promise<void> {
    this.database = (await openDatabase({ dbPath: this.dbPath, migrationsDirectory })).db;
    this.#wire();
  }

  async restart(): Promise<void> {
    this.database.close();
    await this.open();
  }

  close(): void {
    this.database.close();
  }

  createOrchestration(
    timelineRepository: TimelinePlanRepository = this.timelineRepository,
  ): TimelineOrchestrationService {
    return new TimelineOrchestrationService({
      materialSelectionRepository: this.materialRepository,
      mediaIndexRepository: this.mediaRepository,
      timelinePlanRepository: timelineRepository,
      materialSelectionService: this.materialService,
    });
  }

  createCrashRepository(): CrashBeforeTimelineCommitRepository {
    return new CrashBeforeTimelineCommitRepository(this.database, {
      clock: () => this.#nextTimelineClock(),
    });
  }

  seedSyntheticCandidate(
    assetId: string,
    shotId: string,
    durationMs: number,
    semanticScore: number,
  ): ShotSearchCandidateV1 {
    const bytes = `e6-media:${assetId}:${shotId}:${durationMs}`;
    const sourcePath = join(this.directory, `${assetId}.mp4`);
    writeFileSync(sourcePath, bytes);
    this.registerHistoricalMedia({
      assetId,
      revision: 1,
      shotId,
      startMs: 0,
      endMs: durationMs,
      sourcePath,
      expectedFileHash: e6Sha256(bytes),
    });
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

  registerHistoricalMedia(input: {
    assetId: string;
    revision: number;
    shotId: string;
    startMs: number;
    endMs: number;
    sourcePath: string;
    expectedFileHash: string;
  }): void {
    const actualHash = e6Sha256(readFileSync(input.sourcePath));
    if (actualHash !== input.expectedFileHash) throw new Error('E6_REAL_FILE_HASH_MISMATCH');
    const now = '2026-09-10T00:00:00.000Z';
    this.database
      .prepare(
        `INSERT INTO media_assets(
          asset_id, file_hash, media_type, status, active_revision, created_at, updated_at
        ) VALUES (?, ?, 'video', 'ACTIVE', ?, ?, ?)`,
      )
      .run(input.assetId, input.expectedFileHash, input.revision, now, now);
    this.database
      .prepare(
        `INSERT INTO asset_revisions(
          asset_id, revision, file_hash, duration_ms, width, height, rotation, fps,
          index_signature_hash, generation_key_hash, index_signature_json, manifest_sha256,
          worker_version, state, created_at
        ) VALUES (?, ?, ?, ?, 100, 100, 0, 25, ?, ?, '{}', ?, 'frozen-evidence', 'READY', ?)`,
      )
      .run(
        input.assetId,
        input.revision,
        input.expectedFileHash,
        input.endMs,
        e6Sha256(`signature:${input.assetId}:${input.revision}`),
        e6Sha256(`generation:${input.assetId}:${input.revision}`),
        e6Sha256(`manifest:${input.assetId}:${input.revision}`),
        now,
      );
    this.database
      .prepare(
        `INSERT INTO shots(
          shot_id, asset_id, revision, start_ms, end_ms, quality_score, analysis_status
        ) VALUES (?, ?, ?, ?, ?, 0.8, 'READY')`,
      )
      .run(input.shotId, input.assetId, input.revision, input.startMs, input.endMs);
    this.database
      .prepare(
        `INSERT INTO media_asset_locations(
          location_id, asset_id, source_path, normalized_path, size_bytes, mtime_ns,
          file_identity, location_status, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, '1', NULL, 'PRESENT', ?)`,
      )
      .run(
        `location_${input.assetId}`,
        input.assetId,
        input.sourcePath,
        input.sourcePath,
        readFileSync(input.sourcePath).byteLength,
        now,
      );
  }

  select(
    selectionRequestId: string,
    slotId: string,
    candidates: readonly ShotSearchCandidateV1[],
    candidateSetId = `e6_set_${slotId}`,
  ) {
    return this.materialService.select({
      intent: {
        schema_version: '1.0',
        selection_request_id: selectionRequestId,
        batch_id: 'e6_batch',
        video_id: 'e6_video',
        slot_id: slotId,
        material_family: 'ANIMAL',
        candidate_set_id: candidateSetId,
        candidate_set_contract_version: 'code-c-shot-search-v1',
      },
      eligibleCandidates: candidates,
    });
  }

  planningRequest(
    planningRequestId: string,
    slots: readonly E6SlotInput[],
    selections: Array<{
      selection_request_id: string;
      decision_receipt_hash: string;
      asset_id: string;
      shot_id: string;
    }>,
  ): TimelinePlanningRequestV1 {
    const durationPolicy = e6DurationPolicy();
    const plan = shotPlan(slots);
    const timing = narrationTiming(plan, slots);
    const preimage: Omit<TimelinePlanningRequestV1, 'timeline_request_hash'> = {
      schema_version: '1.0',
      planning_request_id: planningRequestId,
      confirmed_shot_plan: plan,
      narration_timing_snapshot: timing,
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

  selectedRef(result: ReturnType<E6TimelineFixture['select']>) {
    if (result.status !== 'SELECTED') throw new Error('E6_SELECTED_DECISION_REQUIRED');
    return {
      selection_request_id: result.selection_request_id,
      decision_receipt_hash: result.decision_receipt_hash,
      asset_id: result.selected_asset_id!,
      shot_id: result.selected_shot_id!,
    };
  }

  #wire(): void {
    this.materialRepository = new MaterialSelectionRepository(this.database);
    this.mediaRepository = new MediaIndexRepository(this.database);
    this.timelineRepository = new TimelinePlanRepository(this.database, {
      clock: () => this.#nextTimelineClock(),
    });
    this.materialService = new MaterialSelectionService({
      repository: this.materialRepository,
      clock: () => this.#nextDecisionClock(),
    });
    this.orchestration = this.createOrchestration();
  }

  #nextDecisionClock(): string {
    return `2026-09-10T00:00:${String(this.#clockTick++).padStart(2, '0')}.000Z`;
  }

  #nextTimelineClock(): string {
    return `2026-09-10T01:00:${String(this.#clockTick++).padStart(2, '0')}.000Z`;
  }
}
