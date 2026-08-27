import { commonRequest, factLockBlock, type PromptTemplateV1 } from './types.js';

export const dedupeLightPromptV1: PromptTemplateV1 = {
  id: 'copywriting.dedupe-light',
  version: '1',
  build(context) {
    return [
      '任务：轻度去重。替换少量措辞并微调语序，锁定事实逐字义保持。',
      factLockBlock(context.factSnapshot),
      commonRequest(context),
      `原文：\n${context.request.source_text ?? ''}`,
    ].join('\n\n');
  },
};
