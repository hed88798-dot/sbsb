import { commonRequest, factLockBlock, type PromptTemplateV1 } from './types.js';

export const productSalesPromptV1: PromptTemplateV1 = {
  id: 'copywriting.product-sales',
  version: '1',
  build(context) {
    return [
      '任务：仅依据锁定事实创作中文产品口播文案。不得猜测疗效、批准范围、规格、对象或用量。',
      factLockBlock(context.factSnapshot),
      commonRequest(context),
    ].join('\n\n');
  },
};
