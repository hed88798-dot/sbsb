import { commonRequest, factLockBlock, type PromptTemplateV1 } from './types.js';

const operationLabel = {
  STRUCTURE: '结构优化',
  OPENING: '开头优化',
  COMPRESS: '压缩',
  EXPAND: '扩写',
  COLLOQUIAL: '口语化',
} as const;

export const optimizePromptV1: PromptTemplateV1 = {
  id: 'copywriting.optimize',
  version: '1',
  build(context) {
    const operation = context.request.optimize_operation;
    return [
      `任务：对原文执行${operation ? operationLabel[operation] : '文案优化'}。只改变表达，不改变产品事实。`,
      factLockBlock(context.factSnapshot),
      commonRequest(context),
      `原文：\n${context.request.source_text ?? ''}`,
    ].join('\n\n');
  },
};
