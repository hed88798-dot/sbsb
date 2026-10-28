import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { normalizeOptionalContextNullV1 } from '../../apps/desktop/src/main/shot-plan-proposal-normalization.js';
import { shotPlanSemanticProposalV1Schema } from '../../packages/contracts/src/index.js';

const observed = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../fixtures/shot-planning/optional-context-null-observed.json'),
    'utf8',
  ),
) as { units: Array<Record<string, unknown>> };
const schema = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../schemas/shot-planning/v1/semantic-shot-plan-proposal.schema.json',
    ),
    'utf8',
  ),
) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function proposal(anchors: Record<string, unknown>) {
  const unit = { ...observed.units[0]! };
  delete unit.left_context;
  delete unit.right_context;
  return { ...observed, units: [{ ...unit, ...anchors }] };
}

describe('OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1', () => {
  it.each([
    [{}, 0, {}],
    [{ left_context: null }, 1, {}],
    [{ right_context: null }, 1, {}],
    [{ left_context: null, right_context: null }, 2, {}],
    [{ left_context: null, right_context: '🐖原样　' }, 1, { right_context: '🐖原样　' }],
    [{ left_context: ' 前🐖', right_context: null }, 1, { left_context: ' 前🐖' }],
    [
      { left_context: ' 前🐖', right_context: '后　' },
      0,
      { left_context: ' 前🐖', right_context: '后　' },
    ],
  ])('normalizes only exact null anchors: %j', (anchors, count, expected) => {
    const input = proposal(anchors);
    const before = JSON.stringify(input);
    const result = normalizeOptionalContextNullV1(input);
    expect(result.normalizedOptionalContextFields).toBe(count);
    expect(result.value).toEqual(proposal(expected));
    expect(JSON.stringify(input)).toBe(before);
    expect(shotPlanSemanticProposalV1Schema.safeParse(result.value).success).toBe(true);
    expect(validate(result.value)).toBe(true);
    if (count === 0) expect(result.value).toBe(input);
  });

  it('distinguishes raw Provider canonical failure from post-normalization success', () => {
    expect(shotPlanSemanticProposalV1Schema.safeParse(observed).success).toBe(false);
    expect(validate(observed)).toBe(false);
    const result = normalizeOptionalContextNullV1(observed);
    expect(result.normalizedOptionalContextFields).toBe(2);
    const canonical = shotPlanSemanticProposalV1Schema.parse(result.value);
    expect(validate(result.value)).toBe(true);
    expect(canonical.units[0]!.left_context).toBeUndefined();
    expect(canonical.units[0]!.right_context).toBeUndefined();
    expect(canonical.units[0]).toMatchObject({ route: 'ANIMAL', continuity_action: 'START_NEW' });
    expect(observed.units[0]).toMatchObject({ left_context: null, right_context: null });
  });

  it.each(['left_context', 'right_context'])('does not coerce invalid %s values', (field) => {
    for (const invalid of ['', 123, {}, [], true]) {
      const input = proposal({ [field]: invalid });
      const result = normalizeOptionalContextNullV1(input);
      expect(result.normalizedOptionalContextFields).toBe(0);
      expect(result.value).toBe(input);
      expect(shotPlanSemanticProposalV1Schema.safeParse(result.value).success).toBe(false);
      expect(validate(result.value)).toBe(false);
    }
  });

  it('preserves semantic nulls and NEEDS_REVIEW while removing only context nulls', () => {
    const input = proposal({
      left_context: null,
      right_context: null,
      route: null,
      route_state: 'NEEDS_REVIEW',
      continuity_action: null,
      continuity_state: 'NEEDS_REVIEW',
    });
    const canonical = shotPlanSemanticProposalV1Schema.parse(
      normalizeOptionalContextNullV1(input).value,
    );
    expect(canonical.units[0]!.route).toBeNull();
    expect(canonical.units[0]!.continuity_action).toBeNull();
    expect(canonical.units[0]!.route_state).toBe('NEEDS_REVIEW');
    expect(canonical.units[0]!.continuity_state).toBe('NEEDS_REVIEW');
  });

  it('does not strip other or nested nulls, mutate prototypes, or traverse invalid containers', () => {
    const input: unknown = JSON.parse(
      '{"left_context":null,"units":[{"left_context":null,"route":null,"nested":{"right_context":null},"__proto__":{"polluted":true}},null,[],4]}',
    );
    const result = normalizeOptionalContextNullV1(input);
    expect(result.normalizedOptionalContextFields).toBe(1);
    expect(result.value).toEqual(
      JSON.parse(
        '{"left_context":null,"units":[{"route":null,"nested":{"right_context":null},"__proto__":{"polluted":true}},null,[],4]}',
      ),
    );
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(shotPlanSemanticProposalV1Schema.safeParse(result.value).success).toBe(false);
    for (const value of [
      null,
      [],
      1,
      true,
      {},
      { units: null },
      { units: Array(501).fill(null) },
    ]) {
      expect(normalizeOptionalContextNullV1(value)).toEqual({
        value,
        normalizedOptionalContextFields: 0,
      });
    }
  });
});
