import { describe, expect, it } from 'vitest';
import { buildCopywritingPrompt } from '../../packages/domain-copywriting/src/index.js';
import { factRegressionFixtures } from '../../packages/test-fixtures/src/index.js';

const snapshot = factRegressionFixtures[0]!.snapshot;
const base = {
  schema_version: '1.0' as const,
  request_id: 'prompt_fixture',
  direction: '产品介绍',
  target_duration_seconds: 30,
  style: '专业清晰',
  colloquial_level: 1,
  requirements: '',
};

describe('versioned copywriting prompts', () => {
  it.each([
    [{ ...base, mode: 'CREATE' as const }, 'copywriting.create'],
    [
      { ...base, mode: 'PRODUCT' as const, product_id: snapshot.product_id },
      'copywriting.product-sales',
    ],
    [
      {
        ...base,
        mode: 'OPTIMIZE' as const,
        source_text: '原文',
        optimize_operation: 'STRUCTURE' as const,
      },
      'copywriting.optimize',
    ],
    [
      { ...base, mode: 'DEDUPE' as const, source_text: '原文', dedupe_level: 'LIGHT' as const },
      'copywriting.dedupe-light',
    ],
    [
      { ...base, mode: 'DEDUPE' as const, source_text: '原文', dedupe_level: 'MEDIUM' as const },
      'copywriting.dedupe-medium',
    ],
    [
      { ...base, mode: 'DEDUPE' as const, source_text: '原文', dedupe_level: 'DEEP' as const },
      'copywriting.dedupe-deep',
    ],
  ])('selects %s', (request, templateId) => {
    const built = buildCopywritingPrompt(request, snapshot);
    expect(built.template.id).toBe(templateId);
    expect(built.template.version).toBe('1');
    expect(built.prompt).toContain(snapshot.name);
    expect(built.prompt).toContain(snapshot.specification);
    expect(built.requestHash).toHaveLength(64);
  });
});
