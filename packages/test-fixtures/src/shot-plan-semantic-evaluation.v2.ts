import { shotPlanSemanticProposalV1Schema } from '@app/contracts';
import {
  evaluateShotPlanSemanticProposalV1,
  shotPlanSemanticGoldenFixturesV1,
  type SemanticGoldenAlternativeV1,
  type ShotPlanSemanticEvaluationV1,
  type ShotPlanSemanticGoldenFixtureV1,
} from './shot-plan-semantic.js';

export const LEGACY_SEMANTIC_EVALUATION_V1 = 'SHOT_PLAN_SEMANTIC_EVALUATION_V1';
export const JOINT_ALTERNATIVE_EVALUATION_V2 = 'SHOT_PLAN_ALTERNATIVE_JOINT_MATCHING_V2';
export const LEGACY_GOLDEN_SHA256 =
  'cae36779b5ba91a8ed774e7302bb7ddffaae2bc40ac439dba17828427464d498';
export const JOINT_GOLDEN_SHA256 =
  '99bf556ee381cd561ec82bd3f9986bd2698d5bef8d9c5932e4860facbbd1aa62';
export type ShotPlanGoldenEvaluationPolicy =
  | typeof LEGACY_SEMANTIC_EVALUATION_V1
  | typeof JOINT_ALTERNATIVE_EVALUATION_V2;

/** Evaluation-only revision: never mutate the historical fixture array. */
export const shotPlanSemanticGoldenFixturesV2: ShotPlanSemanticGoldenFixtureV1[] = structuredClone(
  shotPlanSemanticGoldenFixturesV1,
).map((fixture) => {
  if (fixture.id === 'vet-commerce-context-applicable-animal') {
    fixture.acceptable_alternatives.push({
      units: [
        {
          exact_fragment: '这套饲养方法适用于猪，',
          route: 'NO_MATCH',
          route_state: 'RESOLVED',
          continuity_state: 'RESOLVED',
          continuity_actions: ['START_NEW'],
        },
        {
          exact_fragment: '画面展示健康猪群活动。',
          route: 'ANIMAL',
          route_state: 'RESOLVED',
          continuity_state: 'RESOLVED',
          continuity_actions: ['SWITCH_VISUAL'],
        },
      ],
    });
  }
  return fixture;
});

export interface ShotPlanSemanticEvaluationV2 extends ShotPlanSemanticEvaluationV1 {
  evaluation_policy: typeof JOINT_ALTERNATIVE_EVALUATION_V2;
  joint_alternative_match: boolean;
  matched_alternative_indexes: number[];
  overall_pass: boolean;
}

/** An overall PASS must come from a single complete alternative, never dimension mixing. */
export function evaluateShotPlanSemanticProposalV2(
  fixture: ShotPlanSemanticGoldenFixtureV1,
  rawProposal: unknown,
): ShotPlanSemanticEvaluationV2 {
  const diagnostics = evaluateShotPlanSemanticProposalV1(fixture, rawProposal);
  const parsed = shotPlanSemanticProposalV1Schema.safeParse(rawProposal);
  const alternatives = parsed.success
    ? fixture.acceptable_alternatives.filter(
        (alternative) =>
          alternative.units.length === parsed.data.units.length &&
          alternative.units.every(
            (unit, index) => unit.exact_fragment === parsed.data.units[index]!.exact_fragment,
          ),
      )
    : [];
  const routesMatch = (alternative: SemanticGoldenAlternativeV1) =>
    parsed.success &&
    alternative.units.every((unit, index) => {
      const actual = parsed.data.units[index]!;
      return unit.route === actual.route && (unit.route_state ?? 'RESOLVED') === actual.route_state;
    });
  const continuityMatches = (alternative: SemanticGoldenAlternativeV1) =>
    parsed.success &&
    alternative.units.every((unit, index) => {
      const actual = parsed.data.units[index]!;
      return (
        (unit.continuity_state ?? 'RESOLVED') === actual.continuity_state &&
        (unit.continuity_actions.length === 0
          ? actual.continuity_action === null
          : actual.continuity_action !== null &&
            unit.continuity_actions.includes(actual.continuity_action))
      );
    });
  const matched = alternatives.filter(
    (alternative) => routesMatch(alternative) && continuityMatches(alternative),
  );
  const route = diagnostics.route && alternatives.some(routesMatch);
  const continuity = alternatives.some(continuityMatches);
  const jointMatch = matched.length > 0;
  return {
    ...diagnostics,
    route,
    continuity,
    evaluation_policy: JOINT_ALTERNATIVE_EVALUATION_V2,
    joint_alternative_match: jointMatch,
    matched_alternative_indexes: matched.map((alternative) =>
      fixture.acceptable_alternatives.indexOf(alternative),
    ),
    overall_pass:
      diagnostics.structural_validity &&
      diagnostics.segmentation &&
      route &&
      continuity &&
      diagnostics.needs_review &&
      diagnostics.forbidden_outcome_violations.length === 0 &&
      jointMatch,
  };
}

/** The caller must explicitly select a supported revision; unknown versions fail closed. */
export function selectShotPlanGoldenEvaluationPolicy(policy: string) {
  switch (policy) {
    case LEGACY_SEMANTIC_EVALUATION_V1:
      return {
        policy,
        golden_revision: 'SHOT_PLAN_SEMANTIC_GOLDEN_V1',
        fixture_authority: 'shotPlanSemanticGoldenFixturesV1',
        evaluator_authority: 'evaluateShotPlanSemanticProposalV1',
        fixture_sha256: LEGACY_GOLDEN_SHA256,
        fixtures: shotPlanSemanticGoldenFixturesV1,
        evaluate: evaluateShotPlanSemanticProposalV1,
      } as const;
    case JOINT_ALTERNATIVE_EVALUATION_V2:
      return {
        policy,
        golden_revision: 'SHOT_PLAN_SEMANTIC_GOLDEN_V2',
        fixture_authority: 'shotPlanSemanticGoldenFixturesV2',
        evaluator_authority: 'evaluateShotPlanSemanticProposalV2',
        fixture_sha256: JOINT_GOLDEN_SHA256,
        fixtures: shotPlanSemanticGoldenFixturesV2,
        evaluate: evaluateShotPlanSemanticProposalV2,
      } as const;
    default:
      throw new Error('GOLDEN_UNSUPPORTED_EVALUATION_POLICY');
  }
}
