import {
  type LogicalRenderPlanV1,
  type RenderPolicyV1,
  type RenderVerificationFactsV1,
} from './contracts.js';
import { parseLogicalRenderPlanV1, parseRenderPolicyV1 } from './hash.js';

type ProbeStream = Record<string, unknown>;

interface ProbeDocument {
  streams?: unknown;
  format?: unknown;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function integer(value: unknown, code: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(code);
  return parsed;
}

function rational(value: unknown, code: string): [bigint, bigint] {
  const match = /^(\d+)\/(\d+)$/u.exec(text(value, code));
  if (!match || match[2] === '0') throw new Error(code);
  return [BigInt(match[1]!), BigInt(match[2]!)];
}

function assertRationalEqual(
  actual: unknown,
  expectedNumerator: number,
  expectedDenominator: number,
): void {
  const [numerator, denominator] = rational(actual, 'RENDER_OUTPUT_FPS_INVALID');
  if (numerator * BigInt(expectedDenominator) !== BigInt(expectedNumerator) * denominator) {
    throw new Error('RENDER_OUTPUT_FPS_MISMATCH');
  }
}

function milliseconds(value: unknown, code: string): number {
  const seconds = Number(text(value, code));
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(code);
  return Math.round(seconds * 1000);
}

function frameCount(stream: ProbeStream): number {
  const raw = stream.nb_read_frames ?? stream.nb_frames;
  const value = integer(raw, 'RENDER_OUTPUT_FRAME_COUNT_MISSING');
  if (value < 1) throw new Error('RENDER_OUTPUT_FRAME_COUNT_MISSING');
  return value;
}

export function verifyFfprobeOutputV1(input: {
  probe_json: string | unknown;
  plan: LogicalRenderPlanV1;
  policy: RenderPolicyV1;
  observed_size_bytes: number;
  progress_end_observed: boolean;
}): RenderVerificationFactsV1 {
  const plan = parseLogicalRenderPlanV1(input.plan);
  const policy = parseRenderPolicyV1(input.policy);
  if (!input.progress_end_observed) throw new Error('FFMPEG_PROGRESS_END_MISSING');
  if (!Number.isSafeInteger(input.observed_size_bytes) || input.observed_size_bytes < 1) {
    throw new Error('RENDER_OUTPUT_EMPTY');
  }
  const document = (
    typeof input.probe_json === 'string' ? JSON.parse(input.probe_json) : input.probe_json
  ) as ProbeDocument;
  const streams = document.streams;
  if (!Array.isArray(streams)) throw new Error('RENDER_OUTPUT_STREAMS_INVALID');
  const typedStreams = streams.map((value) => record(value, 'RENDER_OUTPUT_STREAM_INVALID'));
  const video = typedStreams.filter((stream) => stream.codec_type === 'video');
  const audio = typedStreams.filter((stream) => stream.codec_type === 'audio');
  const subtitles = typedStreams.filter((stream) => stream.codec_type === 'subtitle');
  const unexpected = typedStreams.filter(
    (stream) => stream.codec_type !== 'video' && stream.codec_type !== 'audio',
  );
  if (video.length !== 1) throw new Error('RENDER_OUTPUT_VIDEO_STREAM_COUNT_MISMATCH');
  if (audio.length !== 1) throw new Error('RENDER_OUTPUT_AUDIO_STREAM_COUNT_MISMATCH');
  if (subtitles.length !== 0) throw new Error('RENDER_OUTPUT_SUBTITLE_STREAM_FORBIDDEN');
  if (unexpected.length !== 0) throw new Error('RENDER_OUTPUT_UNEXPECTED_STREAM');
  if (typedStreams[0] !== video[0] || typedStreams[1] !== audio[0]) {
    throw new Error('RENDER_OUTPUT_STREAM_ORDER_MISMATCH');
  }
  const videoStream = video[0]!;
  const audioStream = audio[0]!;
  if (text(videoStream.codec_name, 'RENDER_OUTPUT_VIDEO_CODEC_MISSING') !== 'h264') {
    throw new Error('RENDER_OUTPUT_VIDEO_CODEC_MISMATCH');
  }
  if (
    integer(videoStream.width, 'RENDER_OUTPUT_WIDTH_MISSING') !== policy.canvas.width ||
    integer(videoStream.height, 'RENDER_OUTPUT_HEIGHT_MISSING') !== policy.canvas.height
  ) {
    throw new Error('RENDER_OUTPUT_CANVAS_MISMATCH');
  }
  assertRationalEqual(
    videoStream.avg_frame_rate ?? videoStream.r_frame_rate,
    policy.timebase.fps_numerator,
    policy.timebase.fps_denominator,
  );
  const actualFrames = frameCount(videoStream);
  if (actualFrames !== plan.total_output_frames) {
    throw new Error('RENDER_OUTPUT_FRAME_COUNT_MISMATCH');
  }
  const pixelFormat = text(videoStream.pix_fmt, 'RENDER_OUTPUT_PIXEL_FORMAT_MISSING');
  if (pixelFormat !== policy.video.pixel_format) {
    throw new Error('RENDER_OUTPUT_PIXEL_FORMAT_MISMATCH');
  }
  const profile = text(videoStream.profile, 'RENDER_OUTPUT_PROFILE_MISSING');
  if (profile.toUpperCase() !== policy.video.profile) {
    throw new Error('RENDER_OUTPUT_PROFILE_MISMATCH');
  }
  const level = integer(videoStream.level, 'RENDER_OUTPUT_LEVEL_MISSING');
  if (String(level) !== policy.video.level.replace('.', '')) {
    throw new Error('RENDER_OUTPUT_LEVEL_MISMATCH');
  }
  if (text(audioStream.codec_name, 'RENDER_OUTPUT_AUDIO_CODEC_MISSING') !== 'aac') {
    throw new Error('RENDER_OUTPUT_AUDIO_CODEC_MISMATCH');
  }
  if (
    integer(audioStream.sample_rate, 'RENDER_OUTPUT_SAMPLE_RATE_MISSING') !==
    policy.audio.sample_rate_hz
  ) {
    throw new Error('RENDER_OUTPUT_SAMPLE_RATE_MISMATCH');
  }
  if (integer(audioStream.channels, 'RENDER_OUTPUT_CHANNELS_MISSING') !== policy.audio.channels) {
    throw new Error('RENDER_OUTPUT_CHANNELS_MISMATCH');
  }
  if (text(audioStream.channel_layout, 'RENDER_OUTPUT_CHANNEL_LAYOUT_MISSING') !== 'stereo') {
    throw new Error('RENDER_OUTPUT_CHANNEL_LAYOUT_MISMATCH');
  }
  const format = record(document.format, 'RENDER_OUTPUT_FORMAT_MISSING');
  if (!text(format.format_name, 'RENDER_OUTPUT_CONTAINER_MISSING').split(',').includes('mp4')) {
    throw new Error('RENDER_OUTPUT_CONTAINER_MISMATCH');
  }
  if (integer(format.size, 'RENDER_OUTPUT_SIZE_MISSING') !== input.observed_size_bytes) {
    throw new Error('RENDER_OUTPUT_SIZE_MISMATCH');
  }
  const durationMs = milliseconds(format.duration, 'RENDER_OUTPUT_DURATION_MISSING');
  const expectedDurationNumerator =
    plan.total_output_frames * 1000 * policy.timebase.fps_denominator;
  const expectedDurationMs = Math.round(expectedDurationNumerator / policy.timebase.fps_numerator);
  if (
    Math.abs(durationMs - expectedDurationMs) > policy.verification.max_output_duration_error_ms
  ) {
    throw new Error('RENDER_OUTPUT_DURATION_MISMATCH');
  }
  return {
    duration_ms: durationMs,
    width: policy.canvas.width,
    height: policy.canvas.height,
    fps_numerator: policy.timebase.fps_numerator,
    fps_denominator: policy.timebase.fps_denominator,
    video_codec_family: 'H264',
    audio_codec_family: 'AAC',
    container: 'MP4',
    frame_count: actualFrames,
    pixel_format: pixelFormat,
    sample_rate_hz: policy.audio.sample_rate_hz,
    channels: policy.audio.channels,
    stream_count: typedStreams.length,
    subtitle_streams: 0,
    unexpected_streams: 0,
    video_profile: profile,
    video_level: policy.video.level,
    progress_end_observed: true,
    finalize_protocol: 'ATOMIC_SAME_VOLUME_RENAME',
  };
}
