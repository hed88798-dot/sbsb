import { describe, expect, it } from 'vitest';
import {
  buildShotPlanProposerPromptV1,
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
} from '../../apps/desktop/src/main/shot-plan-proposer-prompt.v1.js';
import type { CanonicalSourceDocumentV1 } from '../../packages/contracts/src/index.js';
import { shotPlanSemanticGoldenFixturesV1 } from '../../packages/test-fixtures/src/shot-plan-semantic.js';

const source: CanonicalSourceDocumentV1 = {
  schema_version: '1.0',
  source_document_id: 'script_prompt_fixture',
  source_document_version: 2,
  source_document_hash: 'a'.repeat(64),
  source_hash_scheme: 'SHA256_EXACT_UTF8_V1',
  source_offset_unit: 'UNICODE_CODE_POINT',
  source_kind: 'SCRIPT_VERSION',
  text: '使用康健100后，猪群采食状态逐步恢复。',
  created_at: '2026-09-17T00:00:00.000Z',
};

describe('versioned semantic Shot Plan prompt', () => {
  it('binds a stable template identity and includes the complete exact source once', () => {
    expect(SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID).toBe('shot-plan.semantic-proposer');
    expect(SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION).toBe('4');
    const prompt = buildShotPlanProposerPromptV1(source);
    expect(prompt.split(source.text)).toHaveLength(2);
    expect(prompt).toContain(source.source_document_hash);
  });

  it.each([
    '适度分段、略少切镜',
    '语义边界不等于必须切换画面',
    'PRIMARY_VISUAL_INTENT',
    'PRODUCT 仅表示产品本体是画面中心',
    '仅提到成分、使用、治疗或产品名称不自动等于 PRODUCT',
    '产品使用后的动物状态或结果仍可为 ANIMAL',
    '产品名称出现不等于 PRODUCT',
    '兽医或动物关键词出现也不自动等于 ANIMAL',
    'NO_MATCH 不表示不确定',
    '它与本地素材库存、检索结果、Code C/Code D 或具体素材是否存在无关',
    '素材不可用不等于 NO_MATCH',
    '真正无法可靠判断语义时使用 NEEDS_REVIEW',
    '跨路由不得 CONTINUE_PREVIOUS',
    '不得改写、规范化或省略非空白内容',
    '不要输出数字 offset',
    '简短业务理由',
    '含义足够明确',
    '两种或更多合理的语义或主视觉解释',
    '实质改变分段、路由或连续性',
    '不能用 NO_MATCH 代替真正的歧义',
    '禁止臆造说明性画面',
    '不得仅为方便说明抽象主张而补想',
    '语法主语不等于视觉主体',
    '适用性、功能定位、批准用途、合规限制、储存要求',
    '具体的产品中心物理操作',
    '明确的包装物理状态及对该状态的检查展示',
    '略少切镜不等于合并不同的语义视觉意图',
    '同一路由下不同的动物状态维度',
    '不要因分段更精确而增加切镜',
    '具体视觉证据优先',
    '附带的抽象或规范性措辞不得抹除该路由',
    '不能仅因其中一部分是规范要求就将整段改为 NO_MATCH',
    '具体 PRODUCT 证据不要求展示、查看、看等祈使词',
    '直接陈述单包装净含量或规格本身就是产品实物/规格信息',
    '明确以包装或标签表面为查看、核对、验证、展示对象',
    '文字内容抽象不能抹除明确的包装/标签查看意图',
    '仅引用标签权威而无实物查看意图的抽象指令仍可为 NO_MATCH',
    '记录、观察、关注、检查等管理动词不抹除 ANIMAL',
    '没有这些可观察事实、产品物理事实、包装/标签查看意图或物理操作的纯管理/合规陈述仍可为 NO_MATCH',
    '实质不同、可独立观察的动物状态维度',
    '语义分段与视觉切换分别判断',
    '顶层和每个语义单元的 review_warnings 必须是对象数组',
    '每个警告对象都必须有 code、severity、message',
    'severity 只能为 INFORMATIONAL 或 BLOCKING',
    '禁止字符串警告条目',
    '在 schema 语义允许时可用空数组',
  ])('encodes the frozen product rule: %s', (rule) => {
    expect(buildShotPlanProposerPromptV1(source)).toContain(rule);
  });

  it('does not define PRODUCT by a generic ingredient/use mention or NO_MATCH by asset availability', () => {
    const prompt = buildShotPlanProposerPromptV1(source);
    expect(prompt).not.toContain('PRODUCT 表示产品、包装、成分或使用展示');
    expect(prompt).not.toContain('无可匹配企业素材');
  });

  it('contains general rules without golden IDs, source texts or expected JSON', () => {
    const prompt = buildShotPlanProposerPromptV1({ ...source, text: '独立测试原文。' });
    for (const fixture of shotPlanSemanticGoldenFixturesV1) {
      expect(prompt).not.toContain(fixture.id);
      expect(prompt).not.toContain(fixture.source_text);
      for (const alternative of fixture.acceptable_alternatives) {
        for (const unit of alternative.units) expect(prompt).not.toContain(unit.exact_fragment);
      }
      expect(prompt).not.toContain(JSON.stringify(fixture.acceptable_alternatives));
    }
    expect(prompt).not.toMatch(/(?:case\s*|Golden\s*#?|#)\d+/iu);
    expect(prompt.length).toBeLessThan(4500);
  });
});
