import { describe, expect, it } from 'vitest';
import { checkProductFacts } from '../../packages/domain-copywriting/src/index.js';
import { factRegressionFixtures } from '../../packages/test-fixtures/src/index.js';

describe('100 条 Product Fact Regression', () => {
  it('contains exactly 100 fixed synthetic scenarios', () => {
    expect(factRegressionFixtures).toHaveLength(100);
  });

  it.each(factRegressionFixtures)('$id ($workflow)', (fixture) => {
    const conflicts = checkProductFacts(fixture.snapshot, fixture.output);
    if (fixture.expectedConflictField === null) {
      expect(conflicts).toEqual([]);
    } else {
      expect(conflicts.map((conflict) => conflict.field)).toContain(fixture.expectedConflictField);
    }
  });
});
