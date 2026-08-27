import { afterEach, describe, expect, it } from 'vitest';
import {
  startProviderFakeServer,
  type ProviderFakeServerHandle,
  type ProviderFakeServerScenario,
} from '../../packages/provider-adapters/src/fake-server.js';

let server: ProviderFakeServerHandle | undefined;
afterEach(async () => server?.close());

describe('deterministic Provider fake server', () => {
  it.each([
    ['success', 200],
    ['queue', 200],
    ['429', 429],
    ['5xx', 503],
    ['moderation-rejected', 422],
    ['invalid-params', 400],
    ['cost-under-estimate', 200],
    ['cost-over-estimate', 200],
  ] as Array<[ProviderFakeServerScenario, number]>)('supports %s', async (scenario, status) => {
    server = await startProviderFakeServer({ scenario });
    const response = await fetch(`${server.url}/v1/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: `request_${scenario}` }),
    });
    expect(response.status).toBe(status);
  });

  it.each([
    ['duplicate-webhook', 2],
    ['out-of-order-webhook', 2],
  ] as Array<[ProviderFakeServerScenario, number]>)(
    'emits %s deterministically',
    async (scenario, count) => {
      server = await startProviderFakeServer({ scenario });
      const response = await fetch(`${server.url}/v1/webhook-events`);
      expect((await response.json()) as unknown[]).toHaveLength(count);
    },
  );

  it('exposes expired object and invalid signature cases', async () => {
    server = await startProviderFakeServer({ scenario: 'expired-object' });
    expect((await fetch(`${server.url}/v1/objects/check`)).status).toBe(410);
    await server.close();
    server = await startProviderFakeServer({ scenario: 'invalid-signature' });
    expect(
      (
        await fetch(`${server.url}/v1/webhook/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-provider-signature': 'bad' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
  });
});
