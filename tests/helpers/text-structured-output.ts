import type { TextStructuredOutputV1 } from '../../packages/contracts/src/index.js';

export const structuredOutput: TextStructuredOutputV1 = {
  mode: 'JSON_SCHEMA_STRICT',
  schema_name: 'synthetic_label-v1',
  schema: {
    type: 'object',
    properties: { label: { type: 'string', description: 'Synthetic label 标签' } },
    required: ['label'],
    additionalProperties: false,
    $defs: { optionalValue: { type: ['string', 'null'] } },
  },
};

export const textRequest = {
  schema_version: '1.0' as const,
  request_id: 'structured_text_001',
  capability: 'text.generate.v1' as const,
  model_alias: 'mock-v1',
  prompt: 'Return a synthetic label.',
  request_snapshot_hash: 'a'.repeat(64),
};
