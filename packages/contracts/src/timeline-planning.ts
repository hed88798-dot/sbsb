import { z } from 'zod';

const schemaVersion = z.literal('1.0');
const identity = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const entityVersion = z.number().int().positive();

export const shotPlanRouteV1Schema = z.enum(['ANIMAL', 'PRODUCT', 'NO_MATCH']);
export type ShotPlanRouteV1 = z.infer<typeof shotPlanRouteV1Schema>;

export const confirmedShotPlanSlotV1Schema = z
  .object({
    slot_id: identity,
    order_index: z.number().int().nonnegative(),
    source_start: z.number().int().nonnegative(),
    source_end: z.number().int().positive(),
    source_text: z.string().min(1),
    route: shotPlanRouteV1Schema,
    visual_continuity_group_id: identity,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source_end <= value.source_start) {
      context.addIssue({
        code: 'custom',
        message: 'source range must use non-empty [start, end) semantics',
        path: ['source_end'],
      });
    }
  });
export type ConfirmedShotPlanSlotV1 = z.infer<typeof confirmedShotPlanSlotV1Schema>;

export const confirmedShotPlanV1Schema = z
  .object({
    schema_version: schemaVersion,
    shot_plan_id: identity,
    shot_plan_version: entityVersion,
    shot_plan_hash: sha256,
    source_document_id: identity,
    source_document_version: entityVersion,
    source_document_hash: sha256,
    review_state: z.literal('CONFIRMED'),
    source_offset_unit: z.literal('UNICODE_CODE_POINT'),
    slots: z.array(confirmedShotPlanSlotV1Schema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const slotIds = new Set<string>();
    const orderIndexes = new Set<number>();
    for (const [index, slot] of value.slots.entries()) {
      if (slotIds.has(slot.slot_id)) {
        context.addIssue({
          code: 'custom',
          message: 'slot_id must be unique',
          path: ['slots', index],
        });
      }
      slotIds.add(slot.slot_id);
      if (orderIndexes.has(slot.order_index)) {
        context.addIssue({
          code: 'custom',
          message: 'order_index must be unique',
          path: ['slots', index, 'order_index'],
        });
      }
      orderIndexes.add(slot.order_index);
      const previous = value.slots[index - 1];
      if (previous && previous.order_index >= slot.order_index) {
        context.addIssue({
          code: 'custom',
          message: 'slots must be ordered by strictly increasing order_index',
          path: ['slots', index, 'order_index'],
        });
      }
    }
  });
export type ConfirmedShotPlanV1 = z.infer<typeof confirmedShotPlanV1Schema>;

export const narrationSlotTimingV1Schema = z
  .object({
    slot_id: identity,
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.end_ms <= value.start_ms) {
      context.addIssue({
        code: 'custom',
        message: 'end_ms must be greater than start_ms',
        path: ['end_ms'],
      });
    }
  });
export type NarrationSlotTimingV1 = z.infer<typeof narrationSlotTimingV1Schema>;

export const narrationPauseIntervalV1Schema = z
  .object({
    pause_id: identity,
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.end_ms <= value.start_ms) {
      context.addIssue({
        code: 'custom',
        message: 'end_ms must be greater than start_ms',
        path: ['end_ms'],
      });
    }
  });
export type NarrationPauseIntervalV1 = z.infer<typeof narrationPauseIntervalV1Schema>;

interface OrderedInterval {
  start_ms: number;
  end_ms: number;
}

function validateOrderedIntervals(
  intervals: readonly OrderedInterval[],
  totalDurationMs: number,
  path: 'slot_timings' | 'pause_intervals',
  context: z.core.$RefinementCtx<unknown>,
): void {
  for (const [index, interval] of intervals.entries()) {
    if (interval.end_ms > totalDurationMs) {
      context.addIssue({
        code: 'custom',
        message: `${path} must be within total_duration_ms`,
        path: [path, index, 'end_ms'],
      });
    }
    const previous = intervals[index - 1];
    if (previous && interval.start_ms < previous.start_ms) {
      context.addIssue({
        code: 'custom',
        message: `${path} must be ordered by start_ms`,
        path: [path, index, 'start_ms'],
      });
    }
    if (previous && interval.start_ms < previous.end_ms) {
      context.addIssue({
        code: 'custom',
        message: `${path} must not overlap`,
        path: [path, index, 'start_ms'],
      });
    }
  }
}

export const narrationTimingSnapshotV1Schema = z
  .object({
    schema_version: schemaVersion,
    timing_snapshot_id: identity,
    timing_snapshot_version: entityVersion,
    timing_snapshot_hash: sha256,
    timing_kind: z.literal('EXACT'),
    shot_plan_id: identity,
    shot_plan_hash: sha256,
    source_document_id: identity,
    source_document_hash: sha256,
    narration_audio_id: identity,
    narration_audio_hash: sha256,
    total_duration_ms: z.number().int().positive(),
    slot_timings: z.array(narrationSlotTimingV1Schema).min(1),
    pause_intervals: z.array(narrationPauseIntervalV1Schema),
  })
  .strict()
  .superRefine((value, context) => {
    const slotIds = new Set<string>();
    for (const [index, timing] of value.slot_timings.entries()) {
      if (slotIds.has(timing.slot_id)) {
        context.addIssue({
          code: 'custom',
          message: 'slot timing slot_id must be unique',
          path: ['slot_timings', index, 'slot_id'],
        });
      }
      slotIds.add(timing.slot_id);
    }
    const pauseIds = new Set<string>();
    for (const [index, pause] of value.pause_intervals.entries()) {
      if (pauseIds.has(pause.pause_id)) {
        context.addIssue({
          code: 'custom',
          message: 'pause_id must be unique',
          path: ['pause_intervals', index, 'pause_id'],
        });
      }
      pauseIds.add(pause.pause_id);
    }
    validateOrderedIntervals(value.slot_timings, value.total_duration_ms, 'slot_timings', context);
    validateOrderedIntervals(
      value.pause_intervals,
      value.total_duration_ms,
      'pause_intervals',
      context,
    );
    for (const [pauseIndex, pause] of value.pause_intervals.entries()) {
      if (
        value.slot_timings.some(
          (timing) => pause.start_ms < timing.end_ms && timing.start_ms < pause.end_ms,
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'pause intervals must be disjoint from slot timings',
          path: ['pause_intervals', pauseIndex],
        });
      }
    }
  });
export type NarrationTimingSnapshotV1 = z.infer<typeof narrationTimingSnapshotV1Schema>;

export const committedMaterialSelectionRefV1Schema = z
  .object({
    selection_request_id: identity,
    decision_receipt_hash: sha256,
    asset_id: identity,
    shot_id: identity,
  })
  .strict();
export type CommittedMaterialSelectionRefV1 = z.infer<typeof committedMaterialSelectionRefV1Schema>;

export const timelinePlanningRequestV1Schema = z
  .object({
    schema_version: schemaVersion,
    planning_request_id: identity,
    timeline_request_hash: sha256,
    confirmed_shot_plan: confirmedShotPlanV1Schema,
    narration_timing_snapshot: narrationTimingSnapshotV1Schema,
    committed_selection_refs: z.array(committedMaterialSelectionRefV1Schema),
    timeline_policy_id: identity,
    timeline_policy_version: identity,
    timeline_policy_snapshot_hash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const plan = value.confirmed_shot_plan;
    const timing = value.narration_timing_snapshot;
    if (
      timing.shot_plan_id !== plan.shot_plan_id ||
      timing.shot_plan_hash !== plan.shot_plan_hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'narration timing must bind the exact confirmed shot plan',
        path: ['narration_timing_snapshot', 'shot_plan_id'],
      });
    }
    if (
      timing.source_document_id !== plan.source_document_id ||
      timing.source_document_hash !== plan.source_document_hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'narration timing must bind the exact source document',
        path: ['narration_timing_snapshot', 'source_document_id'],
      });
    }
    const planSlotIds = plan.slots.map((slot) => slot.slot_id);
    const timingSlotIds = timing.slot_timings.map((slot) => slot.slot_id);
    for (const [index, slotId] of timingSlotIds.entries()) {
      if (!planSlotIds.includes(slotId)) {
        context.addIssue({
          code: 'custom',
          message: 'narration timing contains an unknown slot_id',
          path: ['narration_timing_snapshot', 'slot_timings', index, 'slot_id'],
        });
      }
    }
    if (
      planSlotIds.length !== timingSlotIds.length ||
      planSlotIds.some((slotId, index) => timingSlotIds[index] !== slotId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'slot timings must cover confirmed slots in confirmed order',
        path: ['narration_timing_snapshot', 'slot_timings'],
      });
    }
    const selectionRequestIds = new Set<string>();
    for (const [index, selection] of value.committed_selection_refs.entries()) {
      if (selectionRequestIds.has(selection.selection_request_id)) {
        context.addIssue({
          code: 'custom',
          message: 'each physical selection reference must be unique',
          path: ['committed_selection_refs', index, 'selection_request_id'],
        });
      }
      selectionRequestIds.add(selection.selection_request_id);
    }
  });
export type TimelinePlanningRequestV1 = z.infer<typeof timelinePlanningRequestV1Schema>;
