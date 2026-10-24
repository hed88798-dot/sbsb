import { describe, expect, it } from 'vitest';
import type { ShotPlanSemanticProposalV1 } from '../../packages/contracts/src/index.js';
import {
  evaluateShotPlanSemanticProposalV1,
  shotPlanSemanticGoldenFixturesV1,
  type SemanticGoldenAlternativeV1,
  type ShotPlanSemanticGoldenFixtureV1,
} from '../../packages/test-fixtures/src/shot-plan-semantic.js';

function proposalFrom(
  fixture: ShotPlanSemanticGoldenFixtureV1,
  alternative: SemanticGoldenAlternativeV1,
): ShotPlanSemanticProposalV1 {
  return {
    schema_version: '1.0',
    segmentation_state: fixture.expected_needs_review ? 'NEEDS_REVIEW' : 'RESOLVED',
    review_warnings: fixture.expected_needs_review
      ? [{ code: 'SEMANTIC_REVIEW', severity: 'BLOCKING', message: '需人工复核语义' }]
      : [],
    units: alternative.units.map((unit) => ({
      exact_fragment: unit.exact_fragment,
      ...(unit.left_context === undefined ? {} : { left_context: unit.left_context }),
      ...(unit.right_context === undefined ? {} : { right_context: unit.right_context }),
      route: unit.route,
      route_state: unit.route_state ?? 'RESOLVED',
      continuity_action: unit.continuity_actions[0] ?? null,
      continuity_state: unit.continuity_state ?? 'RESOLVED',
      rationale: '合成金标理由。',
      review_warnings:
        (unit.route_state ?? 'RESOLVED') === 'NEEDS_REVIEW' ||
        (unit.continuity_state ?? 'RESOLVED') === 'NEEDS_REVIEW'
          ? [{ code: 'SEMANTIC_REVIEW', severity: 'BLOCKING', message: '需人工复核语义' }]
          : [],
    })),
  };
}

function fixtureById(id: string): ShotPlanSemanticGoldenFixtureV1 {
  const fixture = shotPlanSemanticGoldenFixturesV1.find((item) => item.id === id);
  expect(fixture, id).toBeDefined();
  return fixture!;
}

function routeForExactText(fixture: ShotPlanSemanticGoldenFixtureV1, text: string) {
  return fixture.acceptable_alternatives[0]!.units.find((unit) => unit.exact_fragment === text)
    ?.route;
}

describe('GOLDEN_HARNESS_SELF_CHECK for veterinary e-commerce semantics', () => {
  it('contains exactly 30 fixed synthetic golden fixtures with required evaluation metadata', () => {
    expect(shotPlanSemanticGoldenFixturesV1).toHaveLength(30);
    expect(new Set(shotPlanSemanticGoldenFixturesV1.map((fixture) => fixture.id)).size).toBe(30);
    for (const fixture of shotPlanSemanticGoldenFixturesV1) {
      expect(fixture.source_text.length).toBeGreaterThan(0);
      expect(fixture.route_review.length).toBeGreaterThan(0);
      expect(fixture.required_facts.length).toBeGreaterThan(0);
      expect(fixture.acceptable_alternatives.length).toBeGreaterThan(0);
      expect(fixture.must_have_invariants).toContain('EXACT_SOURCE_COVERAGE');
    }
  });

  it('self-checks every approved alternative across all five semantic dimensions', () => {
    for (const fixture of shotPlanSemanticGoldenFixturesV1) {
      for (const [alternativeIndex, alternative] of fixture.acceptable_alternatives.entries()) {
        const evaluation = evaluateShotPlanSemanticProposalV1(
          fixture,
          proposalFrom(fixture, alternative),
        );
        expect(evaluation, `${fixture.id} alternative ${alternativeIndex}`).toEqual({
          structural_validity: true,
          segmentation: true,
          route: true,
          continuity: true,
          needs_review: true,
          forbidden_outcome_violations: [],
        });
      }
    }
  });

  it.each([
    ['vet-commerce-23', '本品按批准用法使用。'],
    ['vet-commerce-27', '本品仅按批准对象使用。'],
    ['vet-commerce-28', '本品禁止超范围宣传。'],
    ['vet-commerce-29', '本品适用对象以批准信息为准。'],
    ['vet-commerce-30', '本品禁忌信息必须保留。'],
    ['vet-commerce-21', '使用前请阅读禁忌事项。'],
    ['vet-commerce-16', '本品适用于日常营养补充。'],
  ])('routes abstract compliance narration %s to NO_MATCH', (fixtureId, narration) => {
    expect(routeForExactText(fixtureById(fixtureId), narration)).toBe('NO_MATCH');
  });

  it.each([
    ['vet-commerce-17', '请核对包装上的批准范围。'],
    ['vet-commerce-18', '产品用量以标签说明为准。'],
    ['vet-commerce-22', '展示产品成分表。'],
    ['vet-commerce-24', '展示包装批号区域。'],
  ])('keeps explicit package or label inspection %s as PRODUCT', (fixtureId, narration) => {
    expect(routeForExactText(fixtureById(fixtureId), narration)).toBe('PRODUCT');
  });

  it('keeps product-name animal outcome as ANIMAL and contraindication as NO_MATCH', () => {
    expect(
      fixtureById('vet-commerce-product-name-animal-outcome').acceptable_alternatives[0]!.units[0]
        ?.route,
    ).toBe('ANIMAL');
    expect(
      fixtureById('vet-commerce-contraindication-no-match').acceptable_alternatives[0]!.units[0]
        ?.route,
    ).toBe('NO_MATCH');
  });

  it('keeps “适用于猪” contextual across PRODUCT, ANIMAL, and abstract NO_MATCH cases', () => {
    expect(
      fixtureById('vet-commerce-context-applicable-product').acceptable_alternatives[0]!.units[0]
        ?.route,
    ).toBe('PRODUCT');
    expect(
      fixtureById('vet-commerce-context-applicable-animal').acceptable_alternatives[0]!.units[0]
        ?.route,
    ).toBe('ANIMAL');
    expect(fixtureById('vet-commerce-29').acceptable_alternatives[0]!.units[1]?.route).toBe(
      'NO_MATCH',
    );
  });

  it('accepts explicitly recorded alternate segmentations and continuity choices', () => {
    const segmentationFixture = shotPlanSemanticGoldenFixturesV1.find(
      (fixture) => fixture.id === 'vet-commerce-alt-segmentation',
    )!;
    const alternate = proposalFrom(
      segmentationFixture,
      segmentationFixture.acceptable_alternatives[1]!,
    );
    expect(evaluateShotPlanSemanticProposalV1(segmentationFixture, alternate)).toMatchObject({
      structural_validity: true,
      segmentation: true,
      route: true,
      continuity: true,
    });

    const continuityFixture = shotPlanSemanticGoldenFixturesV1.find(
      (fixture) => fixture.id === 'vet-commerce-continuity-alternative',
    )!;
    const continuityAlternative = proposalFrom(
      continuityFixture,
      continuityFixture.acceptable_alternatives[0]!,
    );
    continuityAlternative.units[1]!.continuity_action = 'SWITCH_VISUAL';
    expect(
      evaluateShotPlanSemanticProposalV1(continuityFixture, continuityAlternative).continuity,
    ).toBe(true);
  });

  it('detects keyword-only route violations independently from structural validity', () => {
    const fixture = shotPlanSemanticGoldenFixturesV1.find(
      (item) => item.id === 'vet-commerce-anti-keyword-route',
    )!;
    for (const badRoute of ['ANIMAL', 'PRODUCT'] as const) {
      const bad = proposalFrom(fixture, fixture.acceptable_alternatives[0]!);
      bad.units[0]!.route = badRoute;
      const evaluation = evaluateShotPlanSemanticProposalV1(fixture, bad);
      expect(evaluation.structural_validity).toBe(true);
      expect(evaluation.route).toBe(false);
      expect(evaluation.forbidden_outcome_violations).toHaveLength(1);
    }
  });

  it('does not label deterministic fixture self-checks as real-model results', () => {
    const selfCheck = {
      harness: 'GOLDEN_HARNESS_SELF_CHECK',
      fixture_count: shotPlanSemanticGoldenFixturesV1.length,
      real_model_golden_fixtures_run: 0,
      real_model_segmentation_result: 'NOT_RUN_ENVIRONMENT',
      real_model_route_result: 'NOT_RUN_ENVIRONMENT',
      real_model_continuity_result: 'NOT_RUN_ENVIRONMENT',
      real_model_needs_review_result: 'NOT_RUN_ENVIRONMENT',
    } as const;
    expect(selfCheck).toEqual({
      harness: 'GOLDEN_HARNESS_SELF_CHECK',
      fixture_count: 30,
      real_model_golden_fixtures_run: 0,
      real_model_segmentation_result: 'NOT_RUN_ENVIRONMENT',
      real_model_route_result: 'NOT_RUN_ENVIRONMENT',
      real_model_continuity_result: 'NOT_RUN_ENVIRONMENT',
      real_model_needs_review_result: 'NOT_RUN_ENVIRONMENT',
    });
  });

  it('does not turn malformed or lossy output into a semantic score', () => {
    const fixture = shotPlanSemanticGoldenFixturesV1[0]!;
    const lossy = proposalFrom(fixture, fixture.acceptable_alternatives[0]!);
    lossy.units[0]!.exact_fragment = lossy.units[0]!.exact_fragment.replace('。', '');
    expect(evaluateShotPlanSemanticProposalV1(fixture, lossy)).toMatchObject({
      structural_validity: false,
      segmentation: false,
    });
  });
});
