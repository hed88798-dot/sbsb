import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockGateway, type MockGatewayHandle } from '../../apps/gateway/src/index.js';
import {
  HttpTextCapabilityClient,
  GatewayClientError,
} from '../../packages/provider-client/src/index.js';

let gateway: MockGatewayHandle;
const request = {
  schema_version: '1.0' as const,
  request_id: 'gateway_fixture',
  capability: 'text.generate.v1' as const,
  model_alias: 'text.standard',
  prompt: '合成测试提示',
  request_snapshot_hash: '1'.repeat(64),
};

beforeAll(async () => {
  gateway = await startMockGateway();
});

afterAll(async () => {
  await gateway.close();
});

describe('Mock Gateway contract', () => {
  it('returns a validated success response', async () => {
    const result = await new HttpTextCapabilityClient({ backendUrl: gateway.url }).generate(
      request,
    );
    expect(result.provider_alias).toBe('mock-gateway');
  });

  it.each([
    ['429', 'RATE_LIMITED'],
    ['500', 'GATEWAY_UPSTREAM_ERROR'],
    ['invalid', 'INVALID_GATEWAY_RESPONSE'],
  ] as const)('normalizes %s', async (scenario, code) => {
    const client = new HttpTextCapabilityClient({
      backendUrl: gateway.url,
      mockScenario: scenario,
    });
    await expect(client.generate(request)).rejects.toMatchObject({ code });
  });

  it('normalizes timeout', async () => {
    const client = new HttpTextCapabilityClient({
      backendUrl: gateway.url,
      mockScenario: 'timeout',
      timeoutMs: 20,
    });
    await expect(client.generate(request)).rejects.toMatchObject({ code: 'GATEWAY_TIMEOUT' });
  });

  it('supports cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new HttpTextCapabilityClient({ backendUrl: gateway.url });
    try {
      await client.generate(request, { signal: controller.signal });
      throw new Error('Expected cancellation');
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayClientError);
      expect(error).toMatchObject({ code: 'CANCELLED' });
    }
  });
});
