import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  materialSelectionPolicyV1Schema,
  materialSelectionRequestV1Schema,
  materialSelectionResultV1Schema,
  selectionDecisionReceiptV1Schema,
} from '../../packages/contracts/src/index.js';
import { MATERIAL_SELECTION_POLICY_V1 } from '../../packages/domain-auto-edit/src/index.js';

const root = resolve(import.meta.dirname, '../..');
const schemaDirectory = resolve(root, 'schemas/material-selection/v1');
const hash = 'a'.repeat(64);

function loadSchema(name: string): object {
  return JSON.parse(readFileSync(resolve(schemaDirectory, name), 'utf8')) as object;
}

describe('material selection v1 contracts', () => {
  it('ships strict JSON Schema validators for request, policy, receipt and result', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    for (const name of [
      'material-selection-request.schema.json',
      'material-selection-policy.schema.json',
      'selection-decision-receipt.schema.json',
      'material-selection-result.schema.json',
    ]) {
      expect(() => ajv.compile(loadSchema(name)), name).not.toThrow();
    }
  });

  it('keeps the policy as typed, persisted JSON rather than scattered constants', () => {
    expect(materialSelectionPolicyV1Schema.parse(MATERIAL_SELECTION_POLICY_V1)).toEqual(
      MATERIAL_SELECTION_POLICY_V1,
    );
    expect(MATERIAL_SELECTION_POLICY_V1).toMatchObject({
      policy_id: 'material-selection-policy-v1',
      policy_version: '1.0.0',
      same_video_exact_shot_repeat: 'FORBIDDEN',
      scarcity_degradation: 'ENABLED',
    });
  });

  it('accepts only SELECTED or NO_MATCH at the top level', () => {
    const base = {
      schema_version: '1.0',
      selection_request_id: 'request_contract',
      batch_id: 'batch_contract',
      video_id: 'video_contract',
      slot_id: 'slot_contract',
      selected_asset_id: null,
      selected_shot_id: null,
      selected_semantic_rank: null,
      selected_semantic_score: null,
      degradation_level: 0,
      reason_codes: ['NO_UPSTREAM_CANDIDATES'],
      candidate_set_hash: hash,
      history_snapshot_hash: hash,
      policy_snapshot_hash: hash,
    };
    const receipt = {
      ...base,
      status: 'NO_MATCH',
      policy_id: 'material-selection-policy-v1',
      policy_version: '1.0.0',
      candidate_facts: [],
    };
    expect(selectionDecisionReceiptV1Schema.safeParse(receipt).success).toBe(true);
    expect(
      materialSelectionResultV1Schema.safeParse({
        ...base,
        status: 'NO_MATCH',
        decision_receipt_hash: hash,
        committed_at: '2026-09-09T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      materialSelectionResultV1Schema.safeParse({
        ...base,
        status: 'SELECTED_WITH_DEGRADATION',
        decision_receipt_hash: hash,
        committed_at: '2026-09-09T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      selectionDecisionReceiptV1Schema.safeParse({
        ...receipt,
        selected_asset_id: 'asset_conflict',
      }).success,
    ).toBe(false);
    expect(
      materialSelectionResultV1Schema.safeParse({
        ...base,
        status: 'NO_MATCH',
        degradation_level: 1,
        decision_receipt_hash: hash,
        committed_at: '2026-09-09T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('keeps JSON Schema status/nullability rules aligned with Zod', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateReceipt = ajv.compile(loadSchema('selection-decision-receipt.schema.json'));
    const invalidNoMatch = {
      schema_version: '1.0',
      selection_request_id: 'request_contract',
      batch_id: 'batch_contract',
      video_id: 'video_contract',
      slot_id: 'slot_contract',
      status: 'NO_MATCH',
      selected_asset_id: 'asset_conflict',
      selected_shot_id: null,
      selected_semantic_rank: null,
      selected_semantic_score: null,
      degradation_level: 0,
      reason_codes: ['NO_UPSTREAM_CANDIDATES'],
      candidate_set_hash: hash,
      history_snapshot_hash: hash,
      policy_id: 'material-selection-policy-v1',
      policy_version: '1.0.0',
      policy_snapshot_hash: hash,
      candidate_facts: [],
    };
    expect(validateReceipt(invalidNoMatch)).toBe(false);
  });

  it('requires authoritative-history fields in the internal domain request', () => {
    expect(materialSelectionRequestV1Schema.safeParse({}).success).toBe(false);
  });
});
