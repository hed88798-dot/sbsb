import {
  shotPlanSemanticProposalV1Schema,
  type ShotPlanRouteV1,
  type ShotPlanSemanticContinuityActionV1,
  type ShotPlanSemanticProposalV1,
} from '@app/contracts';

export interface SemanticGoldenUnitV1 {
  exact_fragment: string;
  route: ShotPlanRouteV1 | null;
  continuity_actions: ShotPlanSemanticContinuityActionV1[];
  route_state?: 'RESOLVED' | 'NEEDS_REVIEW';
  continuity_state?: 'RESOLVED' | 'NEEDS_REVIEW';
  left_context?: string;
  right_context?: string;
}

export interface SemanticGoldenAlternativeV1 {
  units: SemanticGoldenUnitV1[];
}

export interface ShotPlanSemanticGoldenFixtureV1 {
  id: string;
  source_text: string;
  route_review: string;
  required_facts: Array<{ text: string; allowed_routes: Array<ShotPlanRouteV1 | null> }>;
  acceptable_alternatives: SemanticGoldenAlternativeV1[];
  must_have_invariants: string[];
  forbidden_outcomes: Array<{ fragment: string; route: ShotPlanRouteV1; reason: string }>;
  expected_needs_review: boolean;
}

export interface ShotPlanSemanticEvaluationV1 {
  structural_validity: boolean;
  segmentation: boolean;
  route: boolean;
  continuity: boolean;
  needs_review: boolean;
  forbidden_outcome_violations: string[];
}

const invariants = ['EXACT_SOURCE_COVERAGE', 'SOURCE_ORDER_PRESERVED', 'NO_MODEL_OFFSETS'];

function reviewedPairFixture(
  index: number,
  first: { text: string; route: ShotPlanRouteV1 },
  second: { text: string; route: ShotPlanRouteV1 },
  routeReview: string,
  forbiddenOutcomes: ShotPlanSemanticGoldenFixtureV1['forbidden_outcomes'] = [],
): ShotPlanSemanticGoldenFixtureV1 {
  return {
    id: `vet-commerce-${String(index).padStart(2, '0')}`,
    source_text: `${first.text}${second.text}`,
    route_review: routeReview,
    required_facts: [
      { text: first.text, allowed_routes: [first.route] },
      { text: second.text, allowed_routes: [second.route] },
    ],
    acceptable_alternatives: [
      {
        units: [
          { exact_fragment: first.text, route: first.route, continuity_actions: ['START_NEW'] },
          {
            exact_fragment: second.text,
            route: second.route,
            continuity_actions: ['SWITCH_VISUAL'],
          },
        ],
      },
    ],
    must_have_invariants: invariants,
    forbidden_outcomes: forbiddenOutcomes,
    expected_needs_review: false,
  };
}

const individuallyReviewedCases: ShotPlanSemanticGoldenFixtureV1[] = [
  reviewedPairFixture(
    14,
    { text: '猪群换季时容易出现咳喘。', route: 'ANIMAL' },
    { text: '本品每袋100g，按说明使用。', route: 'PRODUCT' },
    '前段主视觉是猪群症状；后段以每袋净含量和产品规格为中心。',
  ),
  reviewedPairFixture(
    15,
    { text: '仔猪断奶后采食量下降。', route: 'ANIMAL' },
    { text: '展示产品包装和颗粒形态。', route: 'PRODUCT' },
    '后段明确要求展示包装和实物剂型。',
  ),
  reviewedPairFixture(
    16,
    { text: '母猪产后需要关注恢复状态。', route: 'ANIMAL' },
    { text: '本品适用于日常营养补充。', route: 'NO_MATCH' },
    '后段是抽象适用性信息，没有产品本体或标签查看意图。',
    [
      {
        fragment: '本品',
        route: 'PRODUCT',
        reason: '仅出现“本品”不能把抽象适用性语义改为 PRODUCT',
      },
    ],
  ),
  reviewedPairFixture(
    17,
    { text: '鸡群精神不振并伴随羽毛蓬松。', route: 'ANIMAL' },
    { text: '请核对包装上的批准范围。', route: 'PRODUCT' },
    '后段明确把包装上的批准信息作为查看对象。',
  ),
  reviewedPairFixture(
    18,
    { text: '鸭群饮水量出现明显变化。', route: 'ANIMAL' },
    { text: '产品用量以标签说明为准。', route: 'PRODUCT' },
    '后段明确将标签用量作为主要查看对象。',
  ),
  reviewedPairFixture(
    19,
    { text: '牛群反刍次数减少。', route: 'ANIMAL' },
    { text: '展示本品正面包装。', route: 'PRODUCT' },
    '后段是明确的包装正面特写指令。',
  ),
  reviewedPairFixture(
    20,
    { text: '羊群换料后需要观察粪便。', route: 'ANIMAL' },
    { text: '本品规格为500g每袋。', route: 'PRODUCT' },
    '后段以产品规格和每袋净含量为中心。',
  ),
  reviewedPairFixture(
    21,
    { text: '育肥猪采食速度变慢。', route: 'ANIMAL' },
    { text: '使用前请阅读禁忌事项。', route: 'NO_MATCH' },
    '后段是抽象安全/禁忌提醒，未要求展示包装或标签。',
  ),
  reviewedPairFixture(
    22,
    { text: '蛋鸡产蛋状态需要持续记录。', route: 'ANIMAL' },
    { text: '展示产品成分表。', route: 'PRODUCT' },
    '后段明确要求展示产品成分表，而非仅提到成分。',
  ),
  reviewedPairFixture(
    23,
    { text: '肉鸡进场后应观察适应情况。', route: 'ANIMAL' },
    { text: '本品按批准用法使用。', route: 'NO_MATCH' },
    '后段是抽象批准用法合规信息，没有产品实物查看意图。',
    [{ fragment: '本品', route: 'PRODUCT', reason: '“本品”不能把合规指令自动改为 PRODUCT' }],
  ),
  reviewedPairFixture(
    24,
    { text: '犊牛精神状态需要每日检查。', route: 'ANIMAL' },
    { text: '展示包装批号区域。', route: 'PRODUCT' },
    '后段明确要求展示包装上的批号区域。',
  ),
  reviewedPairFixture(
    25,
    { text: '羔羊转群后出现应激表现。', route: 'ANIMAL' },
    { text: '产品应密封保存。', route: 'NO_MATCH' },
    '后段是抽象储存指令，未指定产品实物或包装画面。',
  ),
  reviewedPairFixture(
    26,
    { text: '鸡舍湿度升高后需检查垫料。', route: 'ANIMAL' },
    { text: '产品包装应保持完整。', route: 'PRODUCT' },
    '后段的主要视觉对象是包装物理完整性。',
  ),
  reviewedPairFixture(
    27,
    { text: '牛舍采食区需要保持清洁。', route: 'ANIMAL' },
    { text: '本品仅按批准对象使用。', route: 'NO_MATCH' },
    '后段是抽象批准对象合规信息，未要求查看标签。',
    [{ fragment: '本品', route: 'PRODUCT', reason: '产品指代词不能覆盖抽象合规语义' }],
  ),
  reviewedPairFixture(
    28,
    { text: '仔猪保育阶段应关注温度变化。', route: 'ANIMAL' },
    { text: '本品禁止超范围宣传。', route: 'NO_MATCH' },
    '后段是抽象宣传合规限制，不是产品实物展示。',
    [{ fragment: '本品', route: 'PRODUCT', reason: '仅出现“本品”不能把宣传合规限制改为 PRODUCT' }],
  ),
  reviewedPairFixture(
    29,
    { text: '犊牛断奶期需要平稳过渡。', route: 'ANIMAL' },
    { text: '本品适用对象以批准信息为准。', route: 'NO_MATCH' },
    '后段是抽象批准范围信息，没有包装/标签查看上下文。',
    [{ fragment: '本品', route: 'PRODUCT', reason: '产品指代词不能自动产生 PRODUCT 路由' }],
  ),
  reviewedPairFixture(
    30,
    { text: '育肥猪转栏后需要减少惊扰。', route: 'ANIMAL' },
    { text: '本品禁忌信息必须保留。', route: 'NO_MATCH' },
    '后段是抽象禁忌信息保留要求，未要求展示标签。',
    [{ fragment: '本品', route: 'PRODUCT', reason: '“本品”不能把禁忌合规语义改为 PRODUCT' }],
  ),
];

export const shotPlanSemanticGoldenFixturesV1: ShotPlanSemanticGoldenFixtureV1[] = [
  {
    id: 'vet-commerce-alt-segmentation',
    source_text: '猪群咳喘并伴采食下降。展示本品包装。',
    route_review: '猪群症状以动物为中心；明确展示包装的后段以产品为中心。',
    required_facts: [
      { text: '猪群咳喘', allowed_routes: ['ANIMAL'] },
      { text: '展示本品包装。', allowed_routes: ['PRODUCT'] },
    ],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '猪群咳喘并伴采食下降。',
            route: 'ANIMAL',
            continuity_actions: ['START_NEW'],
          },
          {
            exact_fragment: '展示本品包装。',
            route: 'PRODUCT',
            continuity_actions: ['SWITCH_VISUAL'],
          },
        ],
      },
      {
        units: [
          { exact_fragment: '猪群咳喘', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          {
            exact_fragment: '并伴采食下降。',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS'],
          },
          {
            exact_fragment: '展示本品包装。',
            route: 'PRODUCT',
            continuity_actions: ['SWITCH_VISUAL'],
          },
        ],
      },
    ],
    must_have_invariants: invariants,
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-same-route-boundaries',
    source_text: '猪群先咳嗽。随后出现气喘。',
    route_review: '两段都描述同一猪群的症状变化，主视觉均为动物。',
    required_facts: [{ text: '猪群', allowed_routes: ['ANIMAL'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '猪群先咳嗽。随后出现气喘。',
            route: 'ANIMAL',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
      {
        units: [
          { exact_fragment: '猪群先咳嗽。', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          {
            exact_fragment: '随后出现气喘。',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS', 'SWITCH_VISUAL'],
          },
        ],
      },
    ],
    must_have_invariants: invariants,
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-continuity-alternative',
    source_text: '猪群精神下降。猪群采食减少。',
    route_review: '两段都是猪群状态，可稳定延续同一动物视觉。',
    required_facts: [{ text: '猪群', allowed_routes: ['ANIMAL'] }],
    acceptable_alternatives: [
      {
        units: [
          { exact_fragment: '猪群精神下降。', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          {
            exact_fragment: '猪群采食减少。',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS', 'SWITCH_VISUAL'],
          },
        ],
      },
    ],
    must_have_invariants: invariants,
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-genuine-review',
    source_text: '这段表达可能是动物状态，也可能是产品功效。',
    route_review: '原文明示两种真实可能的主视觉，应保留语义 NEEDS_REVIEW。',
    required_facts: [{ text: '可能', allowed_routes: [null] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '这段表达可能是动物状态，也可能是产品功效。',
            route: null,
            route_state: 'NEEDS_REVIEW',
            continuity_state: 'NEEDS_REVIEW',
            continuity_actions: [],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'REVIEW_AMBIGUOUS_SEMANTICS'],
    forbidden_outcomes: [],
    expected_needs_review: true,
  },
  {
    id: 'vet-commerce-anti-keyword-route',
    source_text: '本品适用于猪群日常营养补充。',
    route_review: '这是抽象适用性信息；“本品”不自动导向 PRODUCT，“猪群”也不自动导向 ANIMAL。',
    required_facts: [{ text: '本品适用于猪群日常营养补充。', allowed_routes: ['NO_MATCH'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '本品适用于猪群日常营养补充。',
            route: 'NO_MATCH',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'NO_KEYWORD_ONLY_ROUTING'],
    forbidden_outcomes: [
      { fragment: '本品', route: 'PRODUCT', reason: '不能只因出现“本品”就改为产品画面' },
      { fragment: '猪群', route: 'ANIMAL', reason: '不能只因出现“猪群”就改为动物画面' },
    ],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-duplicate-anchor',
    source_text: '动物状态：增强采食。包装标签写着：增强采食。',
    route_review: '第一处重复文字位于动物状态上下文；第二处明确是包装标签查看。',
    required_facts: [
      { text: '动物状态：', allowed_routes: ['ANIMAL'] },
      { text: '包装标签写着：', allowed_routes: ['PRODUCT'] },
    ],
    acceptable_alternatives: [
      {
        units: [
          { exact_fragment: '动物状态：', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          {
            exact_fragment: '增强采食。',
            left_context: '动物状态：',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS'],
          },
          {
            exact_fragment: '包装标签写着：',
            route: 'PRODUCT',
            continuity_actions: ['SWITCH_VISUAL'],
          },
          {
            exact_fragment: '增强采食。',
            left_context: '包装标签写着：',
            route: 'PRODUCT',
            continuity_actions: ['CONTINUE_PREVIOUS'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'EXACT_CONTEXT_ANCHORS_FOR_DUPLICATES'],
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-product-name-animal-outcome',
    source_text: '使用康健100后，猪群采食状态逐步恢复。',
    route_review: '产品名只是原因上下文，主视觉是猪群采食恢复结果。',
    required_facts: [{ text: '猪群采食状态逐步恢复', allowed_routes: ['ANIMAL'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '使用康健100后，猪群采食状态逐步恢复。',
            route: 'ANIMAL',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
      {
        units: [
          { exact_fragment: '使用康健100后，', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          {
            exact_fragment: '猪群采食状态逐步恢复。',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'PRODUCT_NAME_DOES_NOT_FORCE_PRODUCT'],
    forbidden_outcomes: [
      { fragment: '康健100', route: 'PRODUCT', reason: '产品名不能覆盖动物恢复这一主视觉含义' },
    ],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-explicit-product-showcase',
    source_text: '看这袋康健100，每袋100克。',
    route_review: '明确要求查看产品包装与每袋净含量。',
    required_facts: [{ text: '这袋康健100', allowed_routes: ['PRODUCT'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '看这袋康健100，每袋100克。',
            route: 'PRODUCT',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
    ],
    must_have_invariants: invariants,
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-contraindication-no-match',
    source_text: '蛋鸡产蛋期禁用。',
    route_review: '这是抽象禁忌信息，未指定动物状态画面或产品标签查看。',
    required_facts: [{ text: '禁用', allowed_routes: ['NO_MATCH'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '蛋鸡产蛋期禁用。',
            route: 'NO_MATCH',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'NO_MATCH_IS_SEMANTIC_NOT_UNCERTAINTY'],
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-stable-animal-concept',
    source_text: '猪群先是轻咳，随后喘气明显。',
    route_review: '全文是同一猪群呼吸症状的连续变化。',
    required_facts: [{ text: '猪群', allowed_routes: ['ANIMAL'] }],
    acceptable_alternatives: [
      {
        units: [
          { exact_fragment: '猪群先是轻咳，', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          {
            exact_fragment: '随后喘气明显。',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS'],
          },
        ],
      },
      {
        units: [
          {
            exact_fragment: '猪群先是轻咳，随后喘气明显。',
            route: 'ANIMAL',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'CONTINUITY_PREFERS_STABILITY'],
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-symptom-appetite-continuity',
    source_text: '猪群先是轻咳，随后喘气越来越明显，采食量也开始下降。',
    route_review: '呼吸症状与采食下降可分成语义单元，但主视觉都是同一猪群。',
    required_facts: [
      { text: '轻咳', allowed_routes: ['ANIMAL'] },
      { text: '采食量', allowed_routes: ['ANIMAL'] },
    ],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '猪群先是轻咳，随后喘气越来越明显，',
            route: 'ANIMAL',
            continuity_actions: ['START_NEW'],
          },
          {
            exact_fragment: '采食量也开始下降。',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'SEMANTIC_BOUNDARY_CAN_KEEP_VISUAL'],
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-context-applicable-product',
    source_text: '包装正面写着“适用于猪”。',
    route_review: '上下文明确把包装正面文字作为查看对象。',
    required_facts: [{ text: '包装正面', allowed_routes: ['PRODUCT'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '包装正面写着“适用于猪”。',
            route: 'PRODUCT',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'CONTEXT_DETERMINES_APPLICABLE_TO_PIG'],
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-context-applicable-animal',
    source_text: '这套饲养方法适用于猪，画面展示健康猪群活动。',
    route_review: '上下文明确把健康猪群活动作为主视觉。',
    required_facts: [{ text: '健康猪群活动', allowed_routes: ['ANIMAL'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '这套饲养方法适用于猪，画面展示健康猪群活动。',
            route: 'ANIMAL',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'CONTEXT_DETERMINES_APPLICABLE_TO_PIG'],
    forbidden_outcomes: [],
    expected_needs_review: false,
  },
  ...individuallyReviewedCases,
];

function codePoints(value: string): string[] {
  return Array.from(value);
}

function exactStructuralValidity(
  sourceText: string,
  proposal: ShotPlanSemanticProposalV1,
): boolean {
  const source = codePoints(sourceText);
  let cursor = 0;
  for (const unit of proposal.units) {
    const fragment = codePoints(unit.exact_fragment);
    const starts: number[] = [];
    for (let start = cursor; start <= source.length - fragment.length; start += 1) {
      if (!fragment.every((point, index) => source[start + index] === point)) continue;
      if (unit.left_context !== undefined) {
        const left = codePoints(unit.left_context);
        if (
          start < left.length ||
          source.slice(start - left.length, start).join('') !== unit.left_context
        ) {
          continue;
        }
      }
      if (unit.right_context !== undefined) {
        const end = start + fragment.length;
        const right = codePoints(unit.right_context);
        if (source.slice(end, end + right.length).join('') !== unit.right_context) continue;
      }
      starts.push(start);
    }
    if (starts.length !== 1) return false;
    const start = starts[0]!;
    if (!/^\p{White_Space}*$/u.test(source.slice(cursor, start).join(''))) return false;
    cursor = start + fragment.length;
  }
  return /^\p{White_Space}*$/u.test(source.slice(cursor).join(''));
}

function sameSegmentation(
  proposal: ShotPlanSemanticProposalV1,
  alternative: SemanticGoldenAlternativeV1,
): boolean {
  return (
    proposal.units.length === alternative.units.length &&
    proposal.units.every(
      (unit, index) => unit.exact_fragment === alternative.units[index]?.exact_fragment,
    )
  );
}

export function evaluateShotPlanSemanticProposalV1(
  fixture: ShotPlanSemanticGoldenFixtureV1,
  rawProposal: unknown,
): ShotPlanSemanticEvaluationV1 {
  const parsed = shotPlanSemanticProposalV1Schema.safeParse(rawProposal);
  if (!parsed.success) {
    return {
      structural_validity: false,
      segmentation: false,
      route: false,
      continuity: false,
      needs_review: false,
      forbidden_outcome_violations: [],
    };
  }
  const proposal = parsed.data;
  const matchingAlternatives = fixture.acceptable_alternatives.filter((alternative) =>
    sameSegmentation(proposal, alternative),
  );
  const route = fixture.required_facts.every((fact) =>
    proposal.units.some(
      (unit) => unit.exact_fragment.includes(fact.text) && fact.allowed_routes.includes(unit.route),
    ),
  );
  const continuity = matchingAlternatives.some((alternative) =>
    proposal.units.every((unit, index) => {
      const golden = alternative.units[index];
      if (!golden) return false;
      if ((golden.route_state ?? 'RESOLVED') !== unit.route_state) return false;
      if ((golden.continuity_state ?? 'RESOLVED') !== unit.continuity_state) return false;
      return (
        golden.continuity_actions.length === 0 ||
        (unit.continuity_action !== null &&
          golden.continuity_actions.includes(unit.continuity_action))
      );
    }),
  );
  const actualNeedsReview =
    proposal.segmentation_state === 'NEEDS_REVIEW' ||
    proposal.units.some(
      (unit) => unit.route_state === 'NEEDS_REVIEW' || unit.continuity_state === 'NEEDS_REVIEW',
    );
  const forbidden = fixture.forbidden_outcomes
    .filter((outcome) =>
      proposal.units.some(
        (unit) => unit.exact_fragment.includes(outcome.fragment) && unit.route === outcome.route,
      ),
    )
    .map((outcome) => outcome.reason);
  return {
    structural_validity: exactStructuralValidity(fixture.source_text, proposal),
    segmentation: matchingAlternatives.length > 0,
    route,
    continuity,
    needs_review: actualNeedsReview === fixture.expected_needs_review,
    forbidden_outcome_violations: forbidden,
  };
}
