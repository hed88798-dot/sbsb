import { commonRequest, factLockBlock, type PromptTemplateV1 } from './types.js';

export const dedupeMediumPromptV1: PromptTemplateV1 = {
  id: 'copywriting.dedupe-medium',
  version: '1',
  build(context) {
    return [
      '任务：中度去重。重组句式与段落，但不得改变任何锁定事实。',
      factLockBlock(context.factSnapshot),
      commonRequest(context),
      `原文：\n${context.request.source_text ?? ''}`,
    ].join('\n\n');
  },
};
