import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALIBABA_ERROR_BODY_MAX_BYTES,
  AlibabaQwen37C3cTextAdapter,
  ProviderAdapterError,
  sanitizeProviderDiagnostic,
} from '../../packages/provider-adapters/src/index.js';
import { textProviderRequestV1Schema } from '../../packages/contracts/src/index.js';
import { semanticShotPlanProposalJsonSchema } from '../../apps/desktop/src/main/semantic-shot-plan-proposal-schema.generated.js';

afterEach(() => vi.unstubAllGlobals());

const request = textProviderRequestV1Schema.parse({
  schema_version: '1.0',
  request_id: 'synthetic_diagnostic',
  capability: 'text.generate.v1',
  model_alias: 'text.semantic-shot-planning',
  quality_tier: 'standard',
  inputs: [],
  parameters: {
    prompt: '合成诊断输入',
    max_tokens: 2048,
    temperature: 0.7,
    structured_output: {
      mode: 'JSON_SCHEMA_STRICT',
      schema_name: 'ShotPlanSemanticProposalV1',
      schema: semanticShotPlanProposalJsonSchema,
    },
  },
  request_snapshot_hash: 'a'.repeat(64),
  max_cost: { amount: 2, currency: 'CNY' },
});

async function rejectResponse(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  const adapter = new AlibabaQwen37C3cTextAdapter({
    endpoint:
      'https://synthetic-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    apiKey: 'synthetic-key-not-real',
    webhookSecret: 'synthetic-webhook-not-real',
    inputUnitCost: 0.000002,
    outputUnitCost: 0.000008,
    currency: 'CNY',
  });
  const failure: unknown = await adapter.submit(request).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ProviderAdapterError);
  expect(fetch).toHaveBeenCalledTimes(1);
  return failure as ProviderAdapterError;
}

describe('bounded Alibaba failure diagnostics', () => {
  it.each([
    [403, 'insufficient_quota', 'QUOTA_EXHAUSTED', false],
    [429, 'insufficient_quota', 'RATE_LIMITED', true],
    [401, 'insufficient_quota', 'AUTH_FAILED', false],
    [500, 'insufficient_quota', 'UPSTREAM_5XX', true],
    [400, 'insufficient_quota', 'INVALID_PARAMS', false],
    [403, 'Workspace.AccessDenied', 'AUTH_FAILED', false],
    [401, 'InvalidApiKey', 'AUTH_FAILED', false],
    [429, 'Throttled', 'RATE_LIMITED', true],
    [403, 'INSUFFICIENT_QUOTA', 'AUTH_FAILED', false],
    [403, 'insufficient_quota\n', 'AUTH_FAILED', false],
  ] as const)(
    'classifies HTTP %s with exact safe code %s as %s / %s',
    async (status, code, errorClass, retryable) => {
      const error = await rejectResponse(
        new Response(
          JSON.stringify({
            code,
            request_id: 'synthetic-quota-request',
            message: 'private account and billing details',
          }),
          { status },
        ),
      );
      expect(error).toMatchObject({ errorClass, retryable });
      expect(error.providerDiagnostic).toEqual({
        httpStatus: status,
        ...(code.includes('\n') ? {} : { providerCode: code }),
        providerRequestId: 'synthetic-quota-request',
      });
      expect(JSON.stringify(error)).not.toContain('private account and billing details');
    },
  );

  it.each([
    'Workspace.AccessDenied',
    'Endpoint.AccessDenied',
    'AccessDenied.Unpurchased',
    'access_denied',
    'InvalidApiKey',
  ])('preserves safe top-level code %s without retaining messages', async (code) => {
    const error = await rejectResponse(
      new Response(
        JSON.stringify({
          code,
          request_id: 'safe-test-request-id',
          message: 'sensitive provider text',
        }),
        { status: 403 },
      ),
    );
    expect(error).toMatchObject({ errorClass: 'AUTH_FAILED', retryable: false });
    expect(error.providerDiagnostic).toEqual({
      httpStatus: 403,
      providerCode: code,
      providerRequestId: 'safe-test-request-id',
    });
    expect(error.providerJobId).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('sensitive provider text');
    expect(error.message).toBe('provider authentication failed');
  });

  it('supports nested error code and only top-level request_id', async () => {
    const error = await rejectResponse(
      new Response(
        JSON.stringify({
          error: {
            code: 'Model.AccessDenied',
            message: 'do-not-store',
            request_id: 'not-the-top-level-id',
          },
          request_id: 'request-123',
        }),
        { status: 403 },
      ),
    );
    expect(error.providerDiagnostic).toEqual({
      httpStatus: 403,
      providerCode: 'Model.AccessDenied',
      providerRequestId: 'request-123',
    });
    expect(JSON.stringify(error)).not.toContain('do-not-store');
    expect(JSON.stringify(error)).not.toContain('not-the-top-level-id');
  });

  it.each([
    ['x'.repeat(129), 'r'.repeat(129)],
    ['code with spaces', 'request\nid'],
    ['code\n', 'request-id\n'],
    ['<script>bad</script>', '<html>bad</html>'],
    ['Bearer secret-value', 'secret value'],
    [[], {}],
    [null, 123],
  ])('discards unsafe identifiers without normalization (case %#)', async (code, request_id) => {
    const error = await rejectResponse(
      new Response(JSON.stringify({ code, request_id }), { status: 403 }),
    );
    expect(error).toMatchObject({ errorClass: 'AUTH_FAILED', retryable: false });
    expect(error.providerDiagnostic).toEqual({ httpStatus: 403 });
  });

  it('accepts the exact 128-character identifier boundaries and no extra fields', () => {
    const diagnostic = sanitizeProviderDiagnostic({
      httpStatus: 403,
      providerCode: 'C'.repeat(128),
      providerRequestId: ':'.repeat(128),
      message: 'do-not-store',
      headers: { authorization: 'do-not-store' },
      body: 'do-not-store',
    });
    expect(diagnostic).toEqual({
      httpStatus: 403,
      providerCode: 'C'.repeat(128),
      providerRequestId: ':'.repeat(128),
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    const oldError = new ProviderAdapterError('AUTH_FAILED', 'safe', false, 'existing-job-id');
    expect(oldError.providerJobId).toBe('existing-job-id');
    expect(oldError.providerDiagnostic).toBeUndefined();
    expect(
      sanitizeProviderDiagnostic({ httpStatus: 999, providerCode: '', providerRequestId: '' }),
    ).toBeUndefined();
  });

  it.each([
    'synthetic-key-not-real',
    'synthetic-workspace',
    'synthetic-workspace.cn-beijing.maas.aliyuncs.com',
  ])(
    'discards known credential or workspace values even when identifier-shaped (case %#)',
    async (value) => {
      const error = await rejectResponse(
        new Response(JSON.stringify({ code: value, request_id: value }), { status: 403 }),
      );
      expect(error.providerDiagnostic).toEqual({ httpStatus: 403 });
    },
  );

  it.each([401, 403, 429, 500, 503, 400, 404])(
    'retains HTTP %s classification for malformed bodies',
    async (status) => {
      const error = await rejectResponse(new Response('not-json', { status }));
      expect(error).toMatchObject({
        errorClass:
          status === 401 || status === 403
            ? 'AUTH_FAILED'
            : status === 429
              ? 'RATE_LIMITED'
              : status >= 500
                ? 'UPSTREAM_5XX'
                : 'INVALID_PARAMS',
        retryable: status === 429 || status >= 500,
      });
      expect(error.providerDiagnostic).toEqual({ httpStatus: status });
    },
  );

  it('cancels declared oversized bodies before acquiring a reader or parsing', async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const response = new Response(stream, { status: 403, headers: { 'content-length': '65537' } });
    const reader = vi.spyOn(stream, 'getReader');
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const error = await rejectResponse(response);
    expect(error.providerDiagnostic).toEqual({ httpStatus: 403 });
    expect(reader).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it.each([undefined, '1'])(
    'bounds actual streamed bytes despite Content-Length=%s',
    async (length) => {
      const cancel = vi.fn();
      const chunk = new TextEncoder().encode('界'.repeat(11000));
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(chunk);
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const response = new Response(stream, {
        status: 403,
        ...(length ? { headers: { 'content-length': length } } : {}),
      });
      const error = await rejectResponse(response);
      expect(ALIBABA_ERROR_BODY_MAX_BYTES).toBe(65536);
      expect(error).toMatchObject({ errorClass: 'AUTH_FAILED', retryable: false });
      expect(error.providerDiagnostic).toEqual({ httpStatus: 403 });
      expect(pulls).toBe(2);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts a complete valid JSON body at exactly 65536 bytes', async () => {
    const json = JSON.stringify({ code: 'Workspace.AccessDenied', request_id: 'request-123' });
    const body = json + ' '.repeat(65536 - Buffer.byteLength(json));
    const error = await rejectResponse(new Response(body, { status: 403 }));
    expect(error.providerDiagnostic).toEqual({
      httpStatus: 403,
      providerCode: 'Workspace.AccessDenied',
      providerRequestId: 'request-123',
    });
  });

  it('discards truncated, invalid UTF-8 and non-object bodies', async () => {
    for (const body of [new Uint8Array([0xff]), 'null', '[]', '{"code":"safe"']) {
      const error = await rejectResponse(new Response(body, { status: 403 }));
      expect(error.providerDiagnostic).toEqual({ httpStatus: 403 });
    }
  });

  it('preserves classification if reading the error stream fails', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('sensitive stream failure'));
        },
      }),
      { status: 403 },
    );
    const error = await rejectResponse(response);
    expect(error).toMatchObject({ errorClass: 'AUTH_FAILED', retryable: false });
    expect(error.providerDiagnostic).toEqual({ httpStatus: 403 });
    expect(JSON.stringify(error)).not.toContain('sensitive stream failure');
  });
});
