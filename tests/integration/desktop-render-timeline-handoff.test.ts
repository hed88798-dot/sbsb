import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderJobDTOv1 } from '../../packages/contracts/src/index.js';
import {
  RenderPolicyRepository,
  TimelinePlanRepository,
} from '../../packages/local-db/src/index.js';
import { RENDER_POLICY_V1 } from '../../packages/render/src/index.js';
import { DesktopRenderTimelineHandoffV1 } from '../../apps/desktop/src/main/desktop-render-timeline-handoff.js';
import {
  E6TimelineFixture,
  e6DurationPolicy,
  type E6SlotInput,
} from '../helpers/e6-timeline-fixture.js';

const renderJob: RenderJobDTOv1 = {
  schema_version: '1.0',
  job_id: 'render_job_1',
  job_state: 'QUEUED',
  progress: 0,
  preparation_state: 'READY_FOR_EXECUTION',
  active_execution_state: null,
  timeline_id: 'timeline_a',
  timeline_version: 2,
  logical_render_hash: '1'.repeat(64),
  execution_snapshot_hash: '2'.repeat(64),
  cancellation_requested: false,
  error_code: null,
  error_message: null,
  created_at: '2026-09-17T00:00:00.000Z',
  started_at: null,
  finished_at: null,
  result: null,
};

describe('Desktop committed Timeline to Render product handoff', () => {
  let fixture: E6TimelineFixture;
  let timelines: TimelinePlanRepository;
  let orchestration: ReturnType<E6TimelineFixture['createOrchestration']>;
  let selectedRef: ReturnType<E6TimelineFixture['selectedRef']>;
  const slots: E6SlotInput[] = [
    { slotId: 'slot_handoff', route: 'ANIMAL', startMs: 0, endMs: 1000 },
  ];

  beforeEach(async () => {
    fixture = new E6TimelineFixture();
    await fixture.open();
    const committedAt = [
      '2026-09-17T00:00:05.000Z',
      '2026-09-17T00:00:01.000Z',
      '2026-09-17T00:00:03.000Z',
    ];
    timelines = new TimelinePlanRepository(fixture.database, {
      clock: () => committedAt.shift() ?? '2026-09-17T00:00:09.000Z',
    });
    orchestration = fixture.createOrchestration(timelines);
    const candidate = fixture.seedSyntheticCandidate('asset_handoff', 'shot_handoff', 1500, 0.9);
    const decision = fixture.select('selection_handoff', 'slot_handoff', [candidate]);
    selectedRef = fixture.selectedRef(decision);
  });

  afterEach(() => fixture.close());

  function commit(timelineId: string, planningRequestId: string, parent: number | null) {
    return orchestration.planAndCommitVersion({
      timeline_id: timelineId,
      expected_parent_version: parent,
      planning_request: fixture.planningRequest(planningRequestId, slots, [selectedRef]),
      duration_policy: e6DurationPolicy(),
      committed_no_match_refs: [],
    });
  }

  it('returns an empty committed source collection for an empty database', () => {
    expect(timelines.listLatestCommitted()).toEqual([]);
  });

  it('selects max committed version per Timeline and orders the verified rows deterministically', () => {
    commit('timeline_a', 'planning_a_v1', null);
    const a2 = commit('timeline_a', 'planning_a_v2', 1);
    const b1 = commit('timeline_b', 'planning_b_v1', null);

    const result = timelines.listLatestCommitted();
    expect(result.map(({ timeline_id, version }) => [timeline_id, version])).toEqual([
      ['timeline_b', 1],
      ['timeline_a', 2],
    ]);
    expect(a2.commit_receipt.committed_at).toBe('2026-09-17T00:00:01.000Z');
    expect(b1.commit_receipt.committed_at).toBe('2026-09-17T00:00:03.000Z');
    expect(
      result.some((timeline) => timeline.version === 1 && timeline.timeline_id === 'timeline_a'),
    ).toBe(false);
  });

  it('runs every discovered row through existing committed-row integrity validation', () => {
    commit('timeline_a', 'planning_a_v1', null);
    fixture.database
      .prepare(
        `INSERT INTO timeline_plan_versions(
          timeline_id, version, parent_version, planning_request_id, timeline_request_hash,
          shot_plan_id, shot_plan_hash, timing_snapshot_id, timing_snapshot_hash,
          planning_facts_hash, policy_id, policy_version, policy_snapshot_hash,
          duration_plan_hash, planning_request_json, planning_facts_json, duration_policy_json,
          duration_plan_json, commit_receipt_hash, commit_receipt_json, committed_at
        ) SELECT
          'timeline_corrupt', 1, NULL, 'planning_corrupt', timeline_request_hash,
          shot_plan_id, shot_plan_hash, timing_snapshot_id, timing_snapshot_hash,
          planning_facts_hash, policy_id, policy_version, policy_snapshot_hash,
          duration_plan_hash, planning_request_json, planning_facts_json, duration_policy_json,
          duration_plan_json, commit_receipt_hash, commit_receipt_json, committed_at
        FROM timeline_plan_versions WHERE timeline_id = 'timeline_a' AND version = 1`,
      )
      .run();

    expect(() => timelines.listLatestCommitted()).toThrowError(
      'TIMELINE_PLAN_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('exposes only safe source metadata and derives fresh authority at prepare time', async () => {
    commit('timeline_a', 'planning_a_v1', null);
    const committed = commit('timeline_a', 'planning_a_v2', 1);
    const registeredPolicy = new RenderPolicyRepository(fixture.database).register(
      RENDER_POLICY_V1,
    );
    const render = { prepare: vi.fn(async () => renderJob) };
    const handoff = new DesktopRenderTimelineHandoffV1({
      timelines,
      registeredPolicy,
      render,
    });
    const exactReload = vi.spyOn(timelines, 'getVersion');

    const sources = handoff.listTimelineSources();
    expect(sources).toEqual([
      {
        schema_version: '1.0',
        timeline_id: 'timeline_a',
        timeline_version: 2,
        committed_at: committed.commit_receipt.committed_at,
        total_duration_ms: 1000,
        segment_count: committed.duration_plan.segments.length,
      },
    ]);
    expect(Object.keys(sources[0]!).sort()).toEqual(
      [
        'committed_at',
        'schema_version',
        'segment_count',
        'timeline_id',
        'timeline_version',
        'total_duration_ms',
      ].sort(),
    );
    expect(JSON.stringify(sources)).not.toMatch(/(?:hash|receipt|path|policy|canonical)/iu);

    await expect(
      handoff.prepareFromTimeline({
        schema_version: '1.0',
        timeline_id: 'timeline_a',
        timeline_version: 2,
      }),
    ).resolves.toEqual(renderJob);
    expect(exactReload).toHaveBeenCalledOnce();
    expect(exactReload).toHaveBeenCalledWith('timeline_a', 2);
    expect(render.prepare).toHaveBeenCalledOnce();
    expect(render.prepare).toHaveBeenCalledWith({
      schema_version: '1.0',
      timeline_id: 'timeline_a',
      timeline_version: 2,
      expected_timeline_commit_receipt_hash: committed.commit_receipt.commit_receipt_hash,
      render_policy_id: registeredPolicy.policy_id,
      render_policy_version: registeredPolicy.policy_version,
      render_policy_hash: registeredPolicy.policy_hash,
    });
  });

  it('rejects Renderer-supplied receipt or policy authority before repository access', async () => {
    const repository = {
      listLatestCommitted: vi.fn(() => []),
      getVersion: vi.fn(),
    };
    const render = { prepare: vi.fn(async () => renderJob) };
    const handoff = new DesktopRenderTimelineHandoffV1({
      timelines: repository,
      registeredPolicy: RENDER_POLICY_V1,
      render,
    });

    await expect(
      handoff.prepareFromTimeline({
        schema_version: '1.0',
        timeline_id: 'timeline_a',
        timeline_version: 1,
        expected_timeline_commit_receipt_hash: 'a'.repeat(64),
        render_policy_hash: 'b'.repeat(64),
      } as never),
    ).rejects.toThrow();
    expect(repository.getVersion).not.toHaveBeenCalled();
    expect(render.prepare).not.toHaveBeenCalled();
  });
});
