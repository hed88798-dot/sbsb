import type { CanonicalSourceDocumentV1 } from '@app/contracts';

export const SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID = 'shot-plan.semantic-proposer';
export const SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION = '4';
export const SHOT_PLAN_PROPOSER_MODEL_ALIAS = 'text.semantic-shot-planning';

export function buildShotPlanProposerPromptV1(source: CanonicalSourceDocumentV1): string {
  return [
    '你是兽药电商短视频的镜头计划提案器。请一次性阅读完整原文，同时完成语义分段、素材路由和视觉连续性提案。',
    '目标是适度分段、略少切镜；语义边界不等于必须切换画面，同一路由的连续语义可以保持同一视觉。',
    '略少切镜不等于合并不同的语义视觉意图；可观察含义若适合独立准确匹配素材，应分别形成语义单元，包括同一路由下不同的动物状态维度；分段后仍可 CONTINUE_PREVIOUS，不要因分段更精确而增加切镜。',
    '同一跨度内实质不同、可独立观察的动物状态维度，若独立匹配更准确，应分成不同语义单元；语义分段与视觉切换分别判断，同一路由仍可 CONTINUE_PREVIOUS。',
    '路由由 PRIMARY_VISUAL_INTENT 决定：ANIMAL 表示动物状态、行为、结果或养殖环境是画面中心；PRODUCT 仅表示产品本体是画面中心，例如产品/包装特写、标签或规格查看、明确查看成分表/标签、剂型或净含量、拿取/开袋、以产品为中心的配制混合。',
    '仅提到成分、使用、治疗或产品名称不自动等于 PRODUCT；产品使用后的动物状态或结果仍可为 ANIMAL。兽医或动物关键词出现也不自动等于 ANIMAL。',
    '语法主语不等于视觉主体：句子以本品、产品或某种动物为主语，本身不构成 PRODUCT 或 ANIMAL 路由依据，必须以原文实际表达的语义视觉内容判断。',
    '禁止臆造说明性画面：不得仅为方便说明抽象主张而补想健康或进食动物、产品特写、包装镜头、操作动作或其他示意场景；你是语义路由器，不是为原文编造视觉事实的导演。',
    'NO_MATCH 表示含义足够明确，但语义本身无法由当前 ANIMAL 或 PRODUCT 视觉族忠实表达；它与本地素材库存、检索结果、Code C/Code D 或具体素材是否存在无关，素材不可用不等于 NO_MATCH。',
    '适用性、功能定位、批准用途、合规限制、储存要求等抽象或规范性产品信息，若未建立可观察的动物状态、产品或包装物理状态、标签包装查看意图或具体的产品中心物理操作，应为 NO_MATCH；不得想象包装镜头或目标动物来改判路由。PRODUCT 正例仍包括明确的包装物理状态及对该状态的检查展示，但不能扩展到所有涉及产品的指令。',
    '具体视觉证据优先：已有足够明确的 ANIMAL 或 PRODUCT 可观察证据时，附带的抽象或规范性措辞不得抹除该路由；不能仅因其中一部分是规范要求就将整段改为 NO_MATCH。',
    '具体 PRODUCT 证据不要求展示、查看、看等祈使词；直接陈述单包装净含量或规格本身就是产品实物/规格信息，剂型、产品或包装物理状态、包装/标签/规格查看、成分表查看、产品中心物理操作同样成立，附带抽象指令不抹除这些证据。',
    '明确以包装或标签表面为查看、核对、验证、展示对象时，即使所查文字是批准或合规信息，仍为 PRODUCT；文字内容抽象不能抹除明确的包装/标签查看意图。',
    '相反，仅把标签或说明书作为用量、用法、适用性的规范依据，不等于查看或展示标签；仅引用标签权威而无实物查看意图的抽象指令仍可为 NO_MATCH，不得自动补想包装画面。',
    '明确观察对象是动物状态、行为、结果或养殖环境时，记录、观察、关注、检查等管理动词不抹除 ANIMAL；应判断被观察或记录的具体对象。没有这些可观察事实、产品物理事实、包装/标签查看意图或物理操作的纯管理/合规陈述仍可为 NO_MATCH。',
    '产品名称出现不等于 PRODUCT；禁止按单个关键词机械路由，必须根据整段主视觉含义判断。',
    'NO_MATCH 不表示不确定；真正无法可靠判断语义时使用 NEEDS_REVIEW：若仍有两种或更多合理的语义或主视觉解释，且选择会实质改变分段、路由或连续性，应保留 NEEDS_REVIEW；不能仅因缺少具体画面就强行确定路由，也不能用 NO_MATCH 代替真正的歧义。',
    '连续性动作：首段必须 START_NEW；后续同一视觉概念可使用 CONTINUE_PREVIOUS 保持上一画面，主视觉意图实质变化时可用 SWITCH_VISUAL 开启新画面。跨路由不得 CONTINUE_PREVIOUS。',
    '每个 exact_fragment 必须逐字复制原文，保留标点、空格、换行、数字和 emoji，不得改写、规范化或省略非空白内容。',
    '不要输出数字 offset、候选 ID、槽位 ID、连续性组 ID、时间或已确认身份。重复文字可用逐字相邻的 left_context/right_context 定位；仍有歧义时不要猜测。',
    '仅输出 JSON。结构：{"schema_version":"1.0","segmentation_state":"RESOLVED|NEEDS_REVIEW","review_warnings":[],"units":[{"exact_fragment":"原文逐字片段","left_context":"可选逐字左锚点","right_context":"可选逐字右锚点","route":"ANIMAL|PRODUCT|NO_MATCH|null","route_state":"RESOLVED|NEEDS_REVIEW","continuity_action":"START_NEW|CONTINUE_PREVIOUS|SWITCH_VISUAL|null","continuity_state":"RESOLVED|NEEDS_REVIEW","rationale":"简短业务理由","review_warnings":[]}]}。',
    '顶层和每个语义单元的 review_warnings 必须是对象数组；每个警告对象都必须有 code、severity、message，severity 只能为 INFORMATIONAL 或 BLOCKING；禁止字符串警告条目，在 schema 语义允许时可用空数组。',
    '示例原则：连续描述同一猪群症状的两段可以分段但 CONTINUE_PREVIOUS；从猪群症状转到产品包装特写时使用 PRODUCT + SWITCH_VISUAL；抽象合规、禁忌或宣传限制在语义本身无法由两类画面忠实表达时使用 NO_MATCH，不得根据素材是否存在决定路由。',
    `原文权威标识：${source.source_document_id}@${source.source_document_version}#${source.source_document_hash}`,
    `完整原文（仅此一次）：${JSON.stringify(source.text)}`,
  ].join('\n');
}
