import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  committedMaterialSelectionRefV1Schema,
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
  type ConfirmedShotPlanV1,
  type NarrationTimingSnapshotV1,
  type TimelinePlanningRequestV1,
} from '../../packages/contracts/src/index.js';
import { canonicalJson, sha256 } from '../../packages/domain-media-index/src/signature.js';
import {
  TimelinePlanRepository,
  computeTimelinePlanCommitReceiptHash,
  openDatabase,
  type TimelinePlanCommitInputV1,
} from '../../packages/local-db/src/index.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
  computeTimelineDurationPlanHash,
  computeTimelineDurationPolicyHash,
  computeTimelinePlanningFactsHash,
  computeTimelinePlanningRequestHash,
  normalizeTimelinePlanningFactsV1,
  planTimelineDurationV1,
  type ResolvedMaterialDecisionEvidenceV1,
  type TimelineDurationPolicyV1,
} from '../../packages/timeline/src/index.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
let database: Database;
let databasePath: string;
let repository: TimelinePlanRepository;
let clockTick: number;

function makePolicy(): TimelineDurationPolicyV1 {
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
  return {
    ...preimage,
    policy_snapshot_hash: computeTimelineDurationPolicyHash(preimage),
  };
}

function makePlan(requestId: string, route: 'ANIMAL' | 'NO_MATCH'): ConfirmedShotPlanV1 {
  const preimage: Omit<ConfirmedShotPlanV1, 'shot_plan_hash'> = {
    schema_version: '1.0',
    shot_plan_id: 'shot_plan_' + requestId,
    shot_plan_version: 1,
    source_document_id: 'document_' + requestId,
    source_document_version: 1,
    source_document_hash: sha256('document:' + requestId),
    review_state: 'CONFIRMED',
    source_offset_unit: 'UNICODE_CODE_POINT',
    slots: [
      {
        slot_id: 'slot_1',
        order_index: 0,
        source_start: 0,
        source_end: 2,
        source_text: '牛羊',
        route,
        visual_continuity_group_id: 'visual_group_1',
      },
    ],
  };
  return confirmedShotPlanV1Schema.parse({
    ...preimage,
    shot_plan_hash: computeConfirmedShotPlanHash(preimage),
  });
}

function makeTiming(plan: ConfirmedShotPlanV1): NarrationTimingSnapshotV1 {
  const preimage: Omit<NarrationTimingSnapshotV1, 'timing_snapshot_hash'> = {
    schema_version: '1.0',
    timing_snapshot_id: 'timing_' + plan.shot_plan_id,
    timing_snapshot_version: 1,
    timing_kind: 'EXACT',
    shot_plan_id: plan.shot_plan_id,
    shot_plan_hash: plan.shot_plan_hash,
    source_document_id: plan.source_document_id,
    source_document_hash: plan.source_document_hash,
    narration_audio_id: 'audio_' + plan.shot_plan_id,
    narration_audio_hash: sha256('audio:' + plan.shot_plan_id),
    total_duration_ms: 1000,
    slot_timings: [{ slot_id: 'slot_1', start_ms: 0, end_ms: 1000 }],
    pause_intervals: [],
  };
  return narrationTimingSnapshotV1Schema.parse({
    ...preimage,
    timing_snapshot_hash: computeNarrationTimingSnapshotHash(preimage),
  });
}

function makeRequest(
  requestId: string,
  plan: ConfirmedShotPlanV1,
  timing: NarrationTimingSnapshotV1,
  policy: TimelineDurationPolicyV1,
  hasSelection: boolean,
): TimelinePlanningRequestV1 {
  const receiptHash = sha256('receipt:' + requestId);
  const preimage: Omit<TimelinePlanningRequestV1, 'timeline_request_hash'> = {
    schema_version: '1.0',
    planning_request_id: requestId,
    confirmed_shot_plan: plan,
    narration_timing_snapshot: timing,
    committed_selection_refs: hasSelection
      ? [
          committedMaterialSelectionRefV1Schema.parse({
            selection_request_id: 'selection_' + requestId,
            decision_receipt_hash: receiptHash,
            asset_id: 'asset_' + requestId,
            shot_id: 'shot_' + requestId,
          }),
        ]
      : [],
    timeline_policy_id: policy.policy_id,
    timeline_policy_version: policy.policy_version,
    timeline_policy_snapshot_hash: policy.policy_snapshot_hash,
  };
  return timelinePlanningRequestV1Schema.parse({
    ...preimage,
    timeline_request_hash: computeTimelinePlanningRequestHash(preimage),
  });
}

function makeCommitInput(
  requestId: string,
  expectedParentVersion: number | null,
  variant: 'REAL' | 'UPSTREAM_FALLBACK' | 'ADDITIONAL' = 'REAL',
  timelineId = 'timeline_1',
): TimelinePlanCommitInputV1 {
  const policy = makePolicy();
  const plan = makePlan(requestId, variant === 'UPSTREAM_FALLBACK' ? 'NO_MATCH' : 'ANIMAL');
  const timing = makeTiming(plan);
  const hasSelection = variant !== 'UPSTREAM_FALLBACK';
  const request = makeRequest(requestId, plan, timing, policy, hasSelection);
  const resolved: ResolvedMaterialDecisionEvidenceV1[] = hasSelection
    ? [
        {
          selection_request_id: 'selection_' + requestId,
          decision_receipt_hash: sha256('receipt:' + requestId),
          batch_id: 'batch_1',
          video_id: 'video_1',
          slot_id: 'slot_1',
          status: 'SELECTED',
          asset_id: 'asset_' + requestId,
          shot_id: 'shot_' + requestId,
          revision: 1,
          shot_start_ms: 100,
          shot_end_ms: variant === 'ADDITIONAL' ? 500 : 1500,
        },
      ]
    : [];
  const planningFacts = normalizeTimelinePlanningFactsV1({
    request,
    resolved_material_decisions: resolved,
  });
  const durationPlan = planTimelineDurationV1({
    planning_facts: planningFacts,
    duration_policy: policy,
  });
  return {
    timeline_id: timelineId,
    expected_parent_version: expectedParentVersion,
    planning_request: request,
    planning_facts: planningFacts,
    duration_policy: policy,
    duration_plan: durationPlan,
  };
}

function rowCount(): number {
  return database.prepare('SELECT count(*) FROM timeline_plan_versions').pluck().get() as number;
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function storedJson(timelineId: string, version: number): Record<string, string> {
  return database
    .prepare(
      'SELECT planning_request_json, planning_facts_json, duration_policy_json, ' +
        'duration_plan_json, commit_receipt_json FROM timeline_plan_versions ' +
        'WHERE timeline_id = ? AND version = ?',
    )
    .get(timelineId, version) as Record<string, string>;
}

beforeEach(async () => {
  clockTick = 0;
  const directory = mkdtempSync(join(tmpdir(), 'timeline-plan-'));
  databasePath = join(directory, 'app.db');
  database = (await openDatabase({ dbPath: databasePath, migrationsDirectory })).db;
  repository = new TimelinePlanRepository(database, {
    clock: () => '2026-09-10T00:00:' + String(clockTick++).padStart(2, '0') + '.000Z',
  });
});

afterEach(() => {
  if (database.open) database.close();
});

function insertClonedLineage(
  timelineId: string,
  version: number,
  parentVersion: number | null,
  planningRequestId: string,
): void {
  const sql =
    'INSERT INTO timeline_plan_versions(' +
    'timeline_id, version, parent_version, planning_request_id, timeline_request_hash, ' +
    'shot_plan_id, shot_plan_hash, timing_snapshot_id, timing_snapshot_hash, ' +
    'planning_facts_hash, policy_id, policy_version, policy_snapshot_hash, duration_plan_hash, ' +
    'planning_request_json, planning_facts_json, duration_policy_json, duration_plan_json, ' +
    'commit_receipt_hash, commit_receipt_json, committed_at' +
    ') SELECT ?, ?, ?, ?, timeline_request_hash, shot_plan_id, shot_plan_hash, ' +
    'timing_snapshot_id, timing_snapshot_hash, planning_facts_hash, policy_id, policy_version, ' +
    'policy_snapshot_hash, duration_plan_hash, planning_request_json, planning_facts_json, ' +
    'duration_policy_json, duration_plan_json, commit_receipt_hash, commit_receipt_json, ' +
    'committed_at FROM timeline_plan_versions LIMIT 1';
  database.prepare(sql).run(timelineId, version, parentVersion, planningRequestId);
}

describe('Code E E4 migration and database immutability', () => {
  it('keeps frozen E1, E2 and E3 semantic bytes unchanged', () => {
    const root = resolve(import.meta.dirname, '../..');
    const expected = new Map([
      [
        'packages/contracts/src/timeline-planning.ts',
        'd3524eee97072864bdda3e787dd2e36ffe2aed239e2d45e4fc276db5d241f938',
      ],
      [
        'schemas/timeline/v1/committed-material-selection-ref.schema.json',
        'f0db8478176534d93a9283cd0be0b8cbccdf711c8cfe4e83cd15426f1e28d8df',
      ],
      [
        'schemas/timeline/v1/confirmed-shot-plan.schema.json',
        'cc38118535eccb15d4c9c267cee538906f8344ef6977b4c47a75dcfea5d396ee',
      ],
      [
        'schemas/timeline/v1/narration-timing-snapshot.schema.json',
        '963ed402b3251e54a1e080adbeb0241868f3696664ba0209a8d76f69e8d29815',
      ],
      [
        'schemas/timeline/v1/timeline-planning-request.schema.json',
        'd1d6a95a0a022b191d5e2c236cdb41f417989955a8144ac02ab812d09a87a226',
      ],
      [
        'packages/timeline/src/hash.ts',
        '248f19595fafcc85bf0e291e6a823fc082cbf9861d569799785aed49c3e16416',
      ],
      [
        'packages/timeline/src/planner.ts',
        '7520cb2d8e4ece78dcd4d91aba0860a2f3eaf2efee33c1a16f051250192855da',
      ],
      [
        'packages/timeline/src/duration-plan.ts',
        'f03ede92aa8f0d323cf13f3f896b5b1bcba231b8bbfcb05c24173c070c57aa18',
      ],
      [
        'packages/timeline/src/index.ts',
        '1c74e229529150527a4f7240a7bbc0efc5a05d6e83a9916a19e052ebba32a868',
      ],
      [
        'tests/unit/timeline-duration-plan.test.ts',
        '4a4f7facf7e82d76671ab5f9af6cd733de137198c9506b988d1e1c9fa2896966',
      ],
    ]);
    for (const [path, digest] of expected) {
      expect(fileSha256(resolve(root, path))).toBe(digest);
    }
  });

  it('preserves migration 004 objects after all current migrations', () => {
    const objects = database
      .prepare(
        "SELECT type, name FROM sqlite_master WHERE name LIKE 'timeline_plan_versions%' ORDER BY type, name",
      )
      .all() as Array<{ type: string; name: string }>;
    expect(objects).toEqual(
      expect.arrayContaining([
        { type: 'table', name: 'timeline_plan_versions' },
        { type: 'trigger', name: 'timeline_plan_versions_reject_update' },
        { type: 'trigger', name: 'timeline_plan_versions_reject_delete' },
      ]),
    );
    expect(database.prepare('SELECT max(version) FROM schema_migrations').pluck().get()).toBe(7);
  });

  it('introduces no planning_request_hash field or column', () => {
    const columns = database.prepare('PRAGMA table_info(timeline_plan_versions)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toContain('timeline_request_hash');
    expect(columns.map((column) => column.name)).not.toContain('planning_request_hash');
    const repositorySource = readFileSync(
      resolve(import.meta.dirname, '../../packages/local-db/src/timeline-plan-repository.ts'),
      'utf8',
    );
    expect(repositorySource).not.toContain('planning_request_hash');
    expect(repositorySource).not.toContain('normalizeTimelinePlanningFactsV1');
    expect(repositorySource).not.toContain('planTimelineDurationV1');
    expect(repositorySource).not.toContain('JSON.stringify');
  });

  it('rejects version below one at database level', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    expect(() => insertClonedLineage('timeline_bad', 0, null, 'request_bad_zero')).toThrow();
  });

  it('rejects version one with a non-null parent at database level', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    expect(() => insertClonedLineage('timeline_bad', 1, 7, 'request_bad_parent')).toThrow();
  });

  it('rejects later version whose parent is not version minus one', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    expect(() => insertClonedLineage('timeline_bad', 3, 1, 'request_bad_lineage')).toThrow();
  });

  it('rejects direct SQL UPDATE of committed history', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    expect(() =>
      database
        .prepare('UPDATE timeline_plan_versions SET committed_at = ? WHERE planning_request_id = ?')
        .run('2030-01-01T00:00:00.000Z', 'request_v1'),
    ).toThrowError('TIMELINE_PLAN_VERSIONS_APPEND_ONLY');
  });

  it('rejects direct SQL DELETE of committed history', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    expect(() =>
      database
        .prepare('DELETE FROM timeline_plan_versions WHERE planning_request_id = ?')
        .run('request_v1'),
    ).toThrowError('TIMELINE_PLAN_VERSIONS_APPEND_ONLY');
  });
});

describe('Code E E4 versioning and idempotency', () => {
  it('commits the first version with null parent', () => {
    const committed = repository.commitVersion(makeCommitInput('request_v1', null));
    expect(committed).toMatchObject({
      timeline_id: 'timeline_1',
      version: 1,
      parent_version: null,
    });
    expect(rowCount()).toBe(1);
  });

  it('rejects a non-null expected parent for an empty timeline', () => {
    expect(() => repository.commitVersion(makeCommitInput('request_v1', 1))).toThrowError(
      'TIMELINE_PLAN_VERSION_CONFLICT',
    );
    expect(rowCount()).toBe(0);
  });

  it('returns the exact committed version, timestamp and receipt on exact retry', () => {
    const input = makeCommitInput('request_v1', null);
    const first = repository.commitVersion(input);
    const retried = repository.commitVersion(input);
    expect(retried).toEqual(first);
    expect(retried.commit_receipt.committed_at).toBe('2026-09-10T00:00:00.000Z');
    expect(rowCount()).toBe(1);
  });

  it('treats property insertion order as irrelevant canonical replay input', () => {
    const input = makeCommitInput('request_v1', null);
    const first = repository.commitVersion(input);
    const reversed = {
      ...input,
      planning_request: Object.fromEntries(
        Object.entries(input.planning_request).reverse(),
      ) as unknown as TimelinePlanningRequestV1,
      planning_facts: Object.fromEntries(
        Object.entries(input.planning_facts).reverse(),
      ) as unknown as TimelinePlanCommitInputV1['planning_facts'],
      duration_policy: Object.fromEntries(
        Object.entries(input.duration_policy).reverse(),
      ) as unknown as TimelineDurationPolicyV1,
      duration_plan: Object.fromEntries(
        Object.entries(input.duration_plan).reverse(),
      ) as unknown as TimelinePlanCommitInputV1['duration_plan'],
    };
    expect(repository.commitVersion(reversed)).toEqual(first);
    expect(rowCount()).toBe(1);
  });

  it('checks idempotent replay before stale expected parent validation', () => {
    const input = makeCommitInput('request_v1', null);
    const first = repository.commitVersion(input);
    const replay = repository.commitVersion({ ...input, expected_parent_version: 999 });
    expect(replay).toEqual(first);
    expect(rowCount()).toBe(1);
  });

  it('accepts zero expected parent on an already committed exact replay', () => {
    const input = makeCommitInput('request_v1', null);
    const first = repository.commitVersion(input);
    expect(repository.commitVersion({ ...input, expected_parent_version: 0 })).toEqual(first);
  });

  it('rejects the same planning request identity with a different timeline identity', () => {
    const input = makeCommitInput('request_v1', null);
    repository.commitVersion(input);
    expect(() =>
      repository.commitVersion({ ...input, timeline_id: 'timeline_other' }),
    ).toThrowError('TIMELINE_PLAN_IDEMPOTENCY_CONFLICT');
  });

  it('rejects the same planning request identity with changed immutable bytes', () => {
    const input = makeCommitInput('request_v1', null);
    repository.commitVersion(input);
    const changed = structuredClone(input);
    changed.duration_plan.duration_plan_hash = 'f'.repeat(64);
    expect(() => repository.commitVersion(changed)).toThrowError(
      'TIMELINE_PLAN_IDEMPOTENCY_CONFLICT',
    );
    expect(rowCount()).toBe(1);
  });

  it('creates the next version only with the exact latest parent', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    const second = repository.commitVersion(makeCommitInput('request_v2', 1));
    expect(second).toMatchObject({ version: 2, parent_version: 1 });
    expect(repository.listVersions('timeline_1').map((entry) => entry.version)).toEqual([1, 2]);
  });

  it('rejects a new request based on a stale parent', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    repository.commitVersion(makeCommitInput('request_v2', 1));
    expect(() => repository.commitVersion(makeCommitInput('request_v3', 1))).toThrowError(
      'TIMELINE_PLAN_VERSION_CONFLICT',
    );
    expect(rowCount()).toBe(2);
  });

  it('returns historical V1 when it is retried after newer versions exist', () => {
    const firstInput = makeCommitInput('request_v1', null);
    const first = repository.commitVersion(firstInput);
    repository.commitVersion(makeCommitInput('request_v2', 1));
    repository.commitVersion(makeCommitInput('request_v3', 2));
    repository.commitVersion(makeCommitInput('request_v4', 3));
    const replay = repository.commitVersion({ ...firstInput, expected_parent_version: 2 });
    expect(replay).toEqual(first);
    expect(replay.version).toBe(1);
    expect(repository.getLatest('timeline_1')!.version).toBe(4);
    expect(rowCount()).toBe(4);
  });

  it('allows exactly one competing new request from the same parent', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    const candidates = [
      makeCommitInput('request_compete_a', 1),
      makeCommitInput('request_compete_b', 1),
    ];
    const results = candidates.map((input) => {
      try {
        return { status: 'COMMITTED' as const, value: repository.commitVersion(input), input };
      } catch (error) {
        return { status: 'CONFLICT' as const, error, input };
      }
    });
    expect(results.filter((result) => result.status === 'COMMITTED')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'CONFLICT')).toHaveLength(1);
    const winner = results.find((result) => result.status === 'COMMITTED')!;
    expect(repository.commitVersion(winner.input)).toEqual(winner.value);
    expect(rowCount()).toBe(2);
  });

  it('preserves V1 bytes after later versions commit', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    const before = storedJson('timeline_1', 1);
    repository.commitVersion(makeCommitInput('request_v2', 1));
    expect(storedJson('timeline_1', 1)).toEqual(before);
  });
});

describe('Code E E4 immutable artifact chain and recovery', () => {
  it('recomputes and rejects an invalid timeline_request_hash before commit', () => {
    const input = makeCommitInput('request_v1', null);
    input.planning_request.timeline_request_hash = '0'.repeat(64);
    expect(() => repository.commitVersion(input)).toThrowError('TIMELINE_REQUEST_HASH_MISMATCH');
    expect(rowCount()).toBe(0);
  });

  it('rejects a planning request to facts binding mismatch', () => {
    const input = makeCommitInput('request_v1', null);
    input.planning_facts = {
      ...input.planning_facts,
      planning_request_id: 'different_request',
    };
    input.planning_facts.planning_facts_hash = computeTimelinePlanningFactsHash(
      input.planning_facts,
    );
    expect(() => repository.commitVersion(input)).toThrowError(
      'TIMELINE_PLAN_IMMUTABLE_INPUT_CHAIN_MISMATCH',
    );
    expect(rowCount()).toBe(0);
  });

  it('rejects a facts to policy binding mismatch', () => {
    const input = makeCommitInput('request_v1', null);
    const changedPreimage = {
      ...input.duration_policy,
      policy_id: 'different-policy',
    };
    input.duration_policy = {
      ...changedPreimage,
      policy_snapshot_hash: computeTimelineDurationPolicyHash(changedPreimage),
    };
    expect(() => repository.commitVersion(input)).toThrowError(
      'TIMELINE_PLAN_IMMUTABLE_INPUT_CHAIN_MISMATCH',
    );
    expect(rowCount()).toBe(0);
  });

  it('rejects a policy to duration plan binding mismatch', () => {
    const input = makeCommitInput('request_v1', null);
    input.duration_plan = {
      ...input.duration_plan,
      policy_version: 'different-version',
    };
    input.duration_plan.duration_plan_hash = computeTimelineDurationPlanHash(input.duration_plan);
    expect(() => repository.commitVersion(input)).toThrowError(
      'TIMELINE_PLAN_IMMUTABLE_INPUT_CHAIN_MISMATCH',
    );
    expect(rowCount()).toBe(0);
  });

  it('rejects an invalid duration_plan_hash', () => {
    const input = makeCommitInput('request_v1', null);
    input.duration_plan.duration_plan_hash = 'f'.repeat(64);
    expect(() => repository.commitVersion(input)).toThrowError(
      'TIMELINE_DURATION_PLAN_HASH_MISMATCH',
    );
    expect(rowCount()).toBe(0);
  });

  it('computes a self-excluding canonical commit receipt hash', () => {
    const receipt = repository.commitVersion(makeCommitInput('request_v1', null)).commit_receipt;
    expect(computeTimelinePlanCommitReceiptHash(receipt)).toBe(receipt.commit_receipt_hash);
    expect(
      computeTimelinePlanCommitReceiptHash({
        ...receipt,
        commit_receipt_hash: 'f'.repeat(64),
      }),
    ).toBe(receipt.commit_receipt_hash);
  });

  it('persists every JSON artifact as exact canonical bytes', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    const jsonColumns = storedJson('timeline_1', 1);
    for (const bytes of Object.values(jsonColumns)) {
      expect(canonicalJson(JSON.parse(bytes) as unknown)).toBe(bytes);
    }
  });

  it('restores the exact committed artifacts after database restart', async () => {
    const committed = repository.commitVersion(makeCommitInput('request_v1', null));
    database.close();
    database = (await openDatabase({ dbPath: databasePath, migrationsDirectory })).db;
    repository = new TimelinePlanRepository(database, {
      clock: () => '2030-01-01T00:00:00.000Z',
    });
    expect(repository.getVersion('timeline_1', 1)).toEqual(committed);
    expect(repository.getLatest('timeline_1')).toEqual(committed);
    expect(repository.getByPlanningRequestId('request_v1')).toEqual(committed);
    expect(repository.listVersions('timeline_1')).toEqual([committed]);
  });

  it('recomputes timeline_request_hash during recovery', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    database.exec('DROP TRIGGER timeline_plan_versions_reject_update');
    const row = database
      .prepare(
        'SELECT planning_request_json FROM timeline_plan_versions WHERE planning_request_id = ?',
      )
      .get('request_v1') as { planning_request_json: string };
    const request = JSON.parse(row.planning_request_json) as TimelinePlanningRequestV1;
    request.timeline_request_hash = '0'.repeat(64);
    database
      .prepare(
        'UPDATE timeline_plan_versions SET planning_request_json = ? WHERE planning_request_id = ?',
      )
      .run(canonicalJson(request), 'request_v1');
    expect(() => repository.getByPlanningRequestId('request_v1')).toThrowError(
      'TIMELINE_REQUEST_HASH_MISMATCH',
    );
  });

  it('fails closed when persisted canonical JSON bytes are corrupted', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    database.exec('DROP TRIGGER timeline_plan_versions_reject_update');
    database
      .prepare(
        'UPDATE timeline_plan_versions SET duration_policy_json = ? WHERE planning_request_id = ?',
      )
      .run('{broken', 'request_v1');
    expect(() => repository.getVersion('timeline_1', 1)).toThrowError(
      'TIMELINE_PLAN_STORED_CANONICAL_JSON_INVALID',
    );
  });

  it('fails closed when canonical stored bytes no longer match scalar identity columns', () => {
    repository.commitVersion(makeCommitInput('request_v1', null));
    database.exec('DROP TRIGGER timeline_plan_versions_reject_update');
    database
      .prepare(
        'UPDATE timeline_plan_versions SET planning_facts_hash = ? WHERE planning_request_id = ?',
      )
      .run('f'.repeat(64), 'request_v1');
    expect(() => repository.getLatest('timeline_1')).toThrowError(
      'TIMELINE_PLAN_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('leaves no partial row after a failed commit transaction', () => {
    const input = makeCommitInput('request_v1', null);
    input.duration_plan.duration_plan_hash = 'f'.repeat(64);
    expect(() => repository.commitVersion(input)).toThrow();
    expect(rowCount()).toBe(0);
  });

  it('persists a plan containing FALLBACK_REQUIRED as a normal version', () => {
    const committed = repository.commitVersion(
      makeCommitInput('request_fallback', null, 'UPSTREAM_FALLBACK'),
    );
    expect(committed.duration_plan.fallback_requirements).toHaveLength(1);
    expect(committed.version).toBe(1);
  });

  it('persists a plan containing ADDITIONAL_SELECTION_REQUIRED as a normal version', () => {
    const committed = repository.commitVersion(
      makeCommitInput('request_additional', null, 'ADDITIONAL'),
    );
    expect(committed.duration_plan.additional_selection_requirements).toHaveLength(1);
    expect(committed.version).toBe(1);
  });

  it('stores no duplicate raw resolved Code D evidence artifact', () => {
    const columns = database.prepare('PRAGMA table_info(timeline_plan_versions)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).not.toContain('resolved_material_decisions_json');
  });
});
