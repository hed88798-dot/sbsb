import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_PROTOCOL_VERSION_V1,
  providerJobStateV1Schema,
  providerRequestV1Schema,
  type ProviderRequestV1,
} from '../../packages/contracts/src/index.js';
import { FakeProviderAdapter } from '../../packages/provider-adapters/src/index.js';
import type { ProviderAdapterError } from '../../packages/provider-adapters/src/index.js';

const object = (role: 'image' | 'video' | 'audio' | 'voice_sample') => ({
  role,
  object_ref: `obj_${'a'.repeat(24)}`,
  sha256: '1'.repeat(64),
});
const base = {
  schema_version: '1.0' as const,
  request_id: 'provider_contract_001',
  model_alias: 'mock-v1',
  quality_tier: 'standard' as const,
  request_snapshot_hash: '2'.repeat(64),
  max_cost: { amount: 10, currency: 'CNY' as const },
};

const requests: ProviderRequestV1[] = [
  {
    ...base,
    capability: 'text.generate.v1',
    inputs: [],
    parameters: { prompt: '合成文案', max_tokens: 20, temperature: 0 },
  },
  {
    ...base,
    request_id: 'provider_contract_002',
    capability: 'image.generate.v1',
    inputs: [],
    parameters: { prompt: '合成图片', width: 512, height: 512, count: 1 },
  },
  {
    ...base,
    request_id: 'provider_contract_003',
    capability: 'image.edit.v1',
    inputs: [object('image')],
    parameters: { prompt: '合成编辑', width: 512, height: 512, strength: 0.5 },
  },
  {
    ...base,
    request_id: 'provider_contract_004',
    capability: 'video.generate.v1',
    inputs: [object('image')],
    parameters: { prompt: '合成视频', duration_seconds: 2, aspect_ratio: '9:16' },
  },
  {
    ...base,
    request_id: 'provider_contract_005',
    capability: 'tts.synthesize.v1',
    inputs: [],
    parameters: { text: '合成语音', voice_alias: 'voice-v1', format: 'mp3' },
  },
  {
    ...base,
    request_id: 'provider_contract_006',
    capability: 'voice.clone.v1',
    inputs: [object('voice_sample')],
    parameters: { display_name: '合成声音', consent_id: 'consent_voice_001' },
  },
  {
    ...base,
    request_id: 'provider_contract_007',
    capability: 'lipsync.generate.v1',
    inputs: [object('video'), object('audio')],
    parameters: { consent_id: 'consent_lipsync_001' },
  },
];

describe('Provider Protocol v1', () => {
  it('publishes JSON Schema accepted by a strict Draft 2020 validator', () => {
    const root = resolve(import.meta.dirname, '../..');
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const requestSchema = JSON.parse(
      readFileSync(resolve(root, 'schemas/provider/v1/request.schema.json'), 'utf8'),
    ) as object;
    const jobSchema = JSON.parse(
      readFileSync(resolve(root, 'schemas/provider/v1/job.schema.json'), 'utf8'),
    ) as object;
    expect(() => ajv.compile(requestSchema)).not.toThrow();
    expect(() => ajv.compile(jobSchema)).not.toThrow();
  });

  it('freezes protocol and six-state provider job semantics', () => {
    expect(PROVIDER_PROTOCOL_VERSION_V1).toBe('1.0');
    for (const state of ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']) {
      expect(providerJobStateV1Schema.safeParse(state).success).toBe(true);
    }
  });

  it.each(requests)('validates $capability request and fake result', async (request) => {
    const parsed = providerRequestV1Schema.parse(request);
    const adapter = new FakeProviderAdapter();
    const result = await adapter.submit(parsed);
    expect(result.state).toBe('SUCCEEDED');
    expect(result.providerJobId).toMatch(/^remote_/u);
  });

  it.each(requests)('rejects vendor URL/payload injection for $capability', (request) => {
    expect(
      providerRequestV1Schema.safeParse({
        ...request,
        provider_url: 'http://127.0.0.1/admin',
        vendor_payload: { arbitrary: true },
      }).success,
    ).toBe(false);
  });

  it.each([
    ['429', 'RATE_LIMITED', true],
    ['5xx', 'UPSTREAM_5XX', true],
    ['moderation-rejected', 'MODERATION_REJECTED', false],
    ['invalid-params', 'INVALID_PARAMS', false],
    ['timeout-but-succeeded', 'TIMEOUT_UNKNOWN', true],
  ] as const)('normalizes %s', async (scenario, errorClass, retryable) => {
    const adapter = new FakeProviderAdapter('fake', 'fake-v1', scenario);
    await expect(adapter.submit(requests[0]!)).rejects.toMatchObject({
      errorClass,
      retryable,
    } satisfies Partial<ProviderAdapterError>);
  });
});
