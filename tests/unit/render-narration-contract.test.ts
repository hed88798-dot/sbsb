import { describe, expect, it } from 'vitest';
import {
  narrationAudioArtifactV1Schema,
  narrationAudioExecutionRefV1Schema,
} from '../../packages/render/src/index.js';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

function artifact(
  durationMeasurement: 'SAMPLE_COUNT_DERIVED' | 'CONTAINER_REPORTED',
  sampleCount: number | null,
) {
  return {
    schema_version: '1.0' as const,
    narration_audio_id: 'audio_1',
    artifact_id: 'artifact_1',
    artifact_sha256: hashA,
    duration_ms: 1000,
    duration_measurement: durationMeasurement,
    sample_count: sampleCount,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: 48000,
    channels: 2,
    channel_layout: 'stereo',
    size_bytes: 192000,
    producer_ref: null,
    provenance_ref: null,
    artifact_hash: hashB,
  };
}

function executionRef(
  durationMeasurement: 'SAMPLE_COUNT_DERIVED' | 'CONTAINER_REPORTED',
  sampleCount: number | null,
) {
  return {
    schema_version: '1.0' as const,
    narration_audio_id: 'audio_1',
    artifact_id: 'artifact_1',
    artifact_sha256: hashA,
    duration_ms: 1000,
    duration_measurement: durationMeasurement,
    sample_count: sampleCount,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: 48000,
    channels: 2,
    channel_layout: 'stereo',
    size_bytes: 192000,
    producer_ref: null,
    provenance_ref: null,
    resolved_source_path: '/controlled/narration.wav',
    verified_file_sha256: hashA,
    resolved_at: '2026-10-24T00:00:00.000Z',
  };
}

describe('Narration audio duration-measurement contract parity', () => {
  it('accepts both valid artifact duration/sample-count combinations', () => {
    expect(
      narrationAudioArtifactV1Schema.safeParse(artifact('SAMPLE_COUNT_DERIVED', 48000)).success,
    ).toBe(true);
    expect(
      narrationAudioArtifactV1Schema.safeParse(artifact('CONTAINER_REPORTED', null)).success,
    ).toBe(true);
  });

  it('rejects both invalid artifact duration/sample-count combinations', () => {
    expect(
      narrationAudioArtifactV1Schema.safeParse(artifact('SAMPLE_COUNT_DERIVED', null)).success,
    ).toBe(false);
    expect(
      narrationAudioArtifactV1Schema.safeParse(artifact('CONTAINER_REPORTED', 48000)).success,
    ).toBe(false);
  });

  it('accepts both valid execution-ref duration/sample-count combinations', () => {
    expect(
      narrationAudioExecutionRefV1Schema.safeParse(executionRef('SAMPLE_COUNT_DERIVED', 48000))
        .success,
    ).toBe(true);
    expect(
      narrationAudioExecutionRefV1Schema.safeParse(executionRef('CONTAINER_REPORTED', null))
        .success,
    ).toBe(true);
  });

  it('rejects both invalid execution-ref duration/sample-count combinations', () => {
    expect(
      narrationAudioExecutionRefV1Schema.safeParse(executionRef('SAMPLE_COUNT_DERIVED', null))
        .success,
    ).toBe(false);
    expect(
      narrationAudioExecutionRefV1Schema.safeParse(executionRef('CONTAINER_REPORTED', 48000))
        .success,
    ).toBe(false);
  });
});
