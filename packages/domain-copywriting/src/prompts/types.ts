import type { CopywritingGenerateRequestV1, ProductFactSnapshotV1 } from '@app/contracts';

export interface PromptContextV1 {
  request: CopywritingGenerateRequestV1;
  factSnapshot: ProductFactSnapshotV1 | null;
}

export interface PromptTemplateV1 {
  id: string;
  version: '1';
  build(context: PromptContextV1): string;
}

export function factLockBlock(facts: ProductFactSnapshotV1 | null): string {
  if (!facts) return '本次没有锁定产品事实。不得自行编造企业产品信息。';
  return [
    '以下 JSON 是不可改写的锁定产品事实。只可改变表达，不能改变、补造或删除其含义：',
    JSON.stringify(facts, null, 2),
    '如果无法在不改变事实的前提下完成任务，应明确说明需要人工处理。',
  ].join('\n');
}

export function commonRequest(context: PromptContextV1): string {
  const { request } = context;
  return [
    `内容方向：${request.direction || '未指定'}`,
    `目标时长：${request.target_duration_seconds} 秒`,
    `风格：${request.style}`,
    `口语化程度：${request.colloquial_level}/3`,
    `用户需求：${request.requirements || '无补充'}`,
  ].join('\n');
}
