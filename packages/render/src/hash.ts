import { canonicalJson, sha256 } from '@app/domain-media-index';
import {
  logicalRenderPlanV1Schema,
  narrationAudioArtifactV1Schema,
  renderExecutionSnapshotV1Schema,
  renderPolicyV1Schema,
  renderReceiptV1Schema,
  type LogicalRenderPlanV1,
  type NarrationAudioArtifactV1,
  type RenderExecutionSnapshotV1,
  type RenderPolicyV1,
  type RenderReceiptV1,
} from './contracts.js';

function selfHash(value: object, field: string): string {
  return sha256(
    canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))),
  );
}

export function computeRenderPolicyHashV1(
  value: RenderPolicyV1 | Omit<RenderPolicyV1, 'policy_hash'>,
): string {
  return selfHash(value, 'policy_hash');
}

export function parseRenderPolicyV1(value: unknown): RenderPolicyV1 {
  const parsed = renderPolicyV1Schema.parse(value);
  if (computeRenderPolicyHashV1(parsed) !== parsed.policy_hash) {
    throw new Error('RENDER_POLICY_HASH_MISMATCH');
  }
  if (parsed.visual_fit.mode === 'SCALE_PAD' && parsed.visual_fit.crop !== 'DISABLED') {
    throw new Error('RENDER_POLICY_VISUAL_FIT_CONFLICT');
  }
  return parsed;
}

export function computeNarrationAudioArtifactHashV1(
  value: NarrationAudioArtifactV1 | Omit<NarrationAudioArtifactV1, 'artifact_hash'>,
): string {
  return selfHash(value, 'artifact_hash');
}

export function parseNarrationAudioArtifactV1(value: unknown): NarrationAudioArtifactV1 {
  const parsed = narrationAudioArtifactV1Schema.parse(value);
  if (computeNarrationAudioArtifactHashV1(parsed) !== parsed.artifact_hash) {
    throw new Error('NARRATION_AUDIO_ARTIFACT_HASH_MISMATCH');
  }
  if (parsed.duration_measurement === 'SAMPLE_COUNT_DERIVED') {
    const numerator = BigInt(parsed.sample_count!) * 1000n;
    const denominator = BigInt(parsed.sample_rate_hz);
    const durationMs = Number((2n * numerator + denominator) / (2n * denominator));
    if (durationMs !== parsed.duration_ms) {
      throw new Error('NARRATION_AUDIO_SAMPLE_DURATION_MISMATCH');
    }
  }
  return parsed;
}

export function computeLogicalRenderHashV1(
  value: LogicalRenderPlanV1 | Omit<LogicalRenderPlanV1, 'logical_render_hash'>,
): string {
  return selfHash(value, 'logical_render_hash');
}

export function parseLogicalRenderPlanV1(value: unknown): LogicalRenderPlanV1 {
  const parsed = logicalRenderPlanV1Schema.parse(value);
  if (computeLogicalRenderHashV1(parsed) !== parsed.logical_render_hash) {
    throw new Error('LOGICAL_RENDER_HASH_MISMATCH');
  }
  return parsed;
}

export function computeExecutionSnapshotHashV1(
  value: RenderExecutionSnapshotV1 | Omit<RenderExecutionSnapshotV1, 'execution_snapshot_hash'>,
): string {
  return selfHash(value, 'execution_snapshot_hash');
}

export function parseRenderExecutionSnapshotV1(value: unknown): RenderExecutionSnapshotV1 {
  const parsed = renderExecutionSnapshotV1Schema.parse(value);
  if (computeExecutionSnapshotHashV1(parsed) !== parsed.execution_snapshot_hash) {
    throw new Error('EXECUTION_SNAPSHOT_HASH_MISMATCH');
  }
  return parsed;
}

export function computeRenderReceiptHashV1(
  value: RenderReceiptV1 | Omit<RenderReceiptV1, 'receipt_hash'>,
): string {
  return selfHash(value, 'receipt_hash');
}

export function parseRenderReceiptV1(value: unknown): RenderReceiptV1 {
  const parsed = renderReceiptV1Schema.parse(value);
  if (computeRenderReceiptHashV1(parsed) !== parsed.receipt_hash) {
    throw new Error('RENDER_RECEIPT_HASH_MISMATCH');
  }
  return parsed;
}
