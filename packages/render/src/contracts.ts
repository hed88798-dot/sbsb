import { z } from 'zod';

const schemaVersion = z.literal('1.0');
const identity = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const localPath = z.string().min(1).max(4096);

export const renderAcceptedTimelineRequestV1Schema = z
  .object({
    schema_version: schemaVersion,
    timeline_id: identity,
    timeline_version: positiveInteger,
    expected_timeline_commit_receipt_hash: sha256,
    render_policy_id: identity,
    render_policy_version: positiveInteger,
    render_policy_hash: sha256,
  })
  .strict();
export type RenderAcceptedTimelineRequestV1 = z.infer<typeof renderAcceptedTimelineRequestV1Schema>;

export const renderPolicyV1Schema = z
  .object({
    schema_version: schemaVersion,
    policy_id: identity,
    policy_version: positiveInteger,
    policy_hash: sha256,
    canvas: z
      .object({
        width: positiveInteger,
        height: positiveInteger,
        background_color: z.string().regex(/^#[0-9a-f]{6}$/u),
        sample_aspect_ratio: z.literal('1:1'),
      })
      .strict(),
    timebase: z
      .object({
        fps_numerator: positiveInteger,
        fps_denominator: positiveInteger,
        frame_boundary_mapping: z.literal('ABSOLUTE_NEAREST_HALF_UP'),
        zero_frame_segment: z.literal('FAIL_CLOSED'),
      })
      .strict(),
    visual_fit: z
      .object({
        mode: z.enum(['SCALE_PAD', 'SCALE_CROP']),
        scale_algorithm: z.literal('LANCZOS'),
        crop: z.enum(['DISABLED', 'POLICY_CENTER_CROP_ONLY']),
        rotation: z.literal('APPLY_DECLARED_METADATA'),
        odd_dimension: z.literal('PAD_TO_CANVAS'),
      })
      .strict(),
    video: z
      .object({
        codec_family: z.literal('H264'),
        profile: z.literal('HIGH'),
        level: z.literal('4.1'),
        pixel_format: z.literal('yuv420p'),
        rate_control: z.literal('CBR'),
        bitrate_bps: positiveInteger,
        buffer_size_bits: positiveInteger,
        gop_frames: positiveInteger,
        b_frames: nonnegativeInteger,
        encoder_implementation: z.literal('APPROVED_MACHINE_RUNTIME_IDENTITY'),
      })
      .strict(),
    audio: z
      .object({
        codec_family: z.literal('AAC'),
        sample_rate_hz: positiveInteger,
        channels: z.literal(2),
        channel_layout: z.literal('stereo'),
        bitrate_bps: positiveInteger,
        source_video_audio: z.literal('DROP'),
        primary_audio: z.literal('NARRATION_ONLY'),
        duration_mismatch: z.literal('FAIL_CLOSED'),
        narration_time_stretch: z.literal('FORBIDDEN'),
        narration_duration_tolerance_ms: nonnegativeInteger.max(1000),
        preferred_duration_measurement: z.literal('SAMPLE_COUNT_DERIVED'),
      })
      .strict(),
    subtitle: z.object({ mode: z.literal('OFF') }).strict(),
    container: z
      .object({
        format: z.literal('MP4'),
        fast_start: z.boolean(),
        stream_order: z.tuple([z.literal('VIDEO'), z.literal('AUDIO')]),
        metadata: z.literal('STRIP_NONESSENTIAL'),
      })
      .strict(),
    execution: z
      .object({
        ffmpeg_timeout_ms: positiveInteger,
        no_progress_timeout_ms: positiveInteger,
        graceful_cancel_timeout_ms: positiveInteger,
        forced_cancel_timeout_ms: positiveInteger,
        max_log_bytes: positiveInteger,
      })
      .strict(),
    verification: z
      .object({
        max_output_duration_error_ms: nonnegativeInteger.max(1000),
        require_video_stream: z.literal(true),
        require_audio_stream: z.literal(true),
        require_exact_canvas: z.literal(true),
        require_exact_fps: z.literal(true),
        require_output_sha256: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type RenderPolicyV1 = z.infer<typeof renderPolicyV1Schema>;

export const narrationAudioArtifactV1Schema = z
  .object({
    schema_version: schemaVersion,
    narration_audio_id: identity,
    artifact_id: identity,
    artifact_sha256: sha256,
    duration_ms: positiveInteger,
    duration_measurement: z.enum(['SAMPLE_COUNT_DERIVED', 'CONTAINER_REPORTED']),
    sample_count: positiveInteger.nullable(),
    codec: identity,
    container: identity,
    sample_rate_hz: positiveInteger,
    channels: positiveInteger.max(32),
    channel_layout: identity,
    size_bytes: positiveInteger,
    producer_ref: identity.nullable(),
    provenance_ref: identity.nullable(),
    artifact_hash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.duration_measurement === 'SAMPLE_COUNT_DERIVED' && value.sample_count === null) {
      context.addIssue({
        code: 'custom',
        message: 'sample_count is required for SAMPLE_COUNT_DERIVED duration',
        path: ['sample_count'],
      });
    }
    if (value.duration_measurement === 'CONTAINER_REPORTED' && value.sample_count !== null) {
      context.addIssue({
        code: 'custom',
        message: 'sample_count must be null for CONTAINER_REPORTED duration',
        path: ['sample_count'],
      });
    }
  });
export type NarrationAudioArtifactV1 = z.infer<typeof narrationAudioArtifactV1Schema>;

export const narrationAudioExecutionRefV1Schema = narrationAudioArtifactV1Schema
  .omit({ artifact_hash: true })
  .extend({
    resolved_source_path: localPath,
    verified_file_sha256: sha256,
    resolved_at: z.string().datetime(),
  })
  .strict();
export type NarrationAudioExecutionRefV1 = z.infer<typeof narrationAudioExecutionRefV1Schema>;

export const resolvedRenderSourceV1Schema = z
  .object({
    schema_version: schemaVersion,
    segment_id: identity,
    asset_id: identity,
    revision: positiveInteger,
    shot_id: identity,
    shot_start_ms: nonnegativeInteger,
    shot_end_ms: positiveInteger,
    source_start_ms: nonnegativeInteger,
    source_end_ms: positiveInteger,
    timeline_start_ms: nonnegativeInteger,
    timeline_end_ms: positiveInteger,
    selection_request_id: identity,
    decision_receipt_hash: sha256,
    selection_slot_id: identity,
    resolved_source_path: localPath,
    verified_file_sha256: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.shot_end_ms <= value.shot_start_ms ||
      value.source_end_ms <= value.source_start_ms ||
      value.timeline_end_ms <= value.timeline_start_ms ||
      value.source_start_ms < value.shot_start_ms ||
      value.source_end_ms > value.shot_end_ms
    ) {
      context.addIssue({ code: 'custom', message: 'render source interval is invalid' });
    }
  });
export type ResolvedRenderSourceV1 = z.infer<typeof resolvedRenderSourceV1Schema>;

export const renderRuntimeIdentityV1Schema = z
  .object({
    schema_version: schemaVersion,
    runtime_id: identity,
    platform: z.enum(['darwin', 'linux', 'win32']),
    architecture: z.enum(['arm64', 'x64']),
    ffmpeg_executable_path: localPath,
    ffmpeg_entrypoint_sha256: sha256,
    ffprobe_executable_path: localPath,
    ffprobe_entrypoint_sha256: sha256,
    companion_manifest_sha256: sha256,
    capability_profile_id: identity,
    capability_profile_version: positiveInteger,
    capability_profile_hash: sha256,
    runtime_member_hashes: z.array(z.object({ relative_path: identity, sha256 }).strict()).min(1),
    approval_status: z.enum(['APPROVED', 'MOCK_R1A_TEST_ONLY']),
  })
  .strict();
export type RenderRuntimeIdentityV1 = z.infer<typeof renderRuntimeIdentityV1Schema>;

export const logicalVideoSegmentOperationV1Schema = z
  .object({
    operation: z.literal('VIDEO_SEGMENT'),
    order_index: nonnegativeInteger,
    segment_id: identity,
    frame_start: nonnegativeInteger,
    frame_end: positiveInteger,
    timeline_start_ms: nonnegativeInteger,
    timeline_end_ms: positiveInteger,
    asset_id: identity,
    revision: positiveInteger,
    shot_id: identity,
    verified_file_sha256: sha256,
    source_start_ms: nonnegativeInteger,
    source_end_ms: positiveInteger,
    selection_request_id: identity,
    decision_receipt_hash: sha256,
    selection_slot_id: identity,
  })
  .strict();
export type LogicalVideoSegmentOperationV1 = z.infer<typeof logicalVideoSegmentOperationV1Schema>;

export const logicalNarrationOperationV1Schema = z
  .object({
    operation: z.literal('NARRATION'),
    narration_audio_id: identity,
    artifact_id: identity,
    artifact_sha256: sha256,
    duration_ms: positiveInteger,
    duration_measurement: z.enum(['SAMPLE_COUNT_DERIVED', 'CONTAINER_REPORTED']),
    sample_count: positiveInteger.nullable(),
    codec: identity,
    container: identity,
    sample_rate_hz: positiveInteger,
    channels: positiveInteger,
    channel_layout: identity,
    size_bytes: positiveInteger,
  })
  .strict();
export type LogicalNarrationOperationV1 = z.infer<typeof logicalNarrationOperationV1Schema>;

export const logicalRenderPlanV1Schema = z
  .object({
    schema_version: schemaVersion,
    timeline_id: identity,
    timeline_version: positiveInteger,
    timeline_commit_receipt_hash: sha256,
    duration_plan_hash: sha256,
    render_policy_id: identity,
    render_policy_version: positiveInteger,
    render_policy_hash: sha256,
    fallback_state: z.literal('NONE'),
    subtitle_mode: z.literal('OFF'),
    source_audio_mode: z.literal('DROP'),
    video_operations: z.array(logicalVideoSegmentOperationV1Schema).min(1),
    narration_operation: logicalNarrationOperationV1Schema,
    total_timeline_duration_ms: positiveInteger,
    total_output_frames: positiveInteger,
    logical_render_hash: sha256,
  })
  .strict();
export type LogicalRenderPlanV1 = z.infer<typeof logicalRenderPlanV1Schema>;

const stagedArtifactSchema = z
  .object({
    authority_sha256: sha256,
    source_path: localPath,
    staged_path: localPath,
    staged_sha256: sha256,
    size_bytes: positiveInteger,
  })
  .strict();

export const renderExecutionSnapshotV1Schema = z
  .object({
    schema_version: schemaVersion,
    logical_render_hash: sha256,
    platform: z.enum(['darwin', 'linux', 'win32']),
    architecture: z.enum(['arm64', 'x64']),
    staging_root: localPath,
    output_root: localPath,
    source_artifacts: z
      .array(stagedArtifactSchema.extend({ segment_ids: z.array(identity).min(1) }).strict())
      .min(1),
    narration_artifact: stagedArtifactSchema,
    runtime_identity: renderRuntimeIdentityV1Schema,
    execution_snapshot_hash: sha256,
  })
  .strict();
export type RenderExecutionSnapshotV1 = z.infer<typeof renderExecutionSnapshotV1Schema>;

export const renderOutputArtifactV1Schema = z
  .object({
    artifact_id: identity,
    output_sha256: sha256,
    size_bytes: positiveInteger,
    managed_relative_path: identity,
  })
  .strict();
export type RenderOutputArtifactV1 = z.infer<typeof renderOutputArtifactV1Schema>;

export const renderVerificationFactsV1Schema = z
  .object({
    duration_ms: positiveInteger,
    width: positiveInteger,
    height: positiveInteger,
    fps_numerator: positiveInteger,
    fps_denominator: positiveInteger,
    video_codec_family: z.literal('H264'),
    audio_codec_family: z.literal('AAC'),
    container: z.literal('MP4'),
    frame_count: positiveInteger.optional(),
    pixel_format: identity.optional(),
    sample_rate_hz: positiveInteger.optional(),
    channels: positiveInteger.optional(),
    stream_count: positiveInteger.optional(),
    subtitle_streams: nonnegativeInteger.optional(),
    unexpected_streams: nonnegativeInteger.optional(),
    video_profile: identity.optional(),
    video_level: identity.optional(),
    progress_end_observed: z.literal(true).optional(),
    finalize_protocol: z.literal('ATOMIC_SAME_VOLUME_RENAME').optional(),
  })
  .strict();
export type RenderVerificationFactsV1 = z.infer<typeof renderVerificationFactsV1Schema>;

export const renderReceiptV1Schema = z
  .object({
    schema_version: schemaVersion,
    receipt_id: identity,
    job_id: identity,
    logical_render_hash: sha256,
    execution_snapshot_hash: sha256,
    timeline_id: identity,
    timeline_version: positiveInteger,
    timeline_commit_receipt_hash: sha256,
    render_policy_id: identity,
    render_policy_version: positiveInteger,
    render_policy_hash: sha256,
    runtime_id: identity,
    runtime_manifest_sha256: sha256,
    terminal_state: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
    output_artifact: renderOutputArtifactV1Schema.nullable(),
    verification_facts: renderVerificationFactsV1Schema.nullable(),
    error_id: identity.nullable(),
    created_at: z.string().datetime(),
    receipt_hash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.terminal_state === 'SUCCEEDED' &&
      (value.output_artifact === null ||
        value.verification_facts === null ||
        value.error_id !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'SUCCEEDED receipt requires verified output' });
    }
    if (value.terminal_state !== 'SUCCEEDED' && value.error_id === null) {
      context.addIssue({ code: 'custom', message: 'non-success receipt requires error_id' });
    }
  });
export type RenderReceiptV1 = z.infer<typeof renderReceiptV1Schema>;
