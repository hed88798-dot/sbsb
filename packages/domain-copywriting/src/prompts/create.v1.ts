import { commonRequest, factLockBlock, type PromptTemplateV1 } from './types.js';

export const createPromptV1: PromptTemplateV1 = {
  id: 'copywriting.create',
  version: '1',
  build(context) {
    return [
      '任务：从零创作一段中文短视频口播文案。输出只包含可直接使用的文案正文。',
      factLockBlock(context.factSnapshot),
      commonRequest(context),
    ].join('\n\n');
  },
};
