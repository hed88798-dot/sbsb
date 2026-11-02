import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { shotPlanSemanticProposalV1Schema } from '../../packages/contracts/src/index.js';
import {
  evaluateShotPlanSemanticProposalV1,
  shotPlanSemanticGoldenFixturesV1 as fixtures,
  type ShotPlanSemanticGoldenFixtureV1,
} from '../../packages/test-fixtures/src/shot-plan-semantic.js';
import { automatedSemanticPass } from '../helpers/shot-plan-golden-evaluation.js';

const capturedBytes = readFileSync(
  new URL('../fixtures/shot-planning/captured-prompt-v3-offline.json', import.meta.url),
  'utf8',
);
const captured = JSON.parse(capturedBytes) as {
  original_cases_sha256: string;
  historical_summary: Record<string, unknown>;
  baseline_fixture_hashes: Record<string, string>;
  approved_baseline_goldens: ShotPlanSemanticGoldenFixtureV1[];
  cases: Array<{
    fixture_id: string;
    technical_result: string;
    automated_semantic_result: string;
    evaluation: ReturnType<typeof evaluateShotPlanSemanticProposalV1> | null;
    canonical_proposal: unknown;
    raw_semantic_proposal?: { units: Array<Record<string, unknown>> };
  }>;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('Prompt v4 approved Golden corrections and offline captured v3 adjudication', () => {
  it('keeps all other 28 Goldens identical to the captured v3 authority', () => {
    expect(fixtures).toHaveLength(30);
    expect(captured.cases.map((item) => item.fixture_id)).toEqual(fixtures.map((item) => item.id));
    for (const [index, fixture] of fixtures.entries()) {
      if (index === 3 || index === 17) continue;
      expect(hash(fixture), fixture.id).toBe(captured.baseline_fixture_hashes[fixture.id]);
    }
  });

  it('only adds deterministic first-slot continuity while preserving genuine route ambiguity', () => {
    const before = captured.approved_baseline_goldens[0]!;
    const expected = structuredClone(before);
    expected.acceptable_alternatives.push({
      units: [
        {
          ...before.acceptable_alternatives[0]!.units[0]!,
          continuity_actions: ['START_NEW'],
          continuity_state: 'RESOLVED',
        },
      ],
    });
    expect(fixtures[3]).toEqual(expected);
    expect(hash(before)).toBe(captured.baseline_fixture_hashes[before.id]);
    for (const alternative of fixtures[3]!.acceptable_alternatives) {
      expect(alternative.units[0]).toMatchObject({ route: null, route_state: 'NEEDS_REVIEW' });
    }
  });

  it('only corrects reference-only label authority to NO_MATCH and retains exact coverage and switching', () => {
    const before = captured.approved_baseline_goldens[1]!;
    const expected = structuredClone(before);
    expected.required_facts[1]!.allowed_routes = ['NO_MATCH'];
    expected.acceptable_alternatives[0]!.units[1]!.route = 'NO_MATCH';
    expected.route_review = '后段仅引用标签说明作为用量规范依据，没有查看或展示包装/标签的意图。';
    expect(fixtures[17]).toEqual(expected);
    expect(hash(before)).toBe(captured.baseline_fixture_hashes[before.id]);
    expect(fixtures[17]!.acceptable_alternatives[0]!.units[1]!.continuity_actions).toEqual([
      'SWITCH_VISUAL',
    ]);
  });

  it('replays the 29 unchanged canonical captures offline: only #18 changes from FAIL to PASS', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
    try {
      const passes: string[] = [];
      const failures: string[] = [];
      for (const [index, actual] of captured.cases.entries()) {
        if (actual.canonical_proposal === null) continue;
        const evaluation = evaluateShotPlanSemanticProposalV1(
          fixtures[index]!,
          actual.canonical_proposal,
        );
        if (index === 17) {
          expect(actual.automated_semantic_result).toBe('AUTOMATED_SEMANTIC_FAIL');
          expect(actual.evaluation?.route).toBe(false);
          expect(automatedSemanticPass(evaluation)).toBe(true);
        } else {
          expect(evaluation, actual.fixture_id).toEqual(actual.evaluation);
        }
        (automatedSemanticPass(evaluation) ? passes : failures).push(actual.fixture_id);
      }
      expect(passes).toHaveLength(25);
      expect(failures).toEqual([
        'vet-commerce-symptom-appetite-continuity',
        'vet-commerce-14',
        'vet-commerce-17',
        'vet-commerce-22',
      ]);
      expect(network).not.toHaveBeenCalled();
      expect(JSON.parse(capturedBytes)).toEqual(captured);
    } finally {
      network.mockRestore();
    }
  });

  it('retains #4 as noncanonical historical evidence without fabricating a repaired proposal', () => {
    const actual = captured.cases[3]!;
    expect(actual.technical_result).toBe('FAIL_CANONICAL');
    expect(actual.automated_semantic_result).toBe('NOT_EVALUATED');
    expect(actual.canonical_proposal).toBeNull();
    // The original bounded evidence recorded the invalid type, not the warning string.
    expect(actual.raw_semantic_proposal?.units[0]?.review_warnings).toEqual([
      { invalid_warning_type: 'string' },
    ]);
    expect(shotPlanSemanticProposalV1Schema.safeParse(actual.raw_semantic_proposal).success).toBe(
      false,
    );
  });

  it('preserves original v3 results separately from this offline adjudication', () => {
    expect(captured.original_cases_sha256).toBe(
      'c3657c90d11339571c69040ce120b03e89b36ca726c60fd56001b47694ccc54a',
    );
    expect(captured.historical_summary).toMatchObject({
      prompt_template_version: '3',
      git_head: '1d814ededf0eae4cbddc1496c2201ee34c50828e',
      FIXTURES_TECHNICALLY_COMPLETED: 29,
      FIXTURES_AUTOMATED_SEMANTIC_PASS: 24,
      FIXTURES_AUTOMATED_SEMANTIC_FAIL: 5,
      FIXTURES_TECHNICAL_FAIL: 1,
      REAL_PROVIDER_REQUEST_COUNT: 39,
      SETTLED_COST_CNY_TOTAL: 0.16893,
    });
  });
});
