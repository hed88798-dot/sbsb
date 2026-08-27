import { commonRequest, factLockBlock, type PromptTemplateV1 } from './types.js';

export const dedupeDeepPromptV1: PromptTemplateV1 = {
  id: 'copywriting.dedupe-deep',
  version: '1',
  build(context) {
    return [
      '任务：深度去重。可重建叙述结构与表达方式，但产品名、成分、规格、适用对象、批准范围、用法用量、禁忌及禁用表述绝对不能变化。',
      factLockBlock(context.factSnapshot),
      commonRequest(context),
      `原文：\n${context.request.source_text ?? ''}`,
    ].join('\n\n');
  },
};
