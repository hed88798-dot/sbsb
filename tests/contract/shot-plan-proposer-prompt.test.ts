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
    expect(SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION).toBe('1');
    const prompt = buildShotPlanProposerPromptV1(source);
    expect(prompt.split(source.text)).toHaveLength(2);
    expect(prompt).toContain(source.source_document_hash);
  });

  it.each([
    '适度分段、略少切镜',
    '语义边界不等于必须切换画面',
    '产品名称出现不等于 PRODUCT',
    '兽医或动物关键词出现不等于 ANIMAL',
    'NO_MATCH 不表示不确定',
    '不等于检索失败',
    '真正无法可靠判断语义时使用 NEEDS_REVIEW',
    '跨路由不得 CONTINUE_PREVIOUS',
    '不得改写、规范化或省略非空白内容',
    '不要输出数字 offset',
    '简短业务理由',
  ])('encodes the frozen product rule: %s', (rule) => {
    expect(buildShotPlanProposerPromptV1(source)).toContain(rule);
  });
});
