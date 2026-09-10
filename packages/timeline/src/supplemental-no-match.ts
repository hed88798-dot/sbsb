import {
  computeTimelineDurationPlanHash,
  validateTimelineDurationPlanV1,
  type TimelineAdditionalSelectionRequirementV1,
  type TimelineDurationPlanV1,
  type TimelineFallbackRequirementV1,
} from './duration-plan.js';

const IDENTITY_MAX_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface TimelineSupplementalNoMatchResolutionV1 {
  parent_duration_plan_hash: string;
  parent_requirement_id: string;
  selection_request_id: string;
  decision_receipt_hash: string;
  batch_id: string;
  video_id: string;
  slot_id: string;
  status: 'NO_MATCH';
}

export interface TimelineSupplementalNoMatchResolverInputV1 {
  parent_duration_plan: TimelineDurationPlanV1;
  child_duration_plan: TimelineDurationPlanV1;
  supplemental_no_match_resolutions: readonly TimelineSupplementalNoMatchResolutionV1[];
}

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  code: string,
): void {
  const expected = new Set(expectedKeys);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    fail(code);
  }
}

function identity(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > IDENTITY_MAX_LENGTH ||
    value.trim() !== value
  ) {
    fail(code);
  }
  return value;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(code);
  return value;
}

function parseResolution(value: unknown): TimelineSupplementalNoMatchResolutionV1 {
  if (!isRecord(value)) fail('SUPPLEMENTAL_NO_MATCH_RESOLUTION_INVALID');
  assertExactKeys(
    value,
    [
      'parent_duration_plan_hash',
      'parent_requirement_id',
      'selection_request_id',
      'decision_receipt_hash',
      'batch_id',
      'video_id',
      'slot_id',
      'status',
    ],
    'SUPPLEMENTAL_NO_MATCH_RESOLUTION_INVALID',
  );
  if (value.status !== 'NO_MATCH') fail('SUPPLEMENTAL_NO_MATCH_STATUS_REQUIRED');
  return {
    parent_duration_plan_hash: hash(
      value.parent_duration_plan_hash,
      'SUPPLEMENTAL_PARENT_PLAN_HASH_INVALID',
    ),
    parent_requirement_id: identity(
      value.parent_requirement_id,
      'SUPPLEMENTAL_PARENT_REQUIREMENT_ID_INVALID',
    ),
    selection_request_id: identity(
      value.selection_request_id,
      'SUPPLEMENTAL_SELECTION_REQUEST_ID_INVALID',
    ),
    decision_receipt_hash: hash(
      value.decision_receipt_hash,
      'SUPPLEMENTAL_DECISION_RECEIPT_HASH_INVALID',
    ),
    batch_id: identity(value.batch_id, 'SUPPLEMENTAL_BATCH_ID_INVALID'),
    video_id: identity(value.video_id, 'SUPPLEMENTAL_VIDEO_ID_INVALID'),
    slot_id: identity(value.slot_id, 'SUPPLEMENTAL_SLOT_ID_INVALID'),
    status: 'NO_MATCH',
  };
}

function parseInput(value: unknown): {
  parent: TimelineDurationPlanV1;
  child: TimelineDurationPlanV1;
  resolutions: TimelineSupplementalNoMatchResolutionV1[];
} {
  if (!isRecord(value)) fail('SUPPLEMENTAL_NO_MATCH_RESOLVER_INPUT_INVALID');
  assertExactKeys(
    value,
    ['parent_duration_plan', 'child_duration_plan', 'supplemental_no_match_resolutions'],
    'SUPPLEMENTAL_NO_MATCH_RESOLVER_INPUT_INVALID',
  );
  if (!Array.isArray(value.supplemental_no_match_resolutions)) {
    fail('SUPPLEMENTAL_NO_MATCH_RESOLUTIONS_INVALID');
  }
  if (value.supplemental_no_match_resolutions.length === 0) {
    fail('SUPPLEMENTAL_NO_MATCH_RESOLUTIONS_EMPTY');
  }
  return {
    parent: validateTimelineDurationPlanV1(value.parent_duration_plan),
    child: validateTimelineDurationPlanV1(value.child_duration_plan),
    resolutions: value.supplemental_no_match_resolutions.map(parseResolution),
  };
}

function requirementGeometryMatches(
  left: TimelineAdditionalSelectionRequirementV1,
  right: TimelineAdditionalSelectionRequirementV1,
): boolean {
  return (
    left.requirement_id === right.requirement_id &&
    left.kind === right.kind &&
    left.reason === right.reason &&
    left.slot_id === right.slot_id &&
    left.route === right.route &&
    left.visual_continuity_group_id === right.visual_continuity_group_id &&
    left.timeline_start_ms === right.timeline_start_ms &&
    left.timeline_end_ms === right.timeline_end_ms &&
    left.duration_ms === right.duration_ms &&
    left.remaining_duration_ms === right.remaining_duration_ms
  );
}

function uniqueAdditionalRequirement(
  plan: TimelineDurationPlanV1,
  requirementId: string,
  location: 'PARENT' | 'CHILD',
): TimelineAdditionalSelectionRequirementV1 {
  const additional = plan.additional_selection_requirements.filter(
    (requirement) => requirement.requirement_id === requirementId,
  );
  const fallbacks = plan.fallback_requirements.filter(
    (requirement) => requirement.requirement_id === requirementId,
  );
  if (additional.length === 0 && fallbacks.length === 0) {
    fail(`SUPPLEMENTAL_${location}_REQUIREMENT_NOT_FOUND`);
  }
  if (additional.length !== 1 || fallbacks.length !== 0) {
    fail(`SUPPLEMENTAL_${location}_REQUIREMENT_ID_NOT_UNIQUE`);
  }
  return additional[0]!;
}

function fallbackFromResolution(
  requirement: TimelineAdditionalSelectionRequirementV1,
  resolution: TimelineSupplementalNoMatchResolutionV1,
): TimelineFallbackRequirementV1 {
  return {
    requirement_id: requirement.requirement_id,
    kind: 'FALLBACK_REQUIRED',
    source: 'CODE_D_SELECTION_NO_MATCH',
    slot_id: requirement.slot_id,
    pause_id: null,
    route: requirement.route,
    visual_continuity_group_id: requirement.visual_continuity_group_id,
    timeline_start_ms: requirement.timeline_start_ms,
    timeline_end_ms: requirement.timeline_end_ms,
    duration_ms: requirement.duration_ms,
    committed_no_match: {
      selection_request_id: resolution.selection_request_id,
      decision_receipt_hash: resolution.decision_receipt_hash,
      batch_id: resolution.batch_id,
      video_id: resolution.video_id,
    },
  };
}

/**
 * Resolves exact child-plan shortage requirements with already verified committed Code D
 * NO_MATCH facts. Parent and ordinary child plans remain immutable inputs; this function neither
 * reads persistence nor performs material selection.
 */
export function resolveTimelineSupplementalNoMatchV1(value: unknown): TimelineDurationPlanV1 {
  const { parent, child, resolutions } = parseInput(value);
  if (child.planning_request_id === parent.planning_request_id) {
    fail('SUPPLEMENTAL_RESOLUTION_REQUIRES_NEW_PLANNING_REQUEST');
  }

  const parentConsumedSelectionIds = new Set(
    parent.segments.map((segment) => segment.selection_request_id),
  );
  const existingNoMatchRequirementBySelectionId = new Map<string, string>();
  for (const requirement of [...parent.fallback_requirements, ...child.fallback_requirements]) {
    const selectionRequestId = requirement.committed_no_match?.selection_request_id;
    if (!selectionRequestId) continue;
    const existingRequirementId = existingNoMatchRequirementBySelectionId.get(selectionRequestId);
    if (existingRequirementId && existingRequirementId !== requirement.requirement_id) {
      fail('SUPPLEMENTAL_D_DECISION_REUSED_FOR_MULTIPLE_REQUIREMENTS');
    }
    existingNoMatchRequirementBySelectionId.set(selectionRequestId, requirement.requirement_id);
  }
  const resolvedRequirementIds = new Set<string>();
  const supplementalSelectionIds = new Set<string>();
  const fallbackByRequirementId = new Map<string, TimelineFallbackRequirementV1>();

  for (const resolution of resolutions) {
    if (resolution.parent_duration_plan_hash !== parent.duration_plan_hash) {
      fail('SUPPLEMENTAL_PARENT_PLAN_HASH_MISMATCH');
    }
    if (resolvedRequirementIds.has(resolution.parent_requirement_id)) {
      fail('SUPPLEMENTAL_PARENT_REQUIREMENT_RESOLVED_MORE_THAN_ONCE');
    }
    if (supplementalSelectionIds.has(resolution.selection_request_id)) {
      fail('SUPPLEMENTAL_D_DECISION_REUSED_FOR_MULTIPLE_REQUIREMENTS');
    }
    if (parentConsumedSelectionIds.has(resolution.selection_request_id)) {
      fail('SUPPLEMENTAL_D_DECISION_REUSES_PARENT_SELECTION');
    }
    const existingRequirementId = existingNoMatchRequirementBySelectionId.get(
      resolution.selection_request_id,
    );
    if (
      existingRequirementId !== undefined &&
      existingRequirementId !== resolution.parent_requirement_id
    ) {
      fail('SUPPLEMENTAL_D_DECISION_REUSED_FOR_MULTIPLE_REQUIREMENTS');
    }

    const parentRequirement = uniqueAdditionalRequirement(
      parent,
      resolution.parent_requirement_id,
      'PARENT',
    );
    const childRequirement = uniqueAdditionalRequirement(
      child,
      resolution.parent_requirement_id,
      'CHILD',
    );
    if (
      parentRequirement.duration_ms !== parentRequirement.remaining_duration_ms ||
      childRequirement.duration_ms !== childRequirement.remaining_duration_ms
    ) {
      fail('SUPPLEMENTAL_REQUIREMENT_GEOMETRY_INVALID');
    }
    if (!requirementGeometryMatches(parentRequirement, childRequirement)) {
      fail('SUPPLEMENTAL_REQUIREMENT_GEOMETRY_MISMATCH');
    }
    if (resolution.slot_id !== parentRequirement.slot_id) {
      fail('SUPPLEMENTAL_NO_MATCH_SLOT_ID_MISMATCH');
    }

    resolvedRequirementIds.add(resolution.parent_requirement_id);
    supplementalSelectionIds.add(resolution.selection_request_id);
    fallbackByRequirementId.set(
      resolution.parent_requirement_id,
      fallbackFromResolution(childRequirement, resolution),
    );
  }

  const convertedFallbacks = child.additional_selection_requirements
    .filter((requirement) => fallbackByRequirementId.has(requirement.requirement_id))
    .map((requirement) => fallbackByRequirementId.get(requirement.requirement_id)!);
  const unresolvedAdditional = child.additional_selection_requirements.filter(
    (requirement) => !fallbackByRequirementId.has(requirement.requirement_id),
  );
  const preimage: Omit<TimelineDurationPlanV1, 'duration_plan_hash'> = {
    schema_version: child.schema_version,
    planning_request_id: child.planning_request_id,
    planning_facts_hash: child.planning_facts_hash,
    policy_id: child.policy_id,
    policy_version: child.policy_version,
    policy_snapshot_hash: child.policy_snapshot_hash,
    source_consumption_strategy: child.source_consumption_strategy,
    segments: child.segments,
    fallback_requirements: [...child.fallback_requirements, ...convertedFallbacks],
    additional_selection_requirements: unresolvedAdditional,
    unused_committed_selection_refs: child.unused_committed_selection_refs,
    execution_domain_intervals: child.execution_domain_intervals,
    slot_transitions: child.slot_transitions,
  };
  return validateTimelineDurationPlanV1({
    ...preimage,
    duration_plan_hash: computeTimelineDurationPlanHash(preimage),
  });
}
