import {
  type LogicalRenderPlanV1,
  type RenderExecutionSnapshotV1,
  type RenderPolicyV1,
  type RenderReceiptV1,
  type RenderOutputArtifactV1,
  type RenderVerificationFactsV1,
  type RenderRuntimeIdentityV1,
} from './contracts.js';
import {
  computeRenderReceiptHashV1,
  parseLogicalRenderPlanV1,
  parseRenderExecutionSnapshotV1,
  parseRenderPolicyV1,
} from './hash.js';

import { FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2 } from './capability-profile.js';

export const CODE_G_R1B_APPROVED_RUNTIME_V2_ID = 'code-f-ffmpeg-render-windows-x86_64-34699695106';
export const CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256 =
  '7fc910c87e37502f3ff1f7e56c0ee470d91597aece9cd873880ce3c477d0a933';
export const CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256 =
  '641b8649c3d11702942a4b649d6ecee35231e04e09ce50a8d74b8c46b5295c4e';
export const CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256 =
  '5e57ef59bdf1c3d8cf17966b100358f4a16b96edb6c7dc7857e9d85bf3f03205';
export const CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256 =
  '9df0552354769ab18846e5031caa77488f2c0b2fd1c882a7587af06cc0e71db9';
export const CODE_G_R1B_APPROVED_RUNTIME_V2_TRANSPORT_TAR_SHA256 =
  'a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01';
export const CODE_G_R1B_APPROVED_BUILD_PROFILE_V2_SHA256 =
  '40ebffb4307b1c2ec141ffbdd3be2e2c52545090ea1f776267fa445952b3657c';
export const CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256 =
  '4f394178882d19442db7a03d9092fb2e662b449700fe516e1d3e36c9d61a2b4c';

export interface ApprovedRuntimeV2ReceiptBindings {
  runtime_id: typeof CODE_G_R1B_APPROVED_RUNTIME_V2_ID;
  runtime_manifest_sha256: typeof CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256;
  runtime_identity_sha256: typeof CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256;
  transport_tar_sha256: typeof CODE_G_R1B_APPROVED_RUNTIME_V2_TRANSPORT_TAR_SHA256;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function verifyRuntimeV2ApprovalReceipt(input: {
  receipt_sha256: string;
  receipt: unknown;
}): ApprovedRuntimeV2ReceiptBindings {
  const value = objectRecord(input.receipt);
  const authority = objectRecord(value?.authority);
  const candidate = objectRecord(value?.candidate);
  const entrypoints = objectRecord(candidate?.entrypoints);
  const durableArtifact = objectRecord(value?.durable_artifact);
  if (
    input.receipt_sha256 !== CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256 ||
    value?.schema_version !== '2' ||
    value.record_kind !== 'FFMPEG_RENDER_RUNTIME_APPROVAL' ||
    value.approval_version !== 2 ||
    value.approval_status !== 'APPROVED' ||
    value.approval_scope !== 'STANDALONE_RUNTIME_INTAKE_ONLY' ||
    value.platform !== 'windows-x86_64' ||
    authority?.code_g_profile_hash !== FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash ||
    authority.code_f_build_profile_hash !== CODE_G_R1B_APPROVED_BUILD_PROFILE_V2_SHA256 ||
    candidate?.runtime_id !== CODE_G_R1B_APPROVED_RUNTIME_V2_ID ||
    candidate.runtime_manifest_sha256 !== CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256 ||
    candidate.runtime_identity_sha256 !== CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256 ||
    entrypoints?.['ffmpeg.exe'] !== CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256 ||
    entrypoints['ffprobe.exe'] !== CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256 ||
    candidate.transport_tar_sha256 !== CODE_G_R1B_APPROVED_RUNTIME_V2_TRANSPORT_TAR_SHA256 ||
    durableArtifact?.artifact_sha256 !== CODE_G_R1B_APPROVED_RUNTIME_V2_TRANSPORT_TAR_SHA256
  ) {
    throw new Error('RENDER_RUNTIME_V2_APPROVAL_RECEIPT_INVALID');
  }
  return {
    runtime_id: CODE_G_R1B_APPROVED_RUNTIME_V2_ID,
    runtime_manifest_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
    runtime_identity_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256,
    transport_tar_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_TRANSPORT_TAR_SHA256,
  };
}

export function assertApprovedRuntimeV2Identity(identity: RenderRuntimeIdentityV1): void {
  if (
    identity.approval_status !== 'APPROVED' ||
    identity.runtime_id !== CODE_G_R1B_APPROVED_RUNTIME_V2_ID ||
    identity.platform !== 'win32' ||
    identity.architecture !== 'x64' ||
    identity.capability_profile_id !== FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_id ||
    identity.capability_profile_version !== FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_version ||
    identity.capability_profile_hash !== FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash ||
    identity.ffmpeg_entrypoint_sha256 !== CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256 ||
    identity.ffprobe_entrypoint_sha256 !== CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256 ||
    identity.companion_manifest_sha256 !== CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256
  ) {
    throw new Error('RENDER_EXECUTION_RUNTIME_V2_NOT_APPROVED');
  }
}

export interface FfmpegInvocationV1 {
  executable: string;
  arguments: string[];
  shell: false;
  output_path: string;
  expected_total_output_frames: number;
  progress_protocol: 'FFMPEG_PROGRESS_PIPE_1_V1';
}

export interface FfprobeInvocationV1 {
  executable: string;
  arguments: string[];
  shell: false;
  output_path: string;
}

function decimalMilliseconds(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error('RENDER_EXECUTION_TIME_INVALID');
  }
  const seconds = Math.floor(milliseconds / 1000);
  const remainder = String(milliseconds % 1000).padStart(3, '0');
  return `${seconds}.${remainder}`;
}

function fps(policy: RenderPolicyV1): string {
  return `${policy.timebase.fps_numerator}/${policy.timebase.fps_denominator}`;
}

function filterColor(color: string): string {
  return `0x${color.slice(1)}`;
}

export function ffmpegVideoProfileValueV1(input: {
  encoder: string;
  semantic_profile: RenderPolicyV1['video']['profile'];
}): string {
  const semanticProfile = input.semantic_profile.toLowerCase();
  return input.encoder === 'h264_mf' && semanticProfile === 'high' ? '100' : semanticProfile;
}

function assertLocalFilePath(value: string, code: string): void {
  if (
    value.length === 0 ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ||
    value.includes('\u0000') ||
    (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value))
  ) {
    throw new Error(code);
  }
}

function videoTransform(policy: RenderPolicyV1): string[] {
  const { width, height } = policy.canvas;
  if (policy.visual_fit.mode === 'SCALE_PAD') {
    return [
      `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=w=${width}:h=${height}:x=(ow-iw)/2:y=(oh-ih)/2:color=${filterColor(policy.canvas.background_color)}`,
    ];
  }
  if (policy.visual_fit.crop !== 'POLICY_CENTER_CROP_ONLY') {
    throw new Error('RENDER_EXECUTION_CROP_POLICY_INVALID');
  }
  return [
    `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=w=${width}:h=${height}:x=(iw-ow)/2:y=(ih-oh)/2`,
  ];
}

function validateExecutionBindings(input: {
  plan: LogicalRenderPlanV1;
  snapshot: RenderExecutionSnapshotV1;
  policy: RenderPolicyV1;
}): void {
  const { plan, snapshot, policy } = input;
  if (
    plan.logical_render_hash !== snapshot.logical_render_hash ||
    plan.render_policy_id !== policy.policy_id ||
    plan.render_policy_version !== policy.policy_version ||
    plan.render_policy_hash !== policy.policy_hash
  ) {
    throw new Error('RENDER_EXECUTION_AUTHORITY_BINDING_MISMATCH');
  }
  if (
    plan.fallback_state !== 'NONE' ||
    plan.subtitle_mode !== 'OFF' ||
    plan.source_audio_mode !== 'DROP' ||
    policy.audio.source_video_audio !== 'DROP' ||
    policy.audio.primary_audio !== 'NARRATION_ONLY' ||
    policy.subtitle.mode !== 'OFF'
  ) {
    throw new Error('RENDER_EXECUTION_SCOPE_VIOLATION');
  }
  assertApprovedRuntimeV2Identity(snapshot.runtime_identity);
  let previousFrameEnd = 0;
  for (const [index, operation] of plan.video_operations.entries()) {
    if (
      operation.order_index !== index ||
      operation.frame_start !== previousFrameEnd ||
      operation.frame_end <= operation.frame_start
    ) {
      throw new Error('RENDER_EXECUTION_FRAME_PLAN_INVALID');
    }
    previousFrameEnd = operation.frame_end;
  }
  if (previousFrameEnd !== plan.total_output_frames) {
    throw new Error('RENDER_EXECUTION_TOTAL_FRAME_PLAN_MISMATCH');
  }
}

export function buildFfmpegInvocationV1(input: {
  plan: LogicalRenderPlanV1;
  snapshot: RenderExecutionSnapshotV1;
  policy: RenderPolicyV1;
  partial_output_path: string;
}): FfmpegInvocationV1 {
  const plan = parseLogicalRenderPlanV1(input.plan);
  const snapshot = parseRenderExecutionSnapshotV1(input.snapshot);
  const policy = parseRenderPolicyV1(input.policy);
  validateExecutionBindings({ plan, snapshot, policy });
  assertLocalFilePath(
    snapshot.runtime_identity.ffmpeg_executable_path,
    'RENDER_FFMPEG_PATH_INVALID',
  );
  assertLocalFilePath(input.partial_output_path, 'RENDER_OUTPUT_PATH_INVALID');

  const segmentPaths = new Map<string, string>();
  for (const artifact of snapshot.source_artifacts) {
    assertLocalFilePath(artifact.staged_path, 'RENDER_STAGED_INPUT_PATH_INVALID');
    for (const segmentId of artifact.segment_ids) {
      if (segmentPaths.has(segmentId)) throw new Error('RENDER_STAGED_SEGMENT_BINDING_DUPLICATE');
      segmentPaths.set(segmentId, artifact.staged_path);
    }
  }
  assertLocalFilePath(snapshot.narration_artifact.staged_path, 'RENDER_NARRATION_PATH_INVALID');

  const args: string[] = ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'warning'];
  for (const operation of plan.video_operations) {
    const stagedPath = segmentPaths.get(operation.segment_id);
    if (!stagedPath) throw new Error('RENDER_STAGED_SEGMENT_BINDING_MISSING');
    args.push('-protocol_whitelist', 'file,pipe', '-autorotate', '-i', stagedPath);
  }
  const narrationInputIndex = plan.video_operations.length;
  args.push('-protocol_whitelist', 'file,pipe', '-i', snapshot.narration_artifact.staged_path);

  const filters: string[] = [];
  const segmentLabels: string[] = [];
  for (const [index, operation] of plan.video_operations.entries()) {
    const frameCount = operation.frame_end - operation.frame_start;
    const outputLabel = `vseg${index}`;
    const chain = [
      'setpts=PTS-STARTPTS',
      `trim=start=${decimalMilliseconds(operation.source_start_ms)}:end=${decimalMilliseconds(operation.source_end_ms)}`,
      'setpts=PTS-STARTPTS',
      `fps=fps=${fps(policy)}:round=near`,
      `trim=start_frame=0:end_frame=${frameCount}`,
      'setpts=PTS-STARTPTS',
      ...videoTransform(policy),
      'setsar=ratio=1/1',
      'format=pix_fmts=nv12',
    ];
    filters.push(`[${index}:v:0]${chain.join(',')}[${outputLabel}]`);
    segmentLabels.push(`[${outputLabel}]`);
  }
  filters.push(`${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=1:a=0[vout]`);
  filters.push(
    `[${narrationInputIndex}:a:0]aresample=${policy.audio.sample_rate_hz},` +
      `aformat=sample_rates=${policy.audio.sample_rate_hz}:channel_layouts=${policy.audio.channel_layout},` +
      'asetpts=PTS-STARTPTS[aout]',
  );

  const videoEncoder = 'h264_mf';

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    videoEncoder,
    '-profile:v',
    ffmpegVideoProfileValueV1({
      encoder: videoEncoder,
      semantic_profile: policy.video.profile,
    }),
    '-level:v',
    policy.video.level,
    '-b:v',
    String(policy.video.bitrate_bps),
    '-maxrate:v',
    String(policy.video.bitrate_bps),
    '-bufsize:v',
    String(policy.video.buffer_size_bits),
    '-g',
    String(policy.video.gop_frames),
    '-bf',
    String(policy.video.b_frames),
    '-pix_fmt',
    'nv12',
    '-r',
    fps(policy),
    '-fps_mode',
    'cfr',
    '-c:a',
    'aac',
    '-b:a',
    String(policy.audio.bitrate_bps),
    '-ar',
    String(policy.audio.sample_rate_hz),
    '-ac',
    String(policy.audio.channels),
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
  );
  if (policy.container.fast_start) args.push('-movflags', '+faststart');
  args.push('-progress', 'pipe:1', '-f', 'mp4', '-y', input.partial_output_path);
  return {
    executable: snapshot.runtime_identity.ffmpeg_executable_path,
    arguments: args,
    shell: false,
    output_path: input.partial_output_path,
    expected_total_output_frames: plan.total_output_frames,
    progress_protocol: 'FFMPEG_PROGRESS_PIPE_1_V1',
  };
}

export function buildFfprobeInvocationV1(input: {
  snapshot: RenderExecutionSnapshotV1;
  output_path: string;
}): FfprobeInvocationV1 {
  const snapshot = parseRenderExecutionSnapshotV1(input.snapshot);
  assertLocalFilePath(
    snapshot.runtime_identity.ffprobe_executable_path,
    'RENDER_FFPROBE_PATH_INVALID',
  );
  assertLocalFilePath(input.output_path, 'RENDER_OUTPUT_PATH_INVALID');
  assertApprovedRuntimeV2Identity(snapshot.runtime_identity);
  return {
    executable: snapshot.runtime_identity.ffprobe_executable_path,
    arguments: [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels,channel_layout,nb_frames,nb_read_frames,duration:stream_tags=rotate:stream_side_data=side_data_type,displaymatrix,rotation:format=format_name,duration,size',
      '-of',
      'json',
      input.output_path,
    ],
    shell: false,
    output_path: input.output_path,
  };
}

export function buildRenderReceiptV1(input: {
  receipt_id: string;
  job_id: string;
  plan: LogicalRenderPlanV1;
  snapshot: RenderExecutionSnapshotV1;
  terminal_state: RenderReceiptV1['terminal_state'];
  output_artifact: RenderOutputArtifactV1 | null;
  verification_facts: RenderVerificationFactsV1 | null;
  error_id: string | null;
  created_at: string;
}): RenderReceiptV1 {
  const plan = parseLogicalRenderPlanV1(input.plan);
  const snapshot = parseRenderExecutionSnapshotV1(input.snapshot);
  if (plan.logical_render_hash !== snapshot.logical_render_hash) {
    throw new Error('RENDER_RECEIPT_AUTHORITY_BINDING_MISMATCH');
  }
  const preimage: Omit<RenderReceiptV1, 'receipt_hash'> = {
    schema_version: '1.0',
    receipt_id: input.receipt_id,
    job_id: input.job_id,
    logical_render_hash: plan.logical_render_hash,
    execution_snapshot_hash: snapshot.execution_snapshot_hash,
    timeline_id: plan.timeline_id,
    timeline_version: plan.timeline_version,
    timeline_commit_receipt_hash: plan.timeline_commit_receipt_hash,
    render_policy_id: plan.render_policy_id,
    render_policy_version: plan.render_policy_version,
    render_policy_hash: plan.render_policy_hash,
    runtime_id: snapshot.runtime_identity.runtime_id,
    runtime_manifest_sha256: snapshot.runtime_identity.companion_manifest_sha256,
    terminal_state: input.terminal_state,
    output_artifact: input.output_artifact,
    verification_facts: input.verification_facts,
    error_id: input.error_id,
    created_at: input.created_at,
  };
  return { ...preimage, receipt_hash: computeRenderReceiptHashV1(preimage) };
}
