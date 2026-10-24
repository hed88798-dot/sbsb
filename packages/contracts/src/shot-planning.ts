import { z } from 'zod';
import { shotPlanRouteV1Schema } from './timeline-planning.js';

const identity = z.string().trim().min(1).max(256);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const shotPlanCandidateResolutionV1Schema = z.enum(['RESOLVED', 'NEEDS_REVIEW']);
export type ShotPlanCandidateResolutionV1 = z.infer<typeof shotPlanCandidateResolutionV1Schema>;

export const shotPlanCandidateWarningV1Schema = z
  .object({
    code: z.string().trim().min(1).max(128),
    severity: z.enum(['INFORMATIONAL', 'BLOCKING']),
    message: z.string().trim().min(1).max(500),
  })
  .strict();
export type ShotPlanCandidateWarningV1 = z.infer<typeof shotPlanCandidateWarningV1Schema>;

export const shotPlanSemanticContinuityActionV1Schema = z.enum([
  'START_NEW',
  'CONTINUE_PREVIOUS',
  'SWITCH_VISUAL',
]);
export type ShotPlanSemanticContinuityActionV1 = z.infer<
  typeof shotPlanSemanticContinuityActionV1Schema
>;

export const shotPlanSemanticProposalUnitV1Schema = z
  .object({
    exact_fragment: z.string().min(1),
    left_context: z.string().min(1).optional(),
    right_context: z.string().min(1).optional(),
    route: shotPlanRouteV1Schema.nullable(),
    route_state: shotPlanCandidateResolutionV1Schema,
    continuity_action: shotPlanSemanticContinuityActionV1Schema.nullable(),
    continuity_state: shotPlanCandidateResolutionV1Schema,
    rationale: z.string().max(500),
    review_warnings: z.array(shotPlanCandidateWarningV1Schema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.route_state === 'RESOLVED' && value.route === null) {
      context.addIssue({
        code: 'custom',
        message: 'resolved semantic route requires an intentional route',
        path: ['route'],
      });
    }
    if (value.continuity_state === 'RESOLVED' && value.continuity_action === null) {
      context.addIssue({
        code: 'custom',
        message: 'resolved semantic continuity requires an action',
        path: ['continuity_action'],
      });
    }
  });
export type ShotPlanSemanticProposalUnitV1 = z.infer<typeof shotPlanSemanticProposalUnitV1Schema>;

export const shotPlanSemanticProposalV1Schema = z
  .object({
    schema_version: z.literal('1.0'),
    segmentation_state: shotPlanCandidateResolutionV1Schema,
    review_warnings: z.array(shotPlanCandidateWarningV1Schema),
    units: z.array(shotPlanSemanticProposalUnitV1Schema).min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    const first = value.units[0];
    if (first?.continuity_state === 'RESOLVED' && first.continuity_action !== 'START_NEW') {
      context.addIssue({
        code: 'custom',
        message: 'the first resolved unit must start a continuity group',
        path: ['units', 0, 'continuity_action'],
      });
    }
  });
export type ShotPlanSemanticProposalV1 = z.infer<typeof shotPlanSemanticProposalV1Schema>;

export const shotPlanCandidateSlotV1Schema = z
  .object({
    slot_id: identity,
    order_index: z.number().int().nonnegative(),
    source_start: z.number().int().nonnegative(),
    source_end: z.number().int().positive(),
    source_text: z.string().min(1),
    route: shotPlanRouteV1Schema.nullable(),
    route_state: shotPlanCandidateResolutionV1Schema,
    visual_continuity_group_id: identity.nullable(),
    continuity_state: shotPlanCandidateResolutionV1Schema,
    rationale: z.string().max(500),
    review_warnings: z.array(shotPlanCandidateWarningV1Schema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source_end <= value.source_start) {
      context.addIssue({
        code: 'custom',
        message: 'candidate source range must be non-empty',
        path: ['source_end'],
      });
    }
    if (value.route_state === 'RESOLVED' && value.route === null) {
      context.addIssue({
        code: 'custom',
        message: 'resolved route requires an intentional route',
        path: ['route'],
      });
    }
    if (value.continuity_state === 'RESOLVED' && value.visual_continuity_group_id === null) {
      context.addIssue({
        code: 'custom',
        message: 'resolved continuity requires a group identity',
        path: ['visual_continuity_group_id'],
      });
    }
  });
export type ShotPlanCandidateSlotV1 = z.infer<typeof shotPlanCandidateSlotV1Schema>;

export const candidateShotPlanV1Schema = z
  .object({
    schema_version: z.literal('1.0'),
    candidate_id: identity,
    candidate_revision: z.number().int().positive(),
    candidate_status: z.enum(['ACTIVE', 'REJECTED']),
    source_document_id: identity,
    source_document_version: z.number().int().positive(),
    source_document_hash: sha256,
    source_offset_unit: z.literal('UNICODE_CODE_POINT'),
    segmentation_state: shotPlanCandidateResolutionV1Schema,
    review_warnings: z.array(shotPlanCandidateWarningV1Schema),
    slots: z.array(shotPlanCandidateSlotV1Schema).min(1),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
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
          message: 'candidate slots must use increasing order_index',
          path: ['slots', index, 'order_index'],
        });
      }
    }
  });
export type CandidateShotPlanV1 = z.infer<typeof candidateShotPlanV1Schema>;
