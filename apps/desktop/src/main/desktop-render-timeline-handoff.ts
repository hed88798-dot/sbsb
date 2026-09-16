import {
  renderPrepareFromTimelineRequestV1Schema,
  renderTimelineSourceDtoV1Schema,
  type RenderJobDTOv1,
  type RenderPrepareFromTimelineRequestV1,
  type RenderTimelineSourceDTOv1,
} from '@app/contracts';
import type { CommittedTimelinePlanVersionV1, TimelinePlanRepository } from '@app/local-db';
import type { RenderPolicyV1 } from '@app/render';
import type { DesktopRenderOrchestratorV1 } from './desktop-render-orchestrator.js';

type TimelineSourceRepositoryV1 = Pick<
  TimelinePlanRepository,
  'listLatestCommitted' | 'getVersion'
>;

function toTimelineSourceDto(timeline: CommittedTimelinePlanVersionV1): RenderTimelineSourceDTOv1 {
  return renderTimelineSourceDtoV1Schema.parse({
    schema_version: '1.0',
    timeline_id: timeline.timeline_id,
    timeline_version: timeline.version,
    committed_at: timeline.commit_receipt.committed_at,
    total_duration_ms: timeline.planning_facts.total_duration_ms,
    segment_count: timeline.duration_plan.segments.length,
  });
}

export class DesktopRenderTimelineHandoffV1 {
  readonly #timelines: TimelineSourceRepositoryV1;
  readonly #registeredPolicy: RenderPolicyV1;
  readonly #render: Pick<DesktopRenderOrchestratorV1, 'prepare'>;

  constructor(options: {
    timelines: TimelineSourceRepositoryV1;
    registeredPolicy: RenderPolicyV1;
    render: Pick<DesktopRenderOrchestratorV1, 'prepare'>;
  }) {
    this.#timelines = options.timelines;
    this.#registeredPolicy = options.registeredPolicy;
    this.#render = options.render;
  }

  listTimelineSources(): RenderTimelineSourceDTOv1[] {
    return this.#timelines.listLatestCommitted().map(toTimelineSourceDto);
  }

  async prepareFromTimeline(
    requestValue: RenderPrepareFromTimelineRequestV1,
  ): Promise<RenderJobDTOv1> {
    const request = renderPrepareFromTimelineRequestV1Schema.parse(requestValue);
    const timeline = this.#timelines.getVersion(request.timeline_id, request.timeline_version);
    if (!timeline) throw new Error('RENDER_TIMELINE_SOURCE_NOT_FOUND');

    return this.#render.prepare({
      schema_version: '1.0',
      timeline_id: timeline.timeline_id,
      timeline_version: timeline.version,
      expected_timeline_commit_receipt_hash: timeline.commit_receipt.commit_receipt_hash,
      render_policy_id: this.#registeredPolicy.policy_id,
      render_policy_version: this.#registeredPolicy.policy_version,
      render_policy_hash: this.#registeredPolicy.policy_hash,
    });
  }
}
