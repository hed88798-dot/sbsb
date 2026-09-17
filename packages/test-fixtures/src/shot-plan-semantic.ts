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

function regularFixture(
  index: number,
  animal: string,
  product: string,
): ShotPlanSemanticGoldenFixtureV1 {
  return {
    id: `vet-commerce-${String(index).padStart(2, '0')}`,
    source_text: `${animal}${product}`,
    required_facts: [
      { text: animal, allowed_routes: ['ANIMAL'] },
      { text: product, allowed_routes: ['PRODUCT'] },
    ],
    acceptable_alternatives: [
      {
        units: [
          { exact_fragment: animal, route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          { exact_fragment: product, route: 'PRODUCT', continuity_actions: ['SWITCH_VISUAL'] },
        ],
      },
    ],
    must_have_invariants: invariants,
    forbidden_outcomes: [],
    expected_needs_review: false,
  };
}

const regularCases = [
  ['猪群换季时容易出现咳喘。', '本品每袋100g，按说明使用。'],
  ['仔猪断奶后采食量下降。', '展示产品包装和颗粒形态。'],
  ['母猪产后需要关注恢复状态。', '本品适用于日常营养补充。'],
  ['鸡群精神不振并伴随羽毛蓬松。', '请核对包装上的批准范围。'],
  ['鸭群饮水量出现明显变化。', '产品用量以标签说明为准。'],
  ['牛群反刍次数减少。', '展示本品正面包装。'],
  ['羊群换料后需要观察粪便。', '本品规格为500g每袋。'],
  ['育肥猪采食速度变慢。', '使用前请阅读禁忌事项。'],
  ['蛋鸡产蛋状态需要持续记录。', '展示产品成分表。'],
  ['肉鸡进场后应观察适应情况。', '本品按批准用法使用。'],
  ['犊牛精神状态需要每日检查。', '展示包装批号区域。'],
  ['羔羊转群后出现应激表现。', '产品应密封保存。'],
  ['猪舍温差较大时要加强巡栏。', '展示本品开袋后的形态。'],
  ['鸡舍湿度升高后需检查垫料。', '产品包装应保持完整。'],
  ['鸭舍通风不足会影响群体状态。', '展示本品规格信息。'],
  ['牛舍采食区需要保持清洁。', '本品仅按批准对象使用。'],
  ['羊群长途运输后需要补充饮水。', '展示产品使用说明。'],
  ['仔猪保育阶段应关注温度变化。', '本品禁止超范围宣传。'],
  ['母猪配种前应记录体况。', '展示产品防伪标识。'],
  ['蛋鸡转舍后需要观察饮水。', '本品规格不得改写。'],
  ['肉鸡免疫后应持续巡查。', '展示产品标签上的用量。'],
  ['犊牛断奶期需要平稳过渡。', '本品适用对象以批准信息为准。'],
  ['羊舍夜间降温时要及时保温。', '展示产品外箱与内袋。'],
  ['育肥猪转栏后需要减少惊扰。', '本品禁忌信息必须保留。'],
] as const;

export const shotPlanSemanticGoldenFixturesV1: ShotPlanSemanticGoldenFixtureV1[] = [
  {
    id: 'vet-commerce-alt-segmentation',
    source_text: '猪群咳喘并伴采食下降。展示本品包装。',
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
    required_facts: [{ text: '本品', allowed_routes: ['PRODUCT'] }],
    acceptable_alternatives: [
      {
        units: [
          {
            exact_fragment: '本品适用于猪群日常营养补充。',
            route: 'PRODUCT',
            continuity_actions: ['START_NEW'],
          },
        ],
      },
    ],
    must_have_invariants: [...invariants, 'NO_KEYWORD_ONLY_ROUTING'],
    forbidden_outcomes: [
      { fragment: '猪群', route: 'ANIMAL', reason: '不能只因出现“猪群”就改为动物画面' },
    ],
    expected_needs_review: false,
  },
  {
    id: 'vet-commerce-duplicate-anchor',
    source_text: '症状段：增强采食。产品段：增强采食。',
    required_facts: [
      { text: '症状段：', allowed_routes: ['ANIMAL'] },
      { text: '产品段：', allowed_routes: ['PRODUCT'] },
    ],
    acceptable_alternatives: [
      {
        units: [
          { exact_fragment: '症状段：', route: 'ANIMAL', continuity_actions: ['START_NEW'] },
          {
            exact_fragment: '增强采食。',
            left_context: '症状段：',
            route: 'ANIMAL',
            continuity_actions: ['CONTINUE_PREVIOUS'],
          },
          {
            exact_fragment: '产品段：',
            route: 'PRODUCT',
            continuity_actions: ['SWITCH_VISUAL'],
          },
          {
            exact_fragment: '增强采食。',
            left_context: '产品段：',
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
  ...regularCases
    .slice(0, 17)
    .map(([animal, product], index) => regularFixture(index + 14, animal, product)),
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
