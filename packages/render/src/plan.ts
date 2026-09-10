import {
  logicalRenderPlanV1Schema,
  renderExecutionSnapshotV1Schema,
  type LogicalRenderPlanV1,
  type NarrationAudioExecutionRefV1,
  type RenderExecutionSnapshotV1,
  type RenderPolicyV1,
  type RenderRuntimeIdentityV1,
  type ResolvedRenderSourceV1,
} from './contracts.js';
import { mapTimelineIntervalsToFramesV1 } from './frame-mapping.js';
import { computeExecutionSnapshotHashV1, computeLogicalRenderHashV1 } from './hash.js';

export function assertNarrationMatchesTimelineV1(input: {
  narration: NarrationAudioExecutionRefV1;
  narration_audio_id: string;
  narration_audio_hash: string;
  total_duration_ms: number;
  policy: RenderPolicyV1;
}): void {
  if (input.narration.narration_audio_id !== input.narration_audio_id) {
    throw new Error('RENDER_NARRATION_AUDIO_ID_MISMATCH');
  }
  if (
    input.narration.artifact_sha256 !== input.narration_audio_hash ||
    input.narration.verified_file_sha256 !== input.narration_audio_hash
  ) {
    throw new Error('RENDER_NARRATION_AUDIO_HASH_MISMATCH');
  }
  if (
    Math.abs(input.narration.duration_ms - input.total_duration_ms) >
    input.policy.audio.narration_duration_tolerance_ms
  ) {
    throw new Error('RENDER_NARRATION_DURATION_MISMATCH');
  }
}

export function buildLogicalRenderPlanV1(input: {
  timeline_id: string;
  timeline_version: number;
  timeline_commit_receipt_hash: string;
  duration_plan_hash: string;
  total_timeline_duration_ms: number;
  policy: RenderPolicyV1;
  sources: readonly ResolvedRenderSourceV1[];
  narration: NarrationAudioExecutionRefV1;
}): LogicalRenderPlanV1 {
  const ordered = [...input.sources].sort(
    (left, right) =>
      left.timeline_start_ms - right.timeline_start_ms ||
      left.timeline_end_ms - right.timeline_end_ms ||
      left.segment_id.localeCompare(right.segment_id),
  );
  const frames = mapTimelineIntervalsToFramesV1(ordered, input.policy);
  const operations = ordered.map((source, index) => ({
    operation: 'VIDEO_SEGMENT' as const,
    order_index: index,
    segment_id: source.segment_id,
    frame_start: frames[index]!.frame_start,
    frame_end: frames[index]!.frame_end,
    timeline_start_ms: source.timeline_start_ms,
    timeline_end_ms: source.timeline_end_ms,
    asset_id: source.asset_id,
    revision: source.revision,
    shot_id: source.shot_id,
    verified_file_sha256: source.verified_file_sha256,
    source_start_ms: source.source_start_ms,
    source_end_ms: source.source_end_ms,
    selection_request_id: source.selection_request_id,
    decision_receipt_hash: source.decision_receipt_hash,
    selection_slot_id: source.selection_slot_id,
  }));
  const totalOutputFrames = mapTimelineIntervalsToFramesV1(
    [{ timeline_start_ms: 0, timeline_end_ms: input.total_timeline_duration_ms }],
    input.policy,
  )[0]!.frame_end;
  const preimage: Omit<LogicalRenderPlanV1, 'logical_render_hash'> = {
    schema_version: '1.0',
    timeline_id: input.timeline_id,
    timeline_version: input.timeline_version,
    timeline_commit_receipt_hash: input.timeline_commit_receipt_hash,
    duration_plan_hash: input.duration_plan_hash,
    render_policy_id: input.policy.policy_id,
    render_policy_version: input.policy.policy_version,
    render_policy_hash: input.policy.policy_hash,
    fallback_state: 'NONE',
    subtitle_mode: 'OFF',
    source_audio_mode: 'DROP',
    video_operations: operations,
    narration_operation: {
      operation: 'NARRATION',
      narration_audio_id: input.narration.narration_audio_id,
      artifact_id: input.narration.artifact_id,
      artifact_sha256: input.narration.artifact_sha256,
      duration_ms: input.narration.duration_ms,
      duration_measurement: input.narration.duration_measurement,
      sample_count: input.narration.sample_count,
      codec: input.narration.codec,
      container: input.narration.container,
      sample_rate_hz: input.narration.sample_rate_hz,
      channels: input.narration.channels,
      channel_layout: input.narration.channel_layout,
      size_bytes: input.narration.size_bytes,
    },
    total_timeline_duration_ms: input.total_timeline_duration_ms,
    total_output_frames: totalOutputFrames,
  };
  return logicalRenderPlanV1Schema.parse({
    ...preimage,
    logical_render_hash: computeLogicalRenderHashV1(preimage),
  });
}

export function buildExecutionSnapshotV1(
  input: Omit<RenderExecutionSnapshotV1, 'schema_version' | 'execution_snapshot_hash'> & {
    runtime_identity: RenderRuntimeIdentityV1;
  },
): RenderExecutionSnapshotV1 {
  const preimage: Omit<RenderExecutionSnapshotV1, 'execution_snapshot_hash'> = {
    schema_version: '1.0',
    ...input,
    source_artifacts: [...input.source_artifacts].sort((left, right) =>
      left.authority_sha256.localeCompare(right.authority_sha256),
    ),
  };
  return renderExecutionSnapshotV1Schema.parse({
    ...preimage,
    execution_snapshot_hash: computeExecutionSnapshotHashV1(preimage),
  });
}
