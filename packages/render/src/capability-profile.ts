import { z } from 'zod';
import { canonicalJson, sha256 } from '@app/domain-media-index';

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.string().trim().min(1).max(256);
const stringArray = z.array(z.string().min(1));

export const FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1 = {
  profile_id: 'code-g-r1-ffmpeg-required-capabilities',
  profile_version: 1,
  profile_hash: 'e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910',
} as const;

export const ffmpegRequiredCapabilityProfileV1Schema = z
  .object({
    schema_version: z.literal('1.0'),
    profile_id: identity,
    profile_version: z.literal(1),
    profile_hash: sha,
    authority_semantics: z
      .object({
        owner: z.literal('CODE_G'),
        purpose: z.literal('REQUIRED_CAPABILITIES_FOR_DETERMINISTIC_RENDER_EXECUTION'),
        artifact_approval_owner: z.literal('CODE_F'),
        render_phase: z.literal('R1B_OR_LATER'),
        real_execution_authorized_by_this_profile: z.literal(false),
      })
      .strict(),
    required_capabilities: z
      .object({
        programs: z.tuple([z.literal('ffmpeg'), z.literal('ffprobe')]),
        input: z
          .object({
            scope: z.literal('EXACT_HASH_VERIFIED_LOCAL_FILES_ONLY'),
            video_extensions: stringArray,
            video_demuxer_parser_decoder_policy: identity,
            narration_containers: stringArray,
            narration_codecs: stringArray,
            malformed_or_unsupported_input: z.literal('FAIL_CLOSED'),
          })
          .strict(),
        video_operations: stringArray,
        video_filters: stringArray,
        video_output: z
          .object({
            codec_family: z.literal('H264'),
            encoder_implementation: z.literal('CODE_F_APPROVED_PLATFORM_RUNTIME_IDENTITY'),
            software_encoder_fallback: identity,
            pixel_format: z.literal('yuv420p'),
            rate_control: z.literal('EXPLICIT_RENDER_POLICY_ONLY'),
          })
          .strict(),
        audio_operations: stringArray,
        audio_filters: stringArray,
        audio_output: z
          .object({
            codec_family: z.literal('AAC'),
            encoder_implementation: z.literal('CODE_F_APPROVED_RUNTIME_IDENTITY'),
            sample_rate_hz: z.literal(48000),
            channels: z.literal(2),
            source_video_audio: z.literal('DROP'),
            duration_correction_by_trim_pad_or_time_stretch: z.literal('FORBIDDEN'),
          })
          .strict(),
        container_output: z
          .object({
            format: z.literal('MP4'),
            muxer: z.literal('mov'),
            network_output: z.literal('FORBIDDEN'),
          })
          .strict(),
        protocols: z
          .object({
            declared: z.tuple([z.literal('file'), z.literal('pipe')]),
            file_use: identity,
            pipe_use: identity,
            undeclared: z.literal('FORBIDDEN'),
          })
          .strict(),
        process_control: z
          .object({
            direct_spawn: z.literal(true),
            argument_array: z.literal(true),
            shell: z.literal(false),
            path_lookup: z.literal(false),
            machine_readable_progress: z.literal(true),
            bounded_log_capture: z.literal(true),
            graceful_then_forced_termination: z.literal(true),
            hang_timeout_owned_by_main: z.literal(true),
          })
          .strict(),
        verification: z
          .object({
            ffprobe_json: z.literal(true),
            required_video_facts: stringArray,
            required_audio_facts: stringArray,
            required_container_facts: stringArray,
            output_sha256: z.literal(true),
          })
          .strict(),
      })
      .strict(),
    forbidden_capabilities: z
      .object({
        network_protocols: stringArray,
        network_input_output: z.literal(true),
        device_capture: z.literal(true),
        server_or_listener_behavior: z.literal(true),
        undeclared_protocols: z.literal(true),
        gpl_components: z.literal(true),
        nonfree_components: z.literal(true),
        libraries: stringArray,
        programs: z.tuple([z.literal('ffplay')]),
        arbitrary_shell: z.literal(true),
        ui_supplied_executable_or_arguments: z.literal(true),
        source_video_audio_keep_or_mix: z.literal(true),
        background_music: z.literal(true),
        subtitle_processing: z.literal(true),
        fallback_generation: z.literal(true),
        narration_time_stretch: z.literal(true),
      })
      .strict(),
    platform_constraints: z
      .object({
        target_product: stringArray,
        development_candidates: stringArray,
        shared_semantic_profile_across_platforms: z.literal(true),
        exact_encoder_and_runtime_members_are_machine_execution_identity: z.literal(true),
        windows_packaged_smoke_required_before_product_release: z.literal(true),
        macos_validation_cannot_substitute_for_windows: z.literal(true),
      })
      .strict(),
    stability: z
      .object({
        status: z.literal('FROZEN_FOR_CODE_F_INTAKE'),
        change_rule: identity,
        old_candidate_after_profile_change: z.literal('STALE'),
      })
      .strict(),
    artifact_status: z
      .object({
        ffmpeg_binary: z.literal('NOT_PRODUCED_BY_CODE_G'),
        license_review: z.literal('CODE_F_REQUIRED'),
        vulnerability_review: z.literal('CODE_F_REQUIRED'),
        distribution_approval: z.literal('CODE_F_REQUIRED'),
        real_render: z.literal('NOT_AUTHORIZED'),
      })
      .strict(),
  })
  .strict();

export type FfmpegRequiredCapabilityProfileV1 = z.infer<
  typeof ffmpegRequiredCapabilityProfileV1Schema
>;

export function computeFfmpegRequiredCapabilityProfileHashV1(value: object): string {
  return sha256(
    canonicalJson(
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'profile_hash')),
    ),
  );
}

export function parseFfmpegRequiredCapabilityProfileV1(
  value: unknown,
): FfmpegRequiredCapabilityProfileV1 {
  const parsed = ffmpegRequiredCapabilityProfileV1Schema.parse(value);
  if (computeFfmpegRequiredCapabilityProfileHashV1(parsed) !== parsed.profile_hash) {
    throw new Error('FFMPEG_REQUIRED_CAPABILITY_PROFILE_HASH_MISMATCH');
  }
  return parsed;
}
