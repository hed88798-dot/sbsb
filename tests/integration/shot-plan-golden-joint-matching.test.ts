import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ShotPlanSemanticProposalV1 } from '../../packages/contracts/src/index.js';
import {
  evaluateShotPlanSemanticProposalV1,
  shotPlanSemanticGoldenFixturesV1 as historical,
  type SemanticGoldenAlternativeV1,
  type ShotPlanSemanticGoldenFixtureV1,
} from '../../packages/test-fixtures/src/shot-plan-semantic.js';
import {
  evaluateShotPlanSemanticProposalV2 as evaluate,
  JOINT_ALTERNATIVE_EVALUATION_V2,
  JOINT_GOLDEN_SHA256,
  LEGACY_GOLDEN_SHA256,
  LEGACY_SEMANTIC_EVALUATION_V1,
  selectShotPlanGoldenEvaluationPolicy,
  shotPlanSemanticGoldenFixturesV2 as fixtures,
} from '../../packages/test-fixtures/src/shot-plan-semantic-evaluation.v2.js';
import { automatedSemanticPass } from '../helpers/shot-plan-golden-evaluation.js';

function proposal(
  fixture: ShotPlanSemanticGoldenFixtureV1,
  alternative: SemanticGoldenAlternativeV1 = fixture.acceptable_alternatives[0]!,
): ShotPlanSemanticProposalV1 {
  return {
    schema_version: '1.0',
    segmentation_state: fixture.expected_needs_review ? 'NEEDS_REVIEW' : 'RESOLVED',
    review_warnings: [],
    units: alternative.units.map((unit) => ({
      exact_fragment: unit.exact_fragment,
      ...(unit.left_context === undefined ? {} : { left_context: unit.left_context }),
      ...(unit.right_context === undefined ? {} : { right_context: unit.right_context }),
      route: unit.route,
      route_state: unit.route_state ?? 'RESOLVED',
      continuity_state: unit.continuity_state ?? 'RESOLVED',
      continuity_action: unit.continuity_actions[0] ?? null,
      rationale: '确定性合成评测数据。',
      review_warnings: [],
    })),
  };
}

// Exercise every permitted action combination, not only each alternative's first action.
function proposals(fixture: ShotPlanSemanticGoldenFixtureV1, alt: SemanticGoldenAlternativeV1) {
  let values = [proposal(fixture, alt)];
  alt.units.forEach((unit, index) => {
    values = values.flatMap((value) =>
      (unit.continuity_actions.length ? unit.continuity_actions : [null]).map((action) => {
        const copy = structuredClone(value);
        copy.units[index]!.continuity_action = action;
        return copy;
      }),
    );
  });
  return values;
}
const case13 = fixtures[12]!;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('versioned alternative joint matching — deterministic, no Provider', () => {
  it('pins both Golden revisions; changes only the approved #13 alternative', () => {
    expect(hash(historical)).toBe(LEGACY_GOLDEN_SHA256);
    expect(hash(fixtures)).toBe(JOINT_GOLDEN_SHA256);
    expect(fixtures).toHaveLength(30);
    fixtures.forEach((fixture, index) => {
      if (index !== 12) expect(fixture).toEqual(historical[index]);
    });
    expect(case13.acceptable_alternatives).toHaveLength(2);
    expect(case13.acceptable_alternatives[0]).toEqual(historical[12]!.acceptable_alternatives[0]);
    expect({ ...case13, acceptable_alternatives: historical[12]!.acceptable_alternatives }).toEqual(
      historical[12],
    );
    expect(case13).not.toBe(historical[12]);
    expect(fixtures[0]!.acceptable_alternatives).not.toBe(historical[0]!.acceptable_alternatives);
    const authority = JSON.parse(
      readFileSync(
        new URL('../fixtures/shot-plan-semantic-golden-v2-authority.json', import.meta.url),
        'utf8',
      ),
    );
    expect(authority).toMatchObject({
      evaluation_policy: JOINT_ALTERNATIVE_EVALUATION_V2,
      golden_revision: 'SHOT_PLAN_SEMANTIC_GOLDEN_V2',
      previous_fixture_sha256: hash(historical),
      fixture_sha256: hash(fixtures),
      case_count: 30,
    });
  });

  it.each([0, 1])('accepts #13 approved alternative %i as a whole', (index) => {
    const result = evaluate(case13, proposal(case13, case13.acceptable_alternatives[index]!));
    expect(result).toMatchObject({
      evaluation_policy: JOINT_ALTERNATIVE_EVALUATION_V2,
      structural_validity: true,
      segmentation: true,
      route: true,
      continuity: true,
      needs_review: true,
      joint_alternative_match: true,
      matched_alternative_indexes: [index],
      overall_pass: true,
    });
    expect(automatedSemanticPass(result)).toBe(true);
  });

  it.each([
    ['PRODUCT', 'ANIMAL'],
    ['NO_MATCH', 'PRODUCT'],
    ['ANIMAL', 'ANIMAL'],
  ] as const)('rejects unapproved #13 route pair %s → %s', (first, second) => {
    const value = proposal(case13, case13.acceptable_alternatives[1]!);
    value.units[0]!.route = first;
    value.units[1]!.route = second;
    expect(evaluate(case13, value)).toMatchObject({ route: false, overall_pass: false });
    expect(automatedSemanticPass(evaluate(case13, value))).toBe(false);
  });

  it.each([
    'wrong-boundary',
    'extra-unit',
    'missing-unit',
    'reordered',
    'cross-route-continue',
    'wrong-first-action',
    'wrong-route-state',
    'wrong-continuity-state',
  ])('rejects #13 mutation: %s', (mutation) => {
    const value = proposal(case13, case13.acceptable_alternatives[1]!);
    if (mutation === 'wrong-boundary') {
      value.units[0]!.exact_fragment = '这套饲养方法适用于猪';
      value.units[1]!.exact_fragment = '，画面展示健康猪群活动。';
    }
    if (mutation === 'extra-unit') value.units.push({ ...value.units[1]! });
    if (mutation === 'missing-unit') value.units.pop();
    if (mutation === 'reordered') value.units.reverse();
    if (mutation === 'cross-route-continue')
      value.units[1]!.continuity_action = 'CONTINUE_PREVIOUS';
    if (mutation === 'wrong-first-action') value.units[0]!.continuity_action = 'SWITCH_VISUAL';
    if (mutation === 'wrong-route-state') value.units[0]!.route_state = 'NEEDS_REVIEW';
    if (mutation === 'wrong-continuity-state') value.units[1]!.continuity_state = 'NEEDS_REVIEW';
    const result = evaluate(case13, value);
    expect(result.overall_pass).toBe(false);
    expect(automatedSemanticPass(result)).toBe(false);
  });

  it.each(
    fixtures.filter((_, index) => index !== 12).map((fixture) => [fixture.id, fixture] as const),
  )('keeps every approved alternative/action combination of %s', (_id, fixture) => {
    for (const alternative of fixture.acceptable_alternatives) {
      for (const value of proposals(fixture, alternative)) {
        expect(evaluate(fixture, value).overall_pass, JSON.stringify(value)).toBe(true);
        expect(automatedSemanticPass(evaluateShotPlanSemanticProposalV1(fixture, value))).toBe(
          true,
        );
      }
    }
  });

  it('rejects dimension mixing even when each dimension independently finds an alternative', () => {
    const fixture: ShotPlanSemanticGoldenFixtureV1 = {
      ...fixtures[2]!,
      required_facts: [{ text: '猪群', allowed_routes: ['ANIMAL', 'PRODUCT'] }],
      acceptable_alternatives: [
        fixtures[2]!.acceptable_alternatives[0]!,
        {
          units: fixtures[2]!.acceptable_alternatives[0]!.units.map((unit, index) => ({
            ...unit,
            route: 'PRODUCT',
            continuity_actions: [index === 0 ? 'START_NEW' : 'SWITCH_VISUAL'],
          })),
        },
      ],
    };
    fixture.acceptable_alternatives[0] = structuredClone(fixture.acceptable_alternatives[0]!);
    fixture.acceptable_alternatives[0]!.units[1]!.continuity_actions = ['CONTINUE_PREVIOUS'];
    const mixed = proposal(fixture);
    mixed.units[1]!.continuity_action = 'SWITCH_VISUAL';
    const result = evaluate(fixture, mixed);
    expect(result).toMatchObject({
      structural_validity: true,
      segmentation: true,
      route: true,
      continuity: true,
      needs_review: true,
      joint_alternative_match: false,
      matched_alternative_indexes: [],
      overall_pass: false,
    });
    expect(automatedSemanticPass(result)).toBe(false);
    mixed.units[1]!.route = 'PRODUCT';
    expect(evaluate(fixture, mixed).overall_pass).toBe(false);
  });

  it('retains all discovered legacy route counterexamples without relaxing the other 29 fixtures', () => {
    const counterexamples = [];
    for (const [fixtureIndex, fixture] of historical.entries()) {
      if (fixtureIndex === 12) continue;
      for (const [alternativeIndex, alternative] of fixture.acceptable_alternatives.entries()) {
        const baseline = proposal(fixture, alternative);
        for (const [unitIndex, unit] of baseline.units.entries()) {
          for (const route of ['ANIMAL', 'PRODUCT', 'NO_MATCH', null] as const) {
            if (route === unit.route) continue;
            const mutated = structuredClone(baseline);
            mutated.units[unitIndex]!.route = route;
            const current = evaluate(fixtures[fixtureIndex]!, mutated);
            expect(current.overall_pass).toBe(false);
            if (automatedSemanticPass(evaluateShotPlanSemanticProposalV1(fixture, mutated))) {
              counterexamples.push({
                fixture_id: fixture.id,
                alternative_index: alternativeIndex,
                unit_index: unitIndex,
                original_route: unit.route,
                mutated_route: route,
                exact_fragment: unit.exact_fragment,
                legacy_overall_pass: true,
                joint_overall_pass: false,
              });
            }
          }
        }
      }
    }
    const retained = JSON.parse(
      readFileSync(
        new URL(
          '../fixtures/shot-plan-semantic-legacy-route-counterexamples.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(retained.scope).toBe('DETERMINISTIC_MUTATIONS_ONLY_NOT_HISTORICAL_MODEL_RESCORING');
    expect(retained.golden_sha256).toBe(LEGACY_GOLDEN_SHA256);
    expect(counterexamples).toEqual(retained.counterexamples);
    expect(counterexamples).toHaveLength(15);
  });

  it('keeps required facts, forbidden outcomes and needs-review as independent mandatory gates', () => {
    const value = proposal(case13);
    for (const fixture of [
      {
        ...case13,
        required_facts: [{ text: '不存在的事实', allowed_routes: ['ANIMAL' as const] }],
      },
      {
        ...case13,
        forbidden_outcomes: [{ fragment: '猪', route: 'ANIMAL' as const, reason: '合成禁止项' }],
      },
      { ...case13, expected_needs_review: true },
    ]) {
      expect(evaluate(fixture, value).joint_alternative_match).toBe(true);
      expect(evaluate(fixture, value).overall_pass).toBe(false);
      expect(automatedSemanticPass(evaluate(fixture, value))).toBe(false);
    }
  });

  it('preserves #11 two units and rejects its schema-valid full-text merge', () => {
    const fixture = fixtures[10]!;
    const value = proposal(fixture);
    expect(evaluate(fixture, value).overall_pass).toBe(true);
    value.units = [{ ...value.units[0]!, exact_fragment: fixture.source_text }];
    expect(evaluate(fixture, value)).toMatchObject({
      structural_validity: true,
      segmentation: false,
      overall_pass: false,
    });
  });

  it('distinguishes true NEEDS_REVIEW from resolved NO_MATCH and does not wildcard empty action sets', () => {
    const review = fixtures[3]!;
    const unresolved = proposal(review);
    expect(evaluate(review, unresolved).overall_pass).toBe(true);
    unresolved.units[0]!.continuity_action = 'START_NEW';
    // This matches the separately approved second alternative, not the first's empty set.
    expect(evaluate(review, unresolved).joint_alternative_match).toBe(false);
    const abstract = fixtures[8]!;
    const noMatch = proposal(abstract);
    expect(evaluate(abstract, noMatch).overall_pass).toBe(true);
    noMatch.segmentation_state = 'NEEDS_REVIEW';
    expect(evaluate(abstract, noMatch).overall_pass).toBe(false);
    const guessed = proposal(review);
    guessed.units[0]!.route = 'NO_MATCH';
    guessed.units[0]!.route_state = 'RESOLVED';
    guessed.units[0]!.continuity_state = 'RESOLVED';
    guessed.units[0]!.continuity_action = 'START_NEW';
    expect(evaluate(review, guessed).overall_pass).toBe(false);
  });

  it('checks each state even when the aggregate needs-review expectation still passes', () => {
    const fixture = { ...case13, expected_needs_review: true };
    expect(evaluate(fixture, proposal(fixture)).overall_pass).toBe(true);
    const wrongRouteState = proposal(fixture);
    wrongRouteState.units[0]!.route_state = 'NEEDS_REVIEW';
    expect(evaluate(fixture, wrongRouteState)).toMatchObject({
      needs_review: true,
      route: false,
      overall_pass: false,
    });
    const wrongContinuityState = proposal(fixture);
    wrongContinuityState.units[0]!.continuity_state = 'NEEDS_REVIEW';
    expect(evaluate(fixture, wrongContinuityState)).toMatchObject({
      needs_review: true,
      continuity: false,
      overall_pass: false,
    });
  });

  it('requires exact adjacent anchors for duplicates, rejecting missing, wrong or empty anchors', () => {
    const fixture = fixtures[5]!;
    const value = proposal(fixture);
    expect(evaluate(fixture, value).overall_pass).toBe(true);
    for (const anchor of [undefined, '', '虚构上下文', '包装标签写着：']) {
      const wrong = structuredClone(value);
      if (anchor === undefined) delete wrong.units[1]!.left_context;
      else wrong.units[1]!.left_context = anchor;
      expect(evaluate(fixture, wrong).overall_pass).toBe(false);
    }
    const wrongRight = structuredClone(value);
    wrongRight.units[0]!.right_context = '不存在';
    expect(evaluate(fixture, wrongRight).overall_pass).toBe(false);
  });

  it('rejects malformed values, source loss, substitutions and unapproved Unicode boundaries', () => {
    expect(evaluate(case13, {}).overall_pass).toBe(false);
    const unicode: ShotPlanSemanticGoldenFixtureV1 = {
      ...fixtures[0]!,
      source_text: '🐷状态。展示包装。',
      required_facts: [],
      acceptable_alternatives: [
        {
          units: [
            { exact_fragment: '🐷状态。', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
            {
              exact_fragment: '展示包装。',
              route: 'PRODUCT',
              continuity_actions: ['SWITCH_VISUAL'],
            },
          ],
        },
      ],
    };
    expect(evaluate(unicode, proposal(unicode)).overall_pass).toBe(true);
    for (const text of ['状态。', '🐷状态', '🐖状态。', '🐷 状态。']) {
      const wrong = proposal(unicode);
      wrong.units[0]!.exact_fragment = text;
      expect(evaluate(unicode, wrong).overall_pass).toBe(false);
    }
  });

  it('selects versions explicitly, rejects unknown policies, and retains legacy #13 behavior', () => {
    const v1 = selectShotPlanGoldenEvaluationPolicy(LEGACY_SEMANTIC_EVALUATION_V1);
    const v2 = selectShotPlanGoldenEvaluationPolicy(JOINT_ALTERNATIVE_EVALUATION_V2);
    expect(v1.evaluate).toBe(evaluateShotPlanSemanticProposalV1);
    expect(v2.evaluate).toBe(evaluate);
    expect(v1.fixtures).toBe(historical);
    expect(v2.fixtures).toBe(fixtures);
    expect(() => selectShotPlanGoldenEvaluationPolicy('V3')).toThrow(
      'GOLDEN_UNSUPPORTED_EVALUATION_POLICY',
    );
    const two = proposal(case13, case13.acceptable_alternatives[1]!);
    expect(automatedSemanticPass(v1.evaluate(historical[12]!, two))).toBe(false);
    expect(automatedSemanticPass(v2.evaluate(case13, two))).toBe(true);
    // Retain the original evaluator's known false positive as a historical regression.
    two.units[0]!.route = 'PRODUCT';
    expect(automatedSemanticPass(evaluateShotPlanSemanticProposalV1(case13, two))).toBe(true);
    expect(automatedSemanticPass(evaluate(case13, two))).toBe(false);
    expect(hash(historical)).toBe(LEGACY_GOLDEN_SHA256);
  });
});
