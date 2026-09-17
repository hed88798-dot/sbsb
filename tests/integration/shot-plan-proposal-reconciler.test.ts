import { describe, expect, it } from 'vitest';
import type {
  CanonicalSourceDocumentV1,
  ShotPlanSemanticProposalUnitV1,
  ShotPlanSemanticProposalV1,
} from '../../packages/contracts/src/index.js';
import { reconcileSemanticShotPlanProposal } from '../../apps/desktop/src/main/shot-plan-proposal-reconciler.js';

function source(text: string): CanonicalSourceDocumentV1 {
  return {
    schema_version: '1.0',
    source_document_id: 'script_1',
    source_document_version: 1,
    source_document_hash: 'a'.repeat(64),
    source_hash_scheme: 'SHA256_EXACT_UTF8_V1',
    source_offset_unit: 'UNICODE_CODE_POINT',
    source_kind: 'SCRIPT_VERSION',
    text,
    created_at: '2026-09-17T00:00:00.000Z',
  };
}

function unit(
  exactFragment: string,
  overrides: Partial<ShotPlanSemanticProposalUnitV1> = {},
): ShotPlanSemanticProposalUnitV1 {
  return {
    exact_fragment: exactFragment,
    route: 'ANIMAL',
    route_state: 'RESOLVED',
    continuity_action: 'START_NEW',
    continuity_state: 'RESOLVED',
    rationale: '依据完整语义选择。',
    review_warnings: [],
    ...overrides,
  };
}

function proposal(units: ShotPlanSemanticProposalUnitV1[]): ShotPlanSemanticProposalV1 {
  return {
    schema_version: '1.0',
    segmentation_state: 'RESOLVED',
    review_warnings: [],
    units,
  };
}

function reconcile(text: string, units: ShotPlanSemanticProposalUnitV1[]) {
  return reconcileSemanticShotPlanProposal(source(text), proposal(units), {
    continuityGroupId: (index) => `group_${index + 1}`,
  });
}

describe('deterministic exact-source proposal reconciliation', () => {
  it('derives unique offsets and source_text from the authority, including punctuation', () => {
    const result = reconcile('猪群咳喘。使用本品。', [
      unit('猪群咳喘。'),
      unit('使用本品。', {
        route: 'PRODUCT',
        continuity_action: 'SWITCH_VISUAL',
      }),
    ]);
    expect(
      result.slots.map(({ source_start, source_end, source_text }) => ({
        source_start,
        source_end,
        source_text,
      })),
    ).toEqual([
      { source_start: 0, source_end: 5, source_text: '猪群咳喘。' },
      { source_start: 5, source_end: 10, source_text: '使用本品。' },
    ]);
  });

  it('uses Unicode code-point offsets for astral emoji', () => {
    const result = reconcile('猪🐖群。', [unit('猪🐖群。')]);
    expect(result.slots[0]).toMatchObject({ source_start: 0, source_end: 4 });
  });

  it('resolves duplicated wording only with exact adjacent context anchors', () => {
    const result = reconcile('前段：增强采食。后段：增强采食。', [
      unit('前段：'),
      unit('增强采食。', { left_context: '前段：', continuity_action: 'CONTINUE_PREVIOUS' }),
      unit('后段：', { continuity_action: 'SWITCH_VISUAL' }),
      unit('增强采食。', { left_context: '后段：', continuity_action: 'CONTINUE_PREVIOUS' }),
    ]);
    expect(result.slots.map((slot) => slot.source_text)).toEqual([
      '前段：',
      '增强采食。',
      '后段：',
      '增强采食。',
    ]);
  });

  it('allows ordered matching to narrow the legal forward interval without reordering', () => {
    const result = reconcile('开场。重复句。重复句。', [
      unit('开场。'),
      unit('重复句。', { right_context: '重复句。', continuity_action: 'CONTINUE_PREVIOUS' }),
      unit('重复句。', { continuity_action: 'CONTINUE_PREVIOUS' }),
    ]);
    expect(result.slots.map((slot) => slot.source_start)).toEqual([0, 3, 7]);
  });

  it('rejects an ambiguous repeated fragment as structural failure, never NEEDS_REVIEW', () => {
    expect(() => reconcile('增强采食。增强采食。', [unit('增强采食。')])).toThrow(
      'SHOT_PLAN_PROPOSAL_SOURCE_BINDING_AMBIGUOUS',
    );
  });

  it.each([
    ['quote mismatch', '猪群“咳喘”', '猪群「咳喘」', 'SHOT_PLAN_PROPOSAL_EXACT_SOURCE_MISMATCH'],
    ['fuzzy normalization', '每袋100g', '每袋 100g', 'SHOT_PLAN_PROPOSAL_EXACT_SOURCE_MISMATCH'],
    ['punctuation rewrite', '猪群咳喘，', '猪群咳喘。', 'SHOT_PLAN_PROPOSAL_EXACT_SOURCE_MISMATCH'],
  ])('rejects %s instead of normalizing source text', (_name, text, fragment, code) => {
    expect(() => reconcile(text, [unit(fragment)])).toThrow(code);
  });

  it('rejects omitted meaningful content while permitting Unicode whitespace gaps', () => {
    expect(() => reconcile('猪群咳喘，建议观察。', [unit('猪群咳喘，'), unit('观察。')])).toThrow(
      'SHOT_PLAN_PROPOSAL_NON_WHITESPACE_GAP',
    );
    expect(
      reconcile('猪群咳喘。 \n 使用本品。', [
        unit('猪群咳喘。'),
        unit('使用本品。', { route: 'PRODUCT', continuity_action: 'SWITCH_VISUAL' }),
      ]).slots,
    ).toHaveLength(2);
  });

  it('rejects overlap or backward ordering instead of reordering proposals', () => {
    expect(() =>
      reconcile('猪群咳喘。使用本品。', [unit('使用本品。'), unit('猪群咳喘。')]),
    ).toThrow('SHOT_PLAN_PROPOSAL_NON_WHITESPACE_GAP');
  });

  it('rejects cross-route CONTINUE_PREVIOUS without silent repair', () => {
    expect(() =>
      reconcile('猪群咳喘。展示本品。', [
        unit('猪群咳喘。'),
        unit('展示本品。', {
          route: 'PRODUCT',
          continuity_action: 'CONTINUE_PREVIOUS',
        }),
      ]),
    ).toThrow('SHOT_PLAN_PROPOSAL_CROSS_ROUTE_CONTINUE_INVALID');
  });

  it('maps model-facing continuity actions into opaque app-owned group identities', () => {
    const result = reconcile('症状一。症状二。产品。', [
      unit('症状一。'),
      unit('症状二。', { continuity_action: 'CONTINUE_PREVIOUS' }),
      unit('产品。', { route: 'PRODUCT', continuity_action: 'SWITCH_VISUAL' }),
    ]);
    expect(result.slots.map((slot) => slot.visual_continuity_group_id)).toEqual([
      'group_1',
      'group_1',
      'group_2',
    ]);
  });

  it('preserves genuine semantic NEEDS_REVIEW without confidence thresholds', () => {
    const unresolved = proposal([
      unit('抽象承诺。', {
        route: null,
        route_state: 'NEEDS_REVIEW',
        continuity_action: null,
        continuity_state: 'NEEDS_REVIEW',
        review_warnings: [
          { code: 'SEMANTIC_AMBIGUITY', severity: 'BLOCKING', message: '需人工判断素材路由' },
        ],
      }),
    ]);
    unresolved.segmentation_state = 'NEEDS_REVIEW';
    const result = reconcileSemanticShotPlanProposal(source('抽象承诺。'), unresolved, {
      continuityGroupId: (index) => `group_${index + 1}`,
    });
    expect(result).toMatchObject({
      segmentation_state: 'NEEDS_REVIEW',
      slots: [
        {
          route: null,
          route_state: 'NEEDS_REVIEW',
          visual_continuity_group_id: null,
          continuity_state: 'NEEDS_REVIEW',
        },
      ],
    });
  });

  it.each([
    ['使用康健100后，猪群采食状态逐步恢复。', 'ANIMAL'],
    ['看这袋康健100，每袋100克。', 'PRODUCT'],
    ['蛋鸡产蛋期禁用。', 'NO_MATCH'],
  ] as const)('preserves model semantic route without keyword overrides: %s', (text, route) => {
    const result = reconcile(text, [unit(text, { route })]);
    expect(result.slots[0]!.route).toBe(route);
  });

  it('preserves each unresolved semantic dimension as review authority', () => {
    const unresolved = reconcileSemanticShotPlanProposal(
      source('猪群状态。产品表达。'),
      {
        schema_version: '1.0',
        segmentation_state: 'NEEDS_REVIEW',
        review_warnings: [
          { code: 'SEGMENTATION_REVIEW', severity: 'BLOCKING', message: '边界需人工复核' },
        ],
        units: [
          unit('猪群状态。', {
            route: null,
            route_state: 'NEEDS_REVIEW',
            continuity_action: null,
            continuity_state: 'NEEDS_REVIEW',
          }),
          unit('产品表达。', {
            route: 'PRODUCT',
            route_state: 'RESOLVED',
            continuity_action: 'START_NEW',
            continuity_state: 'RESOLVED',
          }),
        ],
      },
      { continuityGroupId: (index) => `group_${index + 1}` },
    );
    expect(unresolved.segmentation_state).toBe('NEEDS_REVIEW');
    expect(unresolved.slots[0]).toMatchObject({
      route_state: 'NEEDS_REVIEW',
      continuity_state: 'NEEDS_REVIEW',
    });
  });

  it('rejects reuse of an already-bound source region as overlap/order invalidity', () => {
    expect(() =>
      reconcile('猪群咳喘。展示本品。', [unit('猪群咳喘。'), unit('猪群咳喘。')]),
    ).toThrow('SHOT_PLAN_PROPOSAL_ORDER_OR_OVERLAP_INVALID');
  });
});
