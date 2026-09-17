import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { candidateShotPlanV1Schema } from '../../packages/contracts/src/index.js';

const valid = {
  schema_version: '1.0',
  candidate_id: 'candidate_1',
  candidate_revision: 1,
  candidate_status: 'ACTIVE',
  source_document_id: 'document_1',
  source_document_version: 1,
  source_document_hash: 'a'.repeat(64),
  source_offset_unit: 'UNICODE_CODE_POINT',
  segmentation_state: 'RESOLVED',
  review_warnings: [],
  slots: [
    {
      slot_id: 'slot_1',
      order_index: 0,
      source_start: 0,
      source_end: 2,
      source_text: '猪群',
      route: 'ANIMAL',
      route_state: 'RESOLVED',
      visual_continuity_group_id: 'group_1',
      continuity_state: 'RESOLVED',
      rationale: '主要表达猪群状态。',
      review_warnings: [],
    },
  ],
  created_at: '2026-09-17T00:00:00.000Z',
  updated_at: '2026-09-17T00:00:00.000Z',
} as const;

describe('CandidateShotPlanV1 contract', () => {
  it('accepts a strict review-oriented candidate', () => {
    expect(candidateShotPlanV1Schema.parse(valid)).toEqual(valid);
  });

  it('is non-executable and does not impersonate ConfirmedShotPlanV1', () => {
    const parsed = candidateShotPlanV1Schema.parse(valid);
    expect(parsed).not.toHaveProperty('review_state');
    expect(parsed).not.toHaveProperty('shot_plan_hash');
  });

  it('rejects unknown fields including raw provider reasoning', () => {
    expect(() =>
      candidateShotPlanV1Schema.parse({ ...valid, raw_provider_reasoning: 'hidden reasoning' }),
    ).toThrow();
  });

  it('requires a positive deterministic candidate revision', () => {
    expect(() => candidateShotPlanV1Schema.parse({ ...valid, candidate_revision: 0 })).toThrow();
  });

  it('allows an unresolved route to remain null for human review', () => {
    const candidate = structuredClone(valid) as Record<string, unknown> & {
      slots: Array<Record<string, unknown>>;
    };
    candidate.slots[0]!.route = null;
    candidate.slots[0]!.route_state = 'NEEDS_REVIEW';
    expect(candidateShotPlanV1Schema.parse(candidate).slots[0]!.route).toBeNull();
  });

  it('rejects a resolved route without an intentional enum value', () => {
    const candidate = structuredClone(valid) as Record<string, unknown> & {
      slots: Array<Record<string, unknown>>;
    };
    candidate.slots[0]!.route = null;
    expect(() => candidateShotPlanV1Schema.parse(candidate)).toThrow();
  });

  it('rejects resolved continuity without a group identity', () => {
    const candidate = structuredClone(valid) as Record<string, unknown> & {
      slots: Array<Record<string, unknown>>;
    };
    candidate.slots[0]!.visual_continuity_group_id = null;
    expect(() => candidateShotPlanV1Schema.parse(candidate)).toThrow();
  });

  it('requires unique slot identities and increasing order', () => {
    expect(() =>
      candidateShotPlanV1Schema.parse({ ...valid, slots: [valid.slots[0], valid.slots[0]] }),
    ).toThrow();
  });

  it('ships a strict JSON Schema 2020-12 companion', () => {
    const schema = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../schemas/shot-planning/v1/candidate-shot-plan.schema.json',
        ),
        'utf8',
      ),
    ) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, extra: true })).toBe(false);
    const unresolvedRoute = structuredClone(valid) as Record<string, unknown> & {
      slots: Array<Record<string, unknown>>;
    };
    unresolvedRoute.slots[0]!.route = null;
    expect(validate(unresolvedRoute)).toBe(false);
    const unresolvedContinuity = structuredClone(valid) as Record<string, unknown> & {
      slots: Array<Record<string, unknown>>;
    };
    unresolvedContinuity.slots[0]!.visual_continuity_group_id = null;
    expect(validate(unresolvedContinuity)).toBe(false);
  });
});
