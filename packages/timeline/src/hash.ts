import {
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
  type ConfirmedShotPlanV1,
  type NarrationTimingSnapshotV1,
  type TimelinePlanningRequestV1,
} from '@app/contracts';
import { canonicalJson, sha256 } from '@app/domain-media-index';

type ConfirmedShotPlanHashInput = ConfirmedShotPlanV1 | Omit<ConfirmedShotPlanV1, 'shot_plan_hash'>;
type NarrationTimingHashInput =
  | NarrationTimingSnapshotV1
  | Omit<NarrationTimingSnapshotV1, 'timing_snapshot_hash'>;
type TimelineRequestHashInput =
  | TimelinePlanningRequestV1
  | Omit<TimelinePlanningRequestV1, 'timeline_request_hash'>;

function canonicalSelfHash(value: object, selfHashField: string): string {
  const preimage = Object.fromEntries(
    Object.entries(value).filter(([field]) => field !== selfHashField),
  );
  return sha256(canonicalJson(preimage));
}

export function computeConfirmedShotPlanHash(value: ConfirmedShotPlanHashInput): string {
  return canonicalSelfHash(value, 'shot_plan_hash');
}

export function computeNarrationTimingSnapshotHash(value: NarrationTimingHashInput): string {
  return canonicalSelfHash(value, 'timing_snapshot_hash');
}

export function computeTimelinePlanningRequestHash(value: TimelineRequestHashInput): string {
  return canonicalSelfHash(value, 'timeline_request_hash');
}

export function parseConfirmedShotPlanV1(value: unknown): ConfirmedShotPlanV1 {
  const parsed = confirmedShotPlanV1Schema.parse(value);
  if (computeConfirmedShotPlanHash(parsed) !== parsed.shot_plan_hash) {
    throw new Error('CONFIRMED_SHOT_PLAN_HASH_MISMATCH');
  }
  return parsed;
}

export function parseNarrationTimingSnapshotV1(value: unknown): NarrationTimingSnapshotV1 {
  const parsed = narrationTimingSnapshotV1Schema.parse(value);
  if (computeNarrationTimingSnapshotHash(parsed) !== parsed.timing_snapshot_hash) {
    throw new Error('NARRATION_TIMING_SNAPSHOT_HASH_MISMATCH');
  }
  return parsed;
}

export function parseTimelinePlanningRequestV1(value: unknown): TimelinePlanningRequestV1 {
  const parsed = timelinePlanningRequestV1Schema.parse(value);
  parseConfirmedShotPlanV1(parsed.confirmed_shot_plan);
  parseNarrationTimingSnapshotV1(parsed.narration_timing_snapshot);
  if (computeTimelinePlanningRequestHash(parsed) !== parsed.timeline_request_hash) {
    throw new Error('TIMELINE_PLANNING_REQUEST_HASH_MISMATCH');
  }
  return parsed;
}
