import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNEL_ALLOWLIST,
  IPC_CHANNELS,
  SCHEMA_VERSION_V1,
  copywritingGenerateRequestV1Schema,
  jobDtoV1Schema,
  productCreateRequestV1Schema,
  productDtoV1Schema,
  sidecarEventV1Schema,
  sidecarRequestV1Schema,
} from '../../packages/contracts/src/index.js';

const root = resolve(import.meta.dirname, '../..');
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

function schema(path: string): object {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as object;
}

const productValidator = ajv.compile(schema('schemas/ipc/v1/product.schema.json'));

const productData = {
  name: '合成样例产品A',
  aliases: ['样例A'],
  category: '合成测试',
  target_object: '猪',
  ingredients: '合成成分 10%',
  specification: '100g/袋',
  approved_scope: '仅用于合成回归测试',
  usage: '每次10g',
  contraindications: ['妊娠期禁用'],
  selling_points: ['信息结构清晰'],
  description: '不对应任何真实商品',
  marketing_focus: '事实保持',
  forbidden_claims: ['保证治愈'],
  notes: '',
  industry_metadata: { synthetic: true },
};

describe('IPC v1 contract', () => {
  it('keeps JSON Schema and Zod aligned for ProductCreateRequestV1', () => {
    const value = { schema_version: SCHEMA_VERSION_V1, data: productData };
    expect(productCreateRequestV1Schema.safeParse(value).success).toBe(true);
    expect(productValidator(value), JSON.stringify(productValidator.errors)).toBe(true);
  });

  it('validates ProductDTOv1', () => {
    const value = {
      schema_version: SCHEMA_VERSION_V1,
      product_id: 'product_fixture',
      ...productData,
      assets: [],
      created_at: '2026-08-27T00:00:00.000Z',
      updated_at: '2026-08-27T00:00:00.000Z',
    };
    expect(productDtoV1Schema.safeParse(value).success).toBe(true);
    expect(productValidator(value), JSON.stringify(productValidator.errors)).toBe(true);
  });

  it('rejects incomplete copywriting mode inputs', () => {
    const base = {
      schema_version: SCHEMA_VERSION_V1,
      request_id: 'request_fixture',
      mode: 'DEDUPE',
      direction: '',
      target_duration_seconds: 30,
      style: '专业清晰',
      colloquial_level: 1,
      requirements: '',
      dedupe_level: 'DEEP',
    };
    expect(copywritingGenerateRequestV1Schema.safeParse(base).success).toBe(false);
  });

  it('validates the public Job states', () => {
    for (const state of ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']) {
      expect(
        jobDtoV1Schema.safeParse({
          schema_version: SCHEMA_VERSION_V1,
          job_id: `job_${state}`,
          job_type: 'COPYWRITING',
          state,
          progress: 0,
          created_at: '2026-08-27T00:00:00.000Z',
          started_at: null,
          finished_at: null,
          error_code: null,
          error_message: null,
          request_snapshot_hash: '0'.repeat(64),
        }).success,
      ).toBe(true);
    }
  });

  it('exposes only named IPC use-case channels', () => {
    expect(new Set(IPC_CHANNEL_ALLOWLIST).size).toBe(Object.keys(IPC_CHANNELS).length);
    expect(IPC_CHANNEL_ALLOWLIST.some((channel) => /ipc|sql|exec|fs/i.test(channel))).toBe(false);
  });
});

describe('sidecar protocol v1 contract', () => {
  it('validates request and event fixtures with Zod and JSON Schema', () => {
    const request = {
      type: 'request',
      protocol_version: '1.0',
      request_id: 'sidecar_fixture',
      method: 'ping',
      payload: {},
    };
    const event = {
      type: 'result',
      protocol_version: '1.0',
      request_id: 'sidecar_fixture',
      payload: { pong: true },
    };
    expect(sidecarRequestV1Schema.safeParse(request).success).toBe(true);
    expect(sidecarEventV1Schema.safeParse(event).success).toBe(true);
    expect(ajv.compile(schema('schemas/sidecar/v1/request.schema.json'))(request)).toBe(true);
    expect(ajv.compile(schema('schemas/sidecar/v1/event.schema.json'))(event)).toBe(true);
  });
});
