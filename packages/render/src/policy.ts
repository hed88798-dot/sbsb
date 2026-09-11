import type { RenderPolicyV1 } from './contracts.js';
import { computeRenderPolicyHashV1, parseRenderPolicyV1 } from './hash.js';

const preimage: Omit<RenderPolicyV1, 'policy_hash'> = {
  schema_version: '1.0',
  policy_id: 'code-g-r1-render-policy',
  policy_version: 1,
  canvas: {
    width: 1080,
    height: 1920,
    background_color: '#000000',
    sample_aspect_ratio: '1:1',
  },
  timebase: {
    fps_numerator: 30,
    fps_denominator: 1,
    frame_boundary_mapping: 'ABSOLUTE_NEAREST_HALF_UP',
    zero_frame_segment: 'FAIL_CLOSED',
  },
  visual_fit: {
    mode: 'SCALE_PAD',
    scale_algorithm: 'LANCZOS',
    crop: 'DISABLED',
    rotation: 'APPLY_DECLARED_METADATA',
    odd_dimension: 'PAD_TO_CANVAS',
  },
  video: {
    codec_family: 'H264',
    profile: 'HIGH',
    level: '4.1',
    pixel_format: 'yuv420p',
    rate_control: 'CBR',
    bitrate_bps: 8_000_000,
    buffer_size_bits: 16_000_000,
    gop_frames: 60,
    b_frames: 0,
    encoder_implementation: 'APPROVED_MACHINE_RUNTIME_IDENTITY',
  },
  audio: {
    codec_family: 'AAC',
    sample_rate_hz: 48_000,
    channels: 2,
    channel_layout: 'stereo',
    bitrate_bps: 192_000,
    source_video_audio: 'DROP',
    primary_audio: 'NARRATION_ONLY',
    duration_mismatch: 'FAIL_CLOSED',
    narration_time_stretch: 'FORBIDDEN',
    narration_duration_tolerance_ms: 0,
    preferred_duration_measurement: 'SAMPLE_COUNT_DERIVED',
  },
  subtitle: { mode: 'OFF' },
  container: {
    format: 'MP4',
    fast_start: true,
    stream_order: ['VIDEO', 'AUDIO'],
    metadata: 'STRIP_NONESSENTIAL',
  },
  execution: {
    ffmpeg_timeout_ms: 900_000,
    no_progress_timeout_ms: 30_000,
    graceful_cancel_timeout_ms: 5_000,
    forced_cancel_timeout_ms: 5_000,
    max_log_bytes: 1_048_576,
  },
  verification: {
    max_output_duration_error_ms: 17,
    require_video_stream: true,
    require_audio_stream: true,
    require_exact_canvas: true,
    require_exact_fps: true,
    require_output_sha256: true,
  },
};

export const RENDER_POLICY_V1 = parseRenderPolicyV1({
  ...preimage,
  policy_hash: computeRenderPolicyHashV1(preimage),
});
