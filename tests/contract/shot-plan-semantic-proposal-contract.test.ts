import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { shotPlanSemanticProposalV1Schema } from '../../packages/contracts/src/index.js';

const valid = {
  schema_version: '1.0',
  segmentation_state: 'RESOLVED',
  review_warnings: [],
  units: [
    {
      exact_fragment: '猪群出现咳喘。',
      route: 'ANIMAL',
      route_state: 'RESOLVED',
      continuity_action: 'START_NEW',
      continuity_state: 'RESOLVED',
      rationale: '呈现动物症状。',
      review_warnings: [],
    },
  ],
} as const;

describe('ShotPlanSemanticProposalV1 raw model contract', () => {
  it('accepts the narrow whole-document semantic proposal', () => {
    expect(shotPlanSemanticProposalV1Schema.parse(valid)).toEqual(valid);
  });

  it.each(['source_start', 'source_end', 'slot_id'])('rejects model-owned %s', (field) => {
    const proposal = structuredClone(valid) as Record<string, unknown> & {
      units: Array<Record<string, unknown>>;
    };
    proposal.units[0]![field] = field.includes('source_') ? 0 : 'forbidden';
    expect(() => shotPlanSemanticProposalV1Schema.parse(proposal)).toThrow();
  });

  it.each(['candidate_id', 'candidate_revision', 'shot_plan_id', 'created_at'])(
    'rejects top-level trusted identity %s',
    (field) => {
      expect(() =>
        shotPlanSemanticProposalV1Schema.parse({ ...valid, [field]: 'forbidden' }),
      ).toThrow();
    },
  );

  it('allows exact context anchors but no fuzzy source identity', () => {
    const proposal = structuredClone(valid) as Record<string, unknown> & {
      units: Array<Record<string, unknown>>;
    };
    proposal.units[0]!.left_context = '开头：';
    proposal.units[0]!.right_context = '建议及时处理。';
    expect(shotPlanSemanticProposalV1Schema.parse(proposal).units[0]).toMatchObject({
      left_context: '开头：',
      right_context: '建议及时处理。',
    });
  });

  it('requires resolved route/continuity facts and START_NEW for the first resolved unit', () => {
    expect(() =>
      shotPlanSemanticProposalV1Schema.parse({
        ...valid,
        units: [{ ...valid.units[0], route: null }],
      }),
    ).toThrow();
    expect(() =>
      shotPlanSemanticProposalV1Schema.parse({
        ...valid,
        units: [{ ...valid.units[0], continuity_action: 'CONTINUE_PREVIOUS' }],
      }),
    ).toThrow();
  });

  it('ships a strict JSON Schema 2020-12 companion', () => {
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
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, unexpected: true })).toBe(false);
    expect(validate({ ...valid, units: [{ ...valid.units[0], source_start: 0 }] })).toBe(false);
    expect(validate({ ...valid, units: [{ ...valid.units[0], route: null }] })).toBe(false);
  });
});
