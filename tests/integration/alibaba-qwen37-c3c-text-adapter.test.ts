import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { semanticShotPlanProposalJsonSchema } from '../../apps/desktop/src/main/semantic-shot-plan-proposal-schema.generated.js';
import {
  textProviderRequestV1Schema,
  type TextJsonObject,
} from '../../packages/contracts/src/index.js';
import {
  ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS,
  ALIBABA_QWEN37_C3C_MAX_OUTPUT_TOKENS,
  ALIBABA_QWEN37_C3C_MAX_WIRE_INPUT_BYTES,
  ALIBABA_QWEN37_C3C_MIN_INPUT_UNIT_COST_CNY,
  ALIBABA_QWEN37_C3C_MIN_OUTPUT_UNIT_COST_CNY,
  ALIBABA_QWEN37_C3C_PROVIDER_ALIAS,
  ALIBABA_QWEN37_C3C_PROVIDER_MODEL,
  AlibabaQwen37C3cTextAdapter,
} from '../../packages/provider-adapters/src/index.js';

const endpoint =
  'https://workspace-test-only.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
const inputUnitCost = ALIBABA_QWEN37_C3C_MIN_INPUT_UNIT_COST_CNY;
const outputUnitCost = ALIBABA_QWEN37_C3C_MIN_OUTPUT_UNIT_COST_CNY;

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  }
  server = undefined;
});

async function captureHttp(status: number, responseBody: unknown) {
  const bodies: unknown[] = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(responseBody));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test address');
  return { bodies, url: `http://127.0.0.1:${address.port}` };
}

function adapter() {
  return new AlibabaQwen37C3cTextAdapter({
    endpoint,
    apiKey: 'test-only-credential',
    webhookSecret: 'test-only-webhook-secret',
    inputUnitCost,
    outputUnitCost,
    currency: 'CNY',
  });
}

function providerRequest(input?: {
  maxTokens?: number;
  structured?: boolean;
  schemaName?: string;
  prompt?: string;
  schema?: TextJsonObject;
}) {
  return textProviderRequestV1Schema.parse({
    schema_version: '1.0',
    request_id: 'req_alibaba_wire_1',
    capability: 'text.generate.v1',
    model_alias: 'text.semantic-shot-planning',
    quality_tier: 'standard',
    inputs: [],
    parameters: {
      prompt: input?.prompt ?? '使用康健100后，猪群采食状态逐步恢复。',
      max_tokens: input?.maxTokens ?? 2_048,
      temperature: 0.7,
      ...(input?.structured === false
        ? {}
        : {
            structured_output: {
              mode: 'JSON_SCHEMA_STRICT',
              schema_name: input?.schemaName ?? 'ShotPlanSemanticProposalV1',
              schema: input?.schema ?? semanticShotPlanProposalJsonSchema,
            },
          }),
    },
    request_snapshot_hash: 'a'.repeat(64),
    max_cost: { amount: 2, currency: 'CNY' },
  });
}

describe('Alibaba Model Studio frozen Qwen3.7 C3C adapter', () => {
  it('sends the exact strict non-thinking wire without any output cap or downgrade field', async () => {
    const { bodies, url } = await captureHttp(200, {
      id: 'provider-job-1',
      choices: [
        {
          message: {
            reasoning_content: 'must never become application output',
            content: '{"schema_version":"1.0"}',
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 },
    });
    const originalFetch = globalThis.fetch;
    const transport = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(input).toBe(endpoint);
      return originalFetch(url, init);
    });
    vi.stubGlobal('fetch', transport);

    const result = await adapter().submit(providerRequest());

    expect(bodies).toEqual([
      {
        model: ALIBABA_QWEN37_C3C_PROVIDER_MODEL,
        messages: [{ role: 'user', content: '使用康健100后，猪群采食状态逐步恢复。' }],
        temperature: 0.7,
        enable_thinking: false,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ShotPlanSemanticProposalV1',
            strict: true,
            schema: semanticShotPlanProposalJsonSchema,
          },
        },
      },
    ]);
    expect(bodies[0]).not.toHaveProperty('max_tokens');
    expect(bodies[0]).not.toHaveProperty('max_completion_tokens');
    expect(bodies[0]).not.toHaveProperty('thinking_budget');
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(bodies[0]).not.toHaveProperty('stream');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      providerJobId: 'provider-job-1',
      text: '{"schema_version":"1.0"}',
      billedUnits: 32,
      finalCost: 12 * inputUnitCost + 20 * outputUnitCost,
    });
    expect(result.text).not.toContain('reasoning');
  });

  it('pins provider identity and only accepts the workspace-specific Beijing endpoint', () => {
    expect(adapter()).toMatchObject({
      alias: ALIBABA_QWEN37_C3C_PROVIDER_ALIAS,
      providerModel: 'qwen3.7-plus-2026-05-26',
    });
    const invalidEndpoints = [
      'http://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions?x=1',
    ];
    for (const invalidEndpoint of invalidEndpoints) {
      expect(
        () =>
          new AlibabaQwen37C3cTextAdapter({
            endpoint: invalidEndpoint,
            apiKey: 'test-only',
            webhookSecret: 'test-only',
            inputUnitCost,
            outputUnitCost,
            currency: 'CNY',
          }),
      ).toThrow(/Beijing Chat Completions endpoint/u);
    }
  });

  it('rejects pricing below the reviewed Beijing rates', () => {
    expect(
      () =>
        new AlibabaQwen37C3cTextAdapter({
          endpoint,
          apiKey: 'test-only',
          webhookSecret: 'test-only',
          inputUnitCost: inputUnitCost / 2,
          outputUnitCost,
          currency: 'CNY',
        }),
    ).toThrow(/must not understate/u);
    expect(
      () =>
        new AlibabaQwen37C3cTextAdapter({
          endpoint,
          apiKey: 'test-only',
          webhookSecret: 'test-only',
          inputUnitCost,
          outputUnitCost: outputUnitCost / 2,
          currency: 'CNY',
        }),
    ).toThrow(/must not understate/u);
  });

  it('reserves the documented output maximum plus a conservative input upper bound', () => {
    const lowHint = adapter().estimate(providerRequest({ maxTokens: 1 }));
    const highHint = adapter().estimate(providerRequest({ maxTokens: 8_192 }));
    const expectedMaximum =
      ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS * inputUnitCost +
      ALIBABA_QWEN37_C3C_MAX_OUTPUT_TOKENS * outputUnitCost;
    expect(lowHint).toEqual({
      amount: expectedMaximum,
      maximumAmount: expectedMaximum,
      currency: 'CNY',
      billedUnits:
        ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS + ALIBABA_QWEN37_C3C_MAX_OUTPUT_TOKENS,
    });
    expect(highHint).toEqual(lowHint);
    expect(expectedMaximum).toBe(1.560576);
  });

  it('rejects a different schema name before HTTP', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);

    await expect(
      adapter().submit(providerRequest({ schemaName: 'SomeOtherSchema' })),
    ).rejects.toMatchObject({ errorClass: 'INVALID_PARAMS', retryable: false });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects an oversized complete Provider wire before HTTP', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    const oversizedSchema: TextJsonObject = {
      ...semanticShotPlanProposalJsonSchema,
      description: 'x'.repeat(20_000),
    };
    const request = providerRequest({
      prompt: '界'.repeat(40_000),
      schema: oversizedSchema,
    });
    expect(
      Buffer.byteLength(
        JSON.stringify({
          messages: [{ role: 'user', content: request.parameters.prompt }],
          schema: request.parameters.structured_output?.schema,
        }),
        'utf8',
      ),
    ).toBeGreaterThan(ALIBABA_QWEN37_C3C_MAX_WIRE_INPUT_BYTES);

    await expect(adapter().submit(request)).rejects.toMatchObject({
      errorClass: 'INVALID_PARAMS',
      retryable: false,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed when Provider usage escapes the reviewed low pricing tier', async () => {
    const { url } = await captureHttp(200, {
      id: 'provider-job-usage-invariant',
      choices: [{ message: { content: '{"schema_version":"1.0"}' } }],
      usage: {
        prompt_tokens: ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS + 1,
        completion_tokens: 1,
        total_tokens: ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS + 2,
      },
    });
    const originalFetch = globalThis.fetch;
    const transport = vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      originalFetch(url, init),
    );
    vi.stubGlobal('fetch', transport);

    await expect(adapter().submit(providerRequest())).rejects.toMatchObject({
      errorClass: 'INTERNAL',
      retryable: false,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'AUTH_FAILED', false],
    [403, 'AUTH_FAILED', false],
    [400, 'INVALID_PARAMS', false],
    [429, 'RATE_LIMITED', true],
    [500, 'UPSTREAM_5XX', true],
  ] as const)(
    'classifies HTTP %i without a fallback request',
    async (status, errorClass, retryable) => {
      const { bodies, url } = await captureHttp(status, { error: 'synthetic failure' });
      const originalFetch = globalThis.fetch;
      const transport = vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        originalFetch(url, init),
      );
      vi.stubGlobal('fetch', transport);

      await expect(adapter().submit(providerRequest())).rejects.toMatchObject({
        errorClass,
        retryable,
      });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({
        model: ALIBABA_QWEN37_C3C_PROVIDER_MODEL,
        enable_thinking: false,
        response_format: { json_schema: { strict: true } },
      });
    },
  );

  it('classifies an unknown transport outcome and never retries', async () => {
    const transport = vi.fn(async () => {
      throw new Error('synthetic timeout');
    });
    vi.stubGlobal('fetch', transport);
    await expect(adapter().submit(providerRequest())).rejects.toMatchObject({
      errorClass: 'TIMEOUT_UNKNOWN',
      retryable: true,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('fails closed before HTTP when strict structured-output authority is absent', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    await expect(adapter().submit(providerRequest({ structured: false }))).rejects.toMatchObject({
      errorClass: 'INVALID_PARAMS',
      retryable: false,
    });
    expect(transport).not.toHaveBeenCalled();
  });
});
