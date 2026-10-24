import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderAdapterError } from '@app/provider-adapters';
import { sha256 } from '../../apps/gateway/src/index.js';
import {
  createGatewayFixture,
  signedInject,
  type GatewayFixture,
} from '../helpers/gateway-fixture.js';
import { structuredOutput, textRequest } from '../helpers/text-structured-output.js';

let fixture: GatewayFixture | undefined;
afterEach(async () => {
  await fixture?.close();
  vi.restoreAllMocks();
});

describe('authenticated text Gateway structured output', () => {
  it.each([false, true])(
    'forwards exact schema and bound request identity (strict=%s)',
    async (strict) => {
      fixture = await createGatewayFixture();
      const submit = vi.spyOn(fixture.adapter, 'submit');
      const body = { ...textRequest, ...(strict ? { structured_output: structuredOutput } : {}) };
      const response = await signedInject(fixture, {
        method: 'POST',
        url: '/v1/text/generate',
        body,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        request_id: textRequest.request_id,
        request_snapshot_hash: textRequest.request_snapshot_hash,
        provider_alias: fixture.adapter.alias,
      });
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        schema_version: '1.0',
        request_id: textRequest.request_id,
        capability: 'text.generate.v1',
        model_alias: textRequest.model_alias,
        quality_tier: 'standard',
        inputs: [],
        parameters: {
          prompt: textRequest.prompt,
          max_tokens: 2048,
          temperature: 0.7,
          ...(strict ? { structured_output: structuredOutput } : {}),
        },
        request_snapshot_hash: textRequest.request_snapshot_hash,
        max_cost: { amount: 1, currency: 'CNY' },
      });
      const row = fixture.database.db.prepare('SELECT request_hash FROM provider_jobs').get() as {
        request_hash: string;
      };
      expect(row.request_hash).toBe(sha256(JSON.stringify(submit.mock.calls[0]![0])));
      if (strict) {
        const generic = submit.mock.calls[0]![0];
        expect(row.request_hash).not.toBe(
          sha256(
            JSON.stringify({
              ...generic,
              parameters: { prompt: textRequest.prompt, max_tokens: 2048, temperature: 0.7 },
            }),
          ),
        );
      }
    },
  );

  it('reserves the larger internal ceiling only for the frozen C3C alias', async () => {
    fixture = await createGatewayFixture({ textModelAlias: 'text.semantic-shot-planning' });
    const submit = vi.spyOn(fixture.adapter, 'submit');
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/text/generate',
      body: { ...textRequest, model_alias: 'text.semantic-shot-planning' },
    });

    expect(response.statusCode).toBe(200);
    expect(submit.mock.calls[0]![0]).toMatchObject({
      model_alias: 'text.semantic-shot-planning',
      max_cost: { amount: 2, currency: 'CNY' },
    });
  });

  it('includes schema absence, content and name in idempotency identity', async () => {
    fixture = await createGatewayFixture();
    const send = (body: unknown) =>
      signedInject(fixture!, { method: 'POST', url: '/v1/text/generate', body });
    const strict = { ...textRequest, structured_output: structuredOutput };
    expect((await send(strict)).statusCode).toBe(200);
    expect((await send(strict)).statusCode).toBe(200);
    for (const body of [
      textRequest,
      { ...strict, structured_output: { ...structuredOutput, schema_name: 'other_name' } },
      { ...strict, structured_output: { ...structuredOutput, schema: { type: 'object' } } },
    ]) {
      const response = await send(body);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    }
    expect(fixture.adapter.submitCount).toBe(1);
  });

  it.each([
    { ...structuredOutput, mode: 'JSON_OBJECT' },
    { ...structuredOutput, strict: false },
    { ...structuredOutput, schema_name: 'invalid name' },
    { ...structuredOutput, schema: [] },
    { ...structuredOutput, schema: { description: 'x'.repeat(65_536) } },
  ])('rejects malformed schema before submitting (case %#)', async (structured_output) => {
    fixture = await createGatewayFixture();
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/text/generate',
      body: { ...textRequest, structured_output },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_TEXT_REQUEST' });
    expect(fixture.adapter.submitCount).toBe(0);
    expect(
      fixture.database.db.prepare('SELECT COUNT(*) AS count FROM provider_jobs').get(),
    ).toEqual({ count: 0 });
  });

  it('binds structured output to request signature', async () => {
    fixture = await createGatewayFixture();
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/text/generate',
      body: { ...textRequest, structured_output: structuredOutput },
      signBody: textRequest,
    });
    expect(response.statusCode).toBe(401);
    expect(fixture.adapter.submitCount).toBe(0);
  });

  it('preserves the same strict request on allowed fallback', async () => {
    fixture = await createGatewayFixture({ scenario: '429', fallbackScenario: 'success' });
    const primary = vi.spyOn(fixture.adapter, 'submit');
    const fallback = vi.spyOn(fixture.fallback!, 'submit');
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/text/generate',
      body: { ...textRequest, structured_output: structuredOutput },
    });
    expect(response.statusCode).toBe(200);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledExactlyOnceWith(primary.mock.calls[0]![0]);
    expect(primary.mock.calls[0]![0]).toMatchObject({
      parameters: { structured_output: structuredOutput },
    });
  });

  it('records Provider rejection without retrying or downgrading to fallback', async () => {
    fixture = await createGatewayFixture({ fallbackScenario: 'success' });
    const primary = vi
      .spyOn(fixture.adapter, 'submit')
      .mockRejectedValue(
        new ProviderAdapterError('INVALID_PARAMS', 'provider rejected request', false),
      );
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/text/generate',
      body: { ...textRequest, structured_output: structuredOutput },
    });
    expect(response.statusCode).toBe(503);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fixture.fallback?.submitCount).toBe(0);
    expect(
      fixture.database.db.prepare('SELECT state, error_class FROM provider_jobs').get(),
    ).toEqual({ state: 'FAILED', error_class: 'INVALID_PARAMS' });
  });
});
