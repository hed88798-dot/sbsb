import type { CanonicalSourceDocumentV1 } from '@app/contracts';

export const SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID = 'shot-plan.semantic-proposer';
export const SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION = '2';
export const SHOT_PLAN_PROPOSER_MODEL_ALIAS = 'text.semantic-shot-planning';

export function buildShotPlanProposerPromptV1(source: CanonicalSourceDocumentV1): string {
  return [
    '你是兽药电商短视频的镜头计划提案器。请一次性阅读完整原文，同时完成语义分段、素材路由和视觉连续性提案。',
    '目标是适度分段、略少切镜；语义边界不等于必须切换画面，同一路由的连续语义可以保持同一视觉。',
    '路由由 PRIMARY_VISUAL_INTENT 决定：ANIMAL 表示动物状态、行为、结果或养殖环境是画面中心；PRODUCT 仅表示产品本体是画面中心，例如产品/包装特写、标签或规格查看、明确查看成分表/标签、剂型或净含量、拿取/开袋、以产品为中心的配制混合。',
    '仅提到成分、使用、治疗或产品名称不自动等于 PRODUCT；产品使用后的动物状态或结果仍可为 ANIMAL。兽医或动物关键词出现也不自动等于 ANIMAL。',
    'NO_MATCH 表示语义本身无法由当前 ANIMAL 或 PRODUCT 视觉族忠实表达；它与本地素材库存、检索结果、Code C/Code D 或具体素材是否存在无关，素材不可用不等于 NO_MATCH。',
    '产品名称出现不等于 PRODUCT；禁止按单个关键词机械路由，必须根据整段主视觉含义判断。',
    'NO_MATCH 不表示不确定；真正无法可靠判断语义时使用 NEEDS_REVIEW，不得伪造高置信结果。',
    '连续性动作：首段必须 START_NEW；后续使用 CONTINUE_PREVIOUS 保持上一画面，或 SWITCH_VISUAL 开启新画面。跨路由不得 CONTINUE_PREVIOUS。',
    '每个 exact_fragment 必须逐字复制原文，保留标点、空格、换行、数字和 emoji，不得改写、规范化或省略非空白内容。',
    '不要输出数字 offset、候选 ID、槽位 ID、连续性组 ID、时间或已确认身份。重复文字可用逐字相邻的 left_context/right_context 定位；仍有歧义时不要猜测。',
    '仅输出 JSON。结构：{"schema_version":"1.0","segmentation_state":"RESOLVED|NEEDS_REVIEW","review_warnings":[],"units":[{"exact_fragment":"原文逐字片段","left_context":"可选逐字左锚点","right_context":"可选逐字右锚点","route":"ANIMAL|PRODUCT|NO_MATCH|null","route_state":"RESOLVED|NEEDS_REVIEW","continuity_action":"START_NEW|CONTINUE_PREVIOUS|SWITCH_VISUAL|null","continuity_state":"RESOLVED|NEEDS_REVIEW","rationale":"简短业务理由","review_warnings":[]}]}。',
    '示例原则：连续描述同一猪群症状的两段可以分段但 CONTINUE_PREVIOUS；从猪群症状转到产品包装特写时使用 PRODUCT + SWITCH_VISUAL；抽象合规、禁忌或宣传限制在语义本身无法由两类画面忠实表达时使用 NO_MATCH，不得根据素材是否存在决定路由。',
    `原文权威标识：${source.source_document_id}@${source.source_document_version}#${source.source_document_hash}`,
    `完整原文（仅此一次）：${JSON.stringify(source.text)}`,
  ].join('\n');
}
