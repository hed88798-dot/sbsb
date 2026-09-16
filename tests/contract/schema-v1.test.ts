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
  renderJobDtoV1Schema,
  renderPrepareFromTimelineRequestV1Schema,
  renderPrepareRequestV1Schema,
  renderTimelineSourceDtoV1Schema,
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
const renderValidator = ajv.compile(schema('schemas/ipc/v1/render.schema.json'));

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
    expect(
      IPC_CHANNEL_ALLOWLIST.some((channel) =>
        /^(?:ipc|sql|fs|exec):|:(?:ipc|sql|fs|exec)$/iu.test(channel),
      ),
    ).toBe(false);
  });

  it('keeps the strict Desktop Render authority request aligned across Zod and JSON Schema', () => {
    const request = {
      schema_version: '1.0',
      timeline_id: 'timeline_1',
      timeline_version: 1,
      expected_timeline_commit_receipt_hash: '1'.repeat(64),
      render_policy_id: 'policy_1',
      render_policy_version: 1,
      render_policy_hash: '2'.repeat(64),
    };
    expect(renderPrepareRequestV1Schema.safeParse(request).success).toBe(true);
    expect(renderValidator(request), JSON.stringify(renderValidator.errors)).toBe(true);
    for (const forbidden of [
      'runtime_root',
      'ffmpeg_path',
      'ffprobe_path',
      'source_path',
      'staging_root',
      'output_root',
      'ffmpeg_arguments',
      'fallback_selection',
      'digital_human_input',
    ]) {
      const invalid = { ...request, [forbidden]: 'forbidden' };
      expect(renderPrepareRequestV1Schema.safeParse(invalid).success, forbidden).toBe(false);
      expect(renderValidator(invalid), forbidden).toBe(false);
    }
  });

  it('validates a Renderer-safe Render status without path or command authority', () => {
    const status = {
      schema_version: '1.0',
      job_id: 'render_job_1',
      job_state: 'RUNNING',
      progress: 0.25,
      preparation_state: 'READY_FOR_EXECUTION',
      active_execution_state: 'RUNNING',
      timeline_id: 'timeline_1',
      timeline_version: 1,
      logical_render_hash: '1'.repeat(64),
      execution_snapshot_hash: '2'.repeat(64),
      cancellation_requested: false,
      error_code: null,
      error_message: null,
      created_at: '2026-09-16T00:00:00.000Z',
      started_at: '2026-09-16T00:00:01.000Z',
      finished_at: null,
      result: null,
    };
    expect(renderJobDtoV1Schema.safeParse(status).success).toBe(true);
    expect(renderValidator(status), JSON.stringify(renderValidator.errors)).toBe(true);
    expect(
      renderJobDtoV1Schema.safeParse({ ...status, output_path: 'C:\\secret.mp4' }).success,
    ).toBe(false);
  });

  it('keeps the product Timeline selector and safe source DTO aligned across Zod and JSON Schema', () => {
    const selector = {
      schema_version: '1.0',
      timeline_id: 'timeline_1',
      timeline_version: 2,
    };
    const source = {
      ...selector,
      committed_at: '2026-09-17T00:00:00.000Z',
      total_duration_ms: 30_000,
      segment_count: 4,
    };
    expect(renderPrepareFromTimelineRequestV1Schema.safeParse(selector).success).toBe(true);
    expect(renderTimelineSourceDtoV1Schema.safeParse(source).success).toBe(true);
    expect(renderValidator(selector), JSON.stringify(renderValidator.errors)).toBe(true);
    expect(renderValidator(source), JSON.stringify(renderValidator.errors)).toBe(true);

    for (const forbidden of [
      'expected_timeline_commit_receipt_hash',
      'render_policy_id',
      'render_policy_version',
      'render_policy_hash',
      'planning_facts_hash',
      'duration_plan_hash',
      'source_path',
      'runtime_root',
    ]) {
      const invalid = { ...selector, [forbidden]: forbidden.endsWith('version') ? 1 : 'secret' };
      expect(renderPrepareFromTimelineRequestV1Schema.safeParse(invalid).success, forbidden).toBe(
        false,
      );
      expect(renderValidator(invalid), forbidden).toBe(false);
    }
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
