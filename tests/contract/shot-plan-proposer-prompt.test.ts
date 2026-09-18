import { describe, expect, it } from 'vitest';
import {
  buildShotPlanProposerPromptV1,
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
} from '../../apps/desktop/src/main/shot-plan-proposer-prompt.v1.js';
import type { CanonicalSourceDocumentV1 } from '../../packages/contracts/src/index.js';

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
    expect(SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION).toBe('2');
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
  ])('encodes the frozen product rule: %s', (rule) => {
    expect(buildShotPlanProposerPromptV1(source)).toContain(rule);
  });

  it('does not define PRODUCT by a generic ingredient/use mention or NO_MATCH by asset availability', () => {
    const prompt = buildShotPlanProposerPromptV1(source);
    expect(prompt).not.toContain('PRODUCT 表示产品、包装、成分或使用展示');
    expect(prompt).not.toContain('无可匹配企业素材');
  });
});
