import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpProviderGatewayClient,
  PROVIDER_JOB_ARTIFACT_MAX_ITEMS_V1,
  PROVIDER_JOB_RESPONSE_MAX_BYTES_V1,
  readBoundedProviderJobResponseJsonV1,
  safeParseBoundedProviderJobV1,
} from '../../packages/provider-client/src/index.js';

function jsonWithExactBytes(byteLength: number): string {
  const prefix = '{"padding":"';
  const suffix = '"}';
  return `${prefix}${'a'.repeat(byteLength - prefix.length - suffix.length)}${suffix}`;
}

function streamingResponse(byteLength: number, declaredLength?: number, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const firstLength = Math.min(byteLength, PROVIDER_JOB_RESPONSE_MAX_BYTES_V1);
      controller.enqueue(new Uint8Array(firstLength).fill(0x20));
      if (byteLength > firstLength) {
        controller.enqueue(new Uint8Array(byteLength - firstLength).fill(0x20));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    ...(declaredLength === undefined
      ? {}
      : { headers: { 'content-length': String(declaredLength) } }),
  });
}

const artifact = {
  object_ref: `obj_${'a'.repeat(24)}`,
  mime_type: 'video/mp4' as const,
  sha256: 'b'.repeat(64),
  size_bytes: 1,
  expires_at: '2026-10-25T00:00:00.000Z',
};

function providerJob(artifacts: unknown) {
  return {
    schema_version: '1.0',
    protocol_version: '1.0',
    job_id: 'job_test-1',
    request_id: 'request-1',
    capability: 'text.generate.v1',
    model_alias: 'test-model',
    state: 'SUCCEEDED',
    estimated_cost: 0,
    final_cost: 0,
    currency: 'CNY',
    artifacts,
    error: null,
    created_at: '2026-10-24T00:00:00.000Z',
    updated_at: '2026-10-24T00:00:01.000Z',
  };
}

function textProviderRequest() {
  return {
    schema_version: '1.0' as const,
    request_id: 'request-1',
    model_alias: 'test-model',
    quality_tier: 'standard' as const,
    request_snapshot_hash: 'c'.repeat(64),
    max_cost: { amount: 1, currency: 'CNY' as const },
    capability: 'text.generate.v1' as const,
    inputs: [] as [],
    parameters: { prompt: 'test' },
  };
}

describe('Provider Job response resource safety', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a response body exactly at the 4 MiB byte boundary', async () => {
    const json = jsonWithExactBytes(PROVIDER_JOB_RESPONSE_MAX_BYTES_V1);
    expect(Buffer.byteLength(json, 'utf8')).toBe(PROVIDER_JOB_RESPONSE_MAX_BYTES_V1);
    await expect(
      readBoundedProviderJobResponseJsonV1(
        new Response(json, {
          headers: { 'content-length': String(PROVIDER_JOB_RESPONSE_MAX_BYTES_V1) },
        }),
      ),
    ).resolves.toMatchObject({ padding: expect.any(String) });
  });

  it('rejects a streamed body over 4 MiB when Content-Length is absent or lies', async () => {
    for (const declaredLength of [undefined, 2]) {
      await expect(
        readBoundedProviderJobResponseJsonV1(
          streamingResponse(PROVIDER_JOB_RESPONSE_MAX_BYTES_V1 + 1, declaredLength),
        ),
      ).rejects.toThrow('PROVIDER_JOB_RESPONSE_RESOURCE_LIMIT_EXCEEDED');
    }
  });

  it('rejects an oversized declared Content-Length before consuming the body', async () => {
    await expect(
      readBoundedProviderJobResponseJsonV1(
        streamingResponse(2, PROVIDER_JOB_RESPONSE_MAX_BYTES_V1 + 1),
      ),
    ).rejects.toThrow('PROVIDER_JOB_RESPONSE_RESOURCE_LIMIT_EXCEEDED');
  });

  it('allows 1024 artifacts to reach normal Zod validation', () => {
    const parsed = safeParseBoundedProviderJobV1(
      providerJob(Array.from({ length: PROVIDER_JOB_ARTIFACT_MAX_ITEMS_V1 }, () => artifact)),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects 1025 artifacts before providerJobV1Schema validation', () => {
    const fullSchemaParse = vi.fn(() => {
      throw new Error('FULL_SCHEMA_PARSE_REACHED');
    });
    expect(() =>
      safeParseBoundedProviderJobV1(
        providerJob(Array.from({ length: PROVIDER_JOB_ARTIFACT_MAX_ITEMS_V1 + 1 }, () => artifact)),
        fullSchemaParse,
      ),
    ).toThrow('PROVIDER_JOB_RESPONSE_RESOURCE_LIMIT_EXCEEDED');
    expect(fullSchemaParse).not.toHaveBeenCalled();
  });

  it.each([undefined, 'not-an-array'])(
    'leaves missing or non-array artifacts (%s) to normal Zod validation',
    (artifacts) => {
      const parsed = safeParseBoundedProviderJobV1(providerJob(artifacts));
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['artifacts']);
    },
  );

  it('classifies an oversized successful Provider Job response as non-retryable invalid data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(streamingResponse(PROVIDER_JOB_RESPONSE_MAX_BYTES_V1 + 1)),
    );
    const client = new HttpProviderGatewayClient({
      backendUrl: 'https://gateway.example/',
      accessToken: 'desktop-token',
      requestSigner: {
        sign: vi.fn().mockResolvedValue({
          timestamp: '1',
          nonce: 'nonce',
          bodySha256: 'd'.repeat(64),
          signature: 'signature',
        }),
      },
    });

    await expect(client.createJob(textProviderRequest())).rejects.toMatchObject({
      code: 'INVALID_GATEWAY_RESPONSE',
      retryable: false,
    });
  });

  it('classifies an oversized failed Provider Job response as non-retryable invalid data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse(PROVIDER_JOB_RESPONSE_MAX_BYTES_V1 + 1, undefined, 500),
        ),
    );
    const client = new HttpProviderGatewayClient({
      backendUrl: 'https://gateway.example/',
      accessToken: 'desktop-token',
      requestSigner: {
        sign: vi.fn().mockResolvedValue({
          timestamp: '1',
          nonce: 'nonce',
          bodySha256: 'd'.repeat(64),
          signature: 'signature',
        }),
      },
    });

    await expect(client.createJob(textProviderRequest())).rejects.toMatchObject({
      code: 'INVALID_GATEWAY_RESPONSE',
      retryable: false,
    });
  });

  it('classifies oversized artifacts as non-retryable invalid Provider Job data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              providerJob(
                Array.from({ length: PROVIDER_JOB_ARTIFACT_MAX_ITEMS_V1 + 1 }, () => artifact),
              ),
            ),
            { status: 200 },
          ),
        ),
    );
    const client = new HttpProviderGatewayClient({
      backendUrl: 'https://gateway.example/',
      accessToken: 'desktop-token',
      requestSigner: {
        sign: vi.fn().mockResolvedValue({
          timestamp: '1',
          nonce: 'nonce',
          bodySha256: 'd'.repeat(64),
          signature: 'signature',
        }),
      },
    });

    await expect(client.createJob(textProviderRequest())).rejects.toMatchObject({
      code: 'INVALID_GATEWAY_RESPONSE',
      retryable: false,
    });
  });
});
