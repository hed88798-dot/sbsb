import type {
  CanonicalSourceDocumentV1,
  ShotPlanRouteV1,
  ShotPlanSemanticProposalV1,
} from '@app/contracts';
import type { CandidateSlotDraftV1 } from './shot-plan-authority-service.js';

export class ShotPlanProposalStructuralError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ShotPlanProposalStructuralError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ShotPlanProposalStructuralError(code);
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

function exactSlice(points: string[], start: number, end: number): string {
  return points.slice(start, end).join('');
}

function whitespaceOnly(value: string): boolean {
  return /^\p{White_Space}*$/u.test(value);
}

function occurrences(source: string[], fragment: string[]): number[] {
  const results: number[] = [];
  for (let start = 0; start <= source.length - fragment.length; start += 1) {
    if (fragment.every((point, index) => source[start + index] === point)) results.push(start);
  }
  return results;
}

function anchorMatches(
  source: string[],
  start: number,
  fragmentLength: number,
  leftContext: string | undefined,
  rightContext: string | undefined,
): boolean {
  if (leftContext !== undefined) {
    const left = codePoints(leftContext);
    if (start < left.length || exactSlice(source, start - left.length, start) !== leftContext) {
      return false;
    }
  }
  if (rightContext !== undefined) {
    const right = codePoints(rightContext);
    const end = start + fragmentLength;
    if (exactSlice(source, end, end + right.length) !== rightContext) return false;
  }
  return true;
}

export interface ReconciledSemanticProposalV1 {
  segmentation_state: ShotPlanSemanticProposalV1['segmentation_state'];
  review_warnings: ShotPlanSemanticProposalV1['review_warnings'];
  slots: CandidateSlotDraftV1[];
}

export function reconcileSemanticShotPlanProposal(
  source: CanonicalSourceDocumentV1,
  proposal: ShotPlanSemanticProposalV1,
  options: { continuityGroupId: (index: number) => string },
): ReconciledSemanticProposalV1 {
  const sourcePoints = codePoints(source.text);
  let cursor = 0;
  let currentGroup: string | null = null;
  let currentGroupRoute: ShotPlanRouteV1 | null = null;
  let groupIndex = 0;

  const slots = proposal.units.map((unit, orderIndex): CandidateSlotDraftV1 => {
    const fragment = codePoints(unit.exact_fragment);
    const anchored = occurrences(sourcePoints, fragment).filter((start) =>
      anchorMatches(sourcePoints, start, fragment.length, unit.left_context, unit.right_context),
    );
    const legal = anchored.filter((start) => start >= cursor);
    if (legal.length === 0) {
      if (anchored.length > 0) return fail('SHOT_PLAN_PROPOSAL_ORDER_OR_OVERLAP_INVALID');
      return fail('SHOT_PLAN_PROPOSAL_EXACT_SOURCE_MISMATCH');
    }
    if (legal.length > 1) return fail('SHOT_PLAN_PROPOSAL_SOURCE_BINDING_AMBIGUOUS');

    const start = legal[0]!;
    const end = start + fragment.length;
    if (!whitespaceOnly(exactSlice(sourcePoints, cursor, start))) {
      return fail('SHOT_PLAN_PROPOSAL_NON_WHITESPACE_GAP');
    }

    let continuityGroupId: string | null = null;
    if (unit.continuity_state === 'RESOLVED') {
      switch (unit.continuity_action) {
        case 'START_NEW':
        case 'SWITCH_VISUAL':
          currentGroup = options.continuityGroupId(groupIndex);
          groupIndex += 1;
          currentGroupRoute = unit.route_state === 'RESOLVED' ? unit.route : null;
          continuityGroupId = currentGroup;
          break;
        case 'CONTINUE_PREVIOUS':
          if (currentGroup === null || currentGroupRoute === null || unit.route === null) {
            return fail('SHOT_PLAN_PROPOSAL_CONTINUITY_BASE_UNRESOLVED');
          }
          if (unit.route !== currentGroupRoute) {
            return fail('SHOT_PLAN_PROPOSAL_CROSS_ROUTE_CONTINUE_INVALID');
          }
          continuityGroupId = currentGroup;
          break;
        default:
          return fail('SHOT_PLAN_PROPOSAL_CONTINUITY_ACTION_INVALID');
      }
    } else {
      currentGroup = null;
      currentGroupRoute = null;
    }

    const sourceText = exactSlice(sourcePoints, start, end);
    cursor = end;
    return {
      order_index: orderIndex,
      source_start: start,
      source_end: end,
      source_text: sourceText,
      route: unit.route,
      route_state: unit.route_state,
      visual_continuity_group_id: continuityGroupId,
      continuity_state: unit.continuity_state,
      rationale: unit.rationale,
      review_warnings: unit.review_warnings,
    };
  });

  if (!whitespaceOnly(exactSlice(sourcePoints, cursor, sourcePoints.length))) {
    return fail('SHOT_PLAN_PROPOSAL_NON_WHITESPACE_GAP');
  }

  return {
    segmentation_state: proposal.segmentation_state,
    review_warnings: proposal.review_warnings,
    slots,
  };
}
