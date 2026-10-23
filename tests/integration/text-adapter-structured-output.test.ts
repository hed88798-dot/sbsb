import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleTextAdapter } from '../../packages/provider-adapters/src/index.js';
import { textProviderRequestV1Schema } from '../../packages/contracts/src/index.js';
import { HttpTextCapabilityClient } from '../../packages/provider-client/src/index.js';
import { structuredOutput, textRequest } from '../helpers/text-structured-output.js';

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  server = undefined;
});

async function captureHttp(status: number, responseBody: unknown) {
  const bodies: unknown[] = [];
  const rawBodies: string[] = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    const body = Buffer.concat(chunks).toString('utf8');
    rawBodies.push(body);
    bodies.push(JSON.parse(body));
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(responseBody));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test address');
  const url = `http://127.0.0.1:${address.port}`;
  return { bodies, rawBodies, url };
}

function adapter() {
  return new OpenAiCompatibleTextAdapter({
    alias: 'synthetic-provider',
    providerModel: 'synthetic-pinned-model',
    endpoint: 'https://provider.example.invalid/chat/completions',
    apiKey: 'test-only-credential',
    webhookSecret: 'test-only-webhook',
    inputUnitCost: 0.001,
    outputUnitCost: 0.002,
    currency: 'CNY',
  });
}

function providerRequest(strict: boolean) {
  return textProviderRequestV1Schema.parse({
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
}

describe('OpenAI-compatible structured-output HTTP wire contract', () => {
  it.each([false, true])(
    'sends the exact HTTP payload (strict=%s) and still returns untrusted text',
    async (strict) => {
      // Only redirect the transport in this test; the adapter still constructs its real HTTP body.
      const { bodies, url } = await captureHttp(200, {
        id: 'synthetic-job',
        choices: [{ message: { content: 'untrusted, even if not valid JSON' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
      const originalFetch = globalThis.fetch;
      const transport = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        expect(input).toBe('https://provider.example.invalid/chat/completions');
        return originalFetch(url, init);
      });
      vi.stubGlobal('fetch', transport);
      const result = await adapter().submit(providerRequest(strict));
      expect(bodies).toEqual([
        {
          model: 'synthetic-pinned-model',
          messages: [{ role: 'user', content: textRequest.prompt }],
          temperature: 0.7,
          max_tokens: 2048,
          ...(strict
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: structuredOutput.schema_name,
                    strict: true,
                    schema: structuredOutput.schema,
                  },
                },
              }
            : {}),
        },
      ]);
      if (!strict) expect(bodies[0]).not.toHaveProperty('response_format');
      expect(transport).toHaveBeenCalledTimes(1);
      expect(result.text).toBe('untrusted, even if not valid JSON');
      expect(result.billedUnits).toBe(5);
    },
  );

  it('surfaces unsupported response_format without retrying an unstructured request', async () => {
    const { bodies, url } = await captureHttp(400, { error: 'unsupported response_format' });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      originalFetch(url, init),
    );
    await expect(adapter().submit(providerRequest(true))).rejects.toMatchObject({
      errorClass: 'INVALID_PARAMS',
      retryable: false,
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      response_format: { json_schema: { strict: true, schema: structuredOutput.schema } },
    });
  });

  it('existing HttpTextCapabilityClient preserves schema and signs the complete body', async () => {
    const { bodies, rawBodies, url } = await captureHttp(200, {
      schema_version: '1.0',
      request_id: textRequest.request_id,
      text: 'untrusted text',
      provider_alias: 'synthetic',
      provider_model: 'synthetic-pinned-model',
      latency_ms: 1,
      billed_units: 1,
      request_snapshot_hash: textRequest.request_snapshot_hash,
    });
    const sign = vi.fn(async () => ({
      timestamp: '1',
      nonce: 'synthetic',
      bodySha256: 'a'.repeat(64),
      signature: 'test-signature',
    }));
    const client = new HttpTextCapabilityClient({ backendUrl: url, requestSigner: { sign } });
    const request = { ...textRequest, structured_output: structuredOutput };
    expect((await client.generate(request)).text).toBe('untrusted text');
    expect(bodies).toEqual([request]);
    expect(sign).toHaveBeenCalledExactlyOnceWith({
      method: 'POST',
      path: '/v1/text/generate',
      body: rawBodies[0],
      requestId: request.request_id,
    });
  });
});
