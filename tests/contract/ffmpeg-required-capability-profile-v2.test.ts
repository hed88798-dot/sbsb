import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../packages/domain-media-index/src/signature.js';

const profileV1Path = resolve(
  import.meta.dirname,
  '../../docs/render/ffmpeg-required-capability-profile.v1.json',
);
const profileV2Path = resolve(
  import.meta.dirname,
  '../../docs/render/ffmpeg-required-capability-profile.v2.json',
);

type RequiredCapabilities = Record<string, unknown> & {
  video_filters: string[];
  video_operations: string[];
  protocols: Record<string, unknown>;
  video_output: Record<string, unknown>;
  audio_output: Record<string, unknown> & { source_video_audio: string };
};

type BaseProfile = Record<string, unknown> & {
  schema_version: string;
  profile_id: string;
  profile_version: number;
  profile_hash: string;
  authority_semantics: Record<string, unknown> & {
    owner: string;
    artifact_approval_owner: string;
    real_execution_authorized_by_this_profile: boolean;
  };
  required_capabilities: RequiredCapabilities;
  forbidden_capabilities: Record<string, unknown> & {
    network_protocols: string[];
    gpl_components: boolean;
    nonfree_components: boolean;
    libraries: string[];
    subtitle_processing: boolean;
    fallback_generation: boolean;
  };
  platform_constraints: Record<string, unknown>;
  artifact_status: Record<string, unknown> & {
    ffmpeg_binary: string;
    real_render: string;
  };
};

type ProfileV2 = BaseProfile & {
  required_capabilities: RequiredCapabilities & {
    rotation_normalization: Record<string, unknown> & {
      supported_degrees: number[];
      rotation_application_count: string;
      output_effective_rotation_metadata: string;
      output_nonidentity_display_matrix: string;
      semantic_timeline_duration_change: string;
      source_interval_change: string;
      extra_or_missing_frames: string;
    };
  };
  evidence_gates: {
    static_runtime_capability: Record<string, unknown> & {
      required: boolean;
      owner: string;
      candidate_machine_inspection_required: boolean;
      documentation_or_build_configuration_only_sufficient: boolean;
      required_rotation_filters: string[];
    };
    dynamic_rotation_capability: Record<string, unknown> & {
      metadata_rotation_fixture_degrees: number[];
      actual_r1b_product_service_path_required: boolean;
      standalone_code_f_runtime_smoke_substitutes_for_product_path: boolean;
      pixel_normalization_verification: string[];
      metadata_normalization_verification: string[];
      rotation_90_metadata_normalized: string;
      rotation_180_metadata_normalized: string;
      rotation_270_metadata_normalized: string;
    };
  };
  frozen_render_modes: Record<string, unknown>;
  version_history: Record<string, unknown>;
  stability: Record<string, unknown> & { prior_runtime_scope: string };
};

const profileV1Bytes = readFileSync(profileV1Path);
const profileV2Bytes = readFileSync(profileV2Path);
const profileV1 = JSON.parse(profileV1Bytes.toString('utf8')) as BaseProfile;
const profileV2 = JSON.parse(profileV2Bytes.toString('utf8')) as ProfileV2;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function semanticHash(profile: Record<string, unknown>): string {
  return sha256(
    canonicalJson(
      Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'profile_hash')),
    ),
  );
}

describe('Code G FFmpeg required capability Profile v2', () => {
  it('preserves the exact Profile v1 bytes and semantic hash', () => {
    expect(sha256(profileV1Bytes)).toBe(
      '4352c73c432a0bbf37a4937267b7785d1fac9c8fe55fab99fb6e7a09ccb9e8c6',
    );
    expect(profileV1.profile_hash).toBe(
      'e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910',
    );
    expect(semanticHash(profileV1)).toBe(profileV1.profile_hash);
  });

  it('is a distinct, versioned, self-consistent forward profile', () => {
    expect(Object.keys(profileV2)).toEqual([
      'schema_version',
      'profile_id',
      'profile_version',
      'profile_hash',
      'authority_semantics',
      'required_capabilities',
      'evidence_gates',
      'frozen_render_modes',
      'forbidden_capabilities',
      'platform_constraints',
      'version_history',
      'stability',
      'artifact_status',
    ]);
    expect(profileV2.schema_version).toBe('2.0');
    expect(profileV2.profile_id).toBe(profileV1.profile_id);
    expect(profileV2.profile_version).toBe(2);
    expect(profileV2.profile_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(profileV2.profile_hash).not.toBe(profileV1.profile_hash);
    expect(semanticHash(profileV2)).toBe(profileV2.profile_hash);
  });

  it('retains every v1 required capability and adds exactly the rotation filter delta', () => {
    const v1Required = profileV1.required_capabilities as Record<string, unknown>;
    const v2Required = profileV2.required_capabilities as Record<string, unknown>;
    for (const [key, value] of Object.entries(v1Required)) {
      if (key !== 'video_filters') expect(v2Required[key]).toEqual(value);
    }

    const v1Filters = new Set(profileV1.required_capabilities.video_filters as string[]);
    const v2Filters = new Set(profileV2.required_capabilities.video_filters as string[]);
    expect([...v1Filters].every((filter) => v2Filters.has(filter))).toBe(true);
    expect([...v2Filters].filter((filter) => !v1Filters.has(filter)).sort()).toEqual([
      'hflip',
      'rotate',
      'transpose',
      'vflip',
    ]);
    for (const filter of ['transpose', 'hflip', 'vflip', 'rotate']) {
      expect(v2Filters.has(filter)).toBe(true);
    }
    expect(profileV2.required_capabilities.video_operations).toContain('apply_declared_rotation');
  });

  it('requires 90/180/270 product evidence and exactly-once pixel and metadata normalization', () => {
    const rotation = profileV2.required_capabilities.rotation_normalization;
    const dynamic = profileV2.evidence_gates.dynamic_rotation_capability;
    expect(rotation.supported_degrees).toEqual([90, 180, 270]);
    expect(rotation.rotation_application_count).toBe('EXACTLY_ONCE');
    expect(rotation.output_effective_rotation_metadata).toBe('NONE_OR_IDENTITY_ONLY');
    expect(rotation.output_nonidentity_display_matrix).toBe('FORBIDDEN');
    expect(rotation.semantic_timeline_duration_change).toBe('FORBIDDEN');
    expect(rotation.source_interval_change).toBe('FORBIDDEN');
    expect(rotation.extra_or_missing_frames).toBe('FORBIDDEN');
    expect(dynamic.metadata_rotation_fixture_degrees).toEqual([90, 180, 270]);
    expect(dynamic.actual_r1b_product_service_path_required).toBe(true);
    expect(dynamic.standalone_code_f_runtime_smoke_substitutes_for_product_path).toBe(false);
    expect(dynamic.pixel_normalization_verification).toEqual(
      expect.arrayContaining([
        'visible_orientation',
        'target_width_height',
        'sample_aspect_ratio',
        'frames_per_second',
        'exact_expected_frame_count',
      ]),
    );
    expect(dynamic.metadata_normalization_verification).toEqual(
      expect.arrayContaining([
        'rotation_applied_exactly_once',
        'output_effective_rotation_metadata_none_or_identity',
        'output_nonidentity_display_matrix_absent',
        'playback_requires_no_additional_orientation_transform',
      ]),
    );
    expect(dynamic.rotation_90_metadata_normalized).toBe('REQUIRED');
    expect(dynamic.rotation_180_metadata_normalized).toBe('REQUIRED');
    expect(dynamic.rotation_270_metadata_normalized).toBe('REQUIRED');
  });

  it('requires built-candidate inspection and leaves artifact approval with Code F', () => {
    const staticGate = profileV2.evidence_gates.static_runtime_capability;
    expect(staticGate.required).toBe(true);
    expect(staticGate.owner).toBe('CODE_F');
    expect(staticGate.candidate_machine_inspection_required).toBe(true);
    expect(staticGate.documentation_or_build_configuration_only_sufficient).toBe(false);
    expect(staticGate.required_rotation_filters).toEqual(['transpose', 'hflip', 'vflip', 'rotate']);
    expect(profileV2.authority_semantics.owner).toBe('CODE_G');
    expect(profileV2.authority_semantics.artifact_approval_owner).toBe('CODE_F');
    expect(profileV2.authority_semantics.real_execution_authorized_by_this_profile).toBe(false);
    expect(profileV2.artifact_status.ffmpeg_binary).toBe('NOT_PRODUCED_BY_CODE_G');
    expect(profileV2.artifact_status.real_render).toBe('NOT_AUTHORIZED');
  });

  it('preserves network, license, codec, audio, subtitle, and fallback boundaries', () => {
    expect(profileV2.required_capabilities.protocols).toEqual(
      profileV1.required_capabilities.protocols,
    );
    expect(profileV2.forbidden_capabilities).toEqual(profileV1.forbidden_capabilities);
    expect(profileV2.platform_constraints).toEqual(profileV1.platform_constraints);
    expect(profileV2.required_capabilities.video_output).toEqual(
      profileV1.required_capabilities.video_output,
    );
    expect(profileV2.required_capabilities.audio_output.source_video_audio).toBe('DROP');
    expect(profileV2.forbidden_capabilities.network_protocols).toEqual([
      'ftp',
      'http',
      'https',
      'rtmp',
      'rtsp',
    ]);
    expect(profileV2.forbidden_capabilities.gpl_components).toBe(true);
    expect(profileV2.forbidden_capabilities.nonfree_components).toBe(true);
    expect(profileV2.forbidden_capabilities.libraries).toEqual(['libx264', 'libx265']);
    expect(profileV2.forbidden_capabilities.subtitle_processing).toBe(true);
    expect(profileV2.forbidden_capabilities.fallback_generation).toBe(true);
    expect(profileV2.frozen_render_modes).toEqual({
      source_video_audio: 'DROP',
      output_audio_authority: 'NARRATION_ONLY',
      subtitle: 'OFF',
      fallback_generation: 'FORBIDDEN',
      digital_human: 'OUTSIDE_RENDER',
    });
  });

  it('preserves historical Runtime v1 approval while requiring a new Runtime v2', () => {
    expect(profileV2.version_history).toEqual({
      profile_v1: 'HISTORICAL_FROZEN_CAPABILITY_CONTRACT',
      profile_v1_hash: 'e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910',
      runtime_v1_status: 'HISTORICALLY_APPROVED',
      runtime_v1_current_r1b_compatibility: 'INCOMPATIBLE_WITH_ROTATION_CAPABLE_R1B_CONTRACT',
      historical_v1_approval_revoked: false,
      profile_v2: 'CURRENT_ROTATION_CAPABLE_R1B_REQUIREMENT',
      runtime_v2: 'NOT_YET_PRODUCED_CODE_F_REQUIRED',
    });
    expect(profileV2.stability.prior_runtime_scope).toBe('CURRENT_R1B_COMPATIBILITY_ONLY');
  });
});
