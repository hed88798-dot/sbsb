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

describe('veterinary e-commerce semantic proposer evaluation harness', () => {
  it('contains exactly 30 fixed synthetic golden fixtures with required evaluation metadata', () => {
    expect(shotPlanSemanticGoldenFixturesV1).toHaveLength(30);
    expect(new Set(shotPlanSemanticGoldenFixturesV1.map((fixture) => fixture.id)).size).toBe(30);
    for (const fixture of shotPlanSemanticGoldenFixturesV1) {
      expect(fixture.source_text.length).toBeGreaterThan(0);
      expect(fixture.required_facts.length).toBeGreaterThan(0);
      expect(fixture.acceptable_alternatives.length).toBeGreaterThan(0);
      expect(fixture.must_have_invariants).toContain('EXACT_SOURCE_COVERAGE');
    }
  });

  it('reports all five semantic dimensions and forbidden outcomes separately', () => {
    for (const fixture of shotPlanSemanticGoldenFixturesV1) {
      const evaluation = evaluateShotPlanSemanticProposalV1(
        fixture,
        proposalFrom(fixture, fixture.acceptable_alternatives[0]!),
      );
      expect(evaluation, fixture.id).toEqual({
        structural_validity: true,
        segmentation: true,
        route: true,
        continuity: true,
        needs_review: true,
        forbidden_outcome_violations: [],
      });
    }
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
    const bad = proposalFrom(fixture, fixture.acceptable_alternatives[0]!);
    bad.units[0]!.route = 'ANIMAL';
    const evaluation = evaluateShotPlanSemanticProposalV1(fixture, bad);
    expect(evaluation.structural_validity).toBe(true);
    expect(evaluation.route).toBe(false);
    expect(evaluation.forbidden_outcome_violations).toHaveLength(1);
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
