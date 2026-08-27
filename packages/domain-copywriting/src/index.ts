import type { CopywritingGenerateRequestV1, ProductFactSnapshotV1 } from '@app/contracts';
import { sha256 } from '@app/domain-product';
import { createPromptV1 } from './prompts/create.v1.js';
import { dedupeDeepPromptV1 } from './prompts/dedupe-deep.v1.js';
import { dedupeLightPromptV1 } from './prompts/dedupe-light.v1.js';
import { dedupeMediumPromptV1 } from './prompts/dedupe-medium.v1.js';
import { optimizePromptV1 } from './prompts/optimize.v1.js';
import { productSalesPromptV1 } from './prompts/product-sales.v1.js';
import type { PromptTemplateV1 } from './prompts/types.js';

export { checkProductFacts } from './fact-lock.js';
export type { PromptTemplateV1 } from './prompts/types.js';

export function selectPromptTemplate(request: CopywritingGenerateRequestV1): PromptTemplateV1 {
  if (request.mode === 'PRODUCT') return productSalesPromptV1;
  if (request.mode === 'OPTIMIZE') return optimizePromptV1;
  if (request.mode === 'DEDUPE') {
    if (request.dedupe_level === 'DEEP') return dedupeDeepPromptV1;
    if (request.dedupe_level === 'MEDIUM') return dedupeMediumPromptV1;
    return dedupeLightPromptV1;
  }
  return createPromptV1;
}

export function buildCopywritingPrompt(
  request: CopywritingGenerateRequestV1,
  factSnapshot: ProductFactSnapshotV1 | null,
): { prompt: string; template: PromptTemplateV1; requestHash: string } {
  const template = selectPromptTemplate(request);
  const prompt = template.build({ request, factSnapshot });
  return {
    prompt,
    template,
    requestHash: sha256({
      request,
      factSnapshot,
      templateId: template.id,
      templateVersion: template.version,
    }),
  };
}
