import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GatewayClientError,
  HttpTextCapabilityClient,
} from '../../packages/provider-client/src/index.js';
import { textRequest } from '../helpers/text-structured-output.js';

afterEach(() => vi.unstubAllGlobals());

describe('TextCapabilityClient AppErrorV1 parsing', () => {
  it.each([
    [502, 'AUTH_FAILED', false],
    [502, 'INVALID_PARAMS', false],
    [502, 'RATE_LIMITED', true],
    [502, 'UPSTREAM_5XX', true],
    [503, 'UNAVAILABLE', true],
    [401, 'INVALID_ACCESS_TOKEN', false],
    [429, 'VALID_NONRETRYABLE_ERROR', false],
    [400, 'VALID_RETRYABLE_ERROR', true],
  ] as const)(
    'honors AppError %s / %s / %s instead of status alone',
    async (status, code, retryable) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              schema_version: '1.0',
              code,
              retryable,
              message: 'Sanitized Gateway error',
              request_id: textRequest.request_id,
            }),
            { status },
          ),
        ),
      );
      const result = new HttpTextCapabilityClient({ backendUrl: 'http://127.0.0.1' }).generate(
        textRequest,
      );
      await expect(result).rejects.toBeInstanceOf(GatewayClientError);
      await expect(result).rejects.toMatchObject({
        code,
        retryable,
        message: 'Sanitized Gateway error',
      });
    },
  );

  it.each([
    [502, '', 'GATEWAY_UPSTREAM_ERROR', true],
    [503, '<html>private proxy details</html>', 'GATEWAY_UPSTREAM_ERROR', true],
    [
      500,
      JSON.stringify({
        schema_version: '2.0',
        code: 'AUTH_FAILED',
        message: 'private proxy details',
        retryable: false,
      }),
      'GATEWAY_UPSTREAM_ERROR',
      true,
    ],
    [429, JSON.stringify({ code: 'AUTH_FAILED', retryable: false }), 'RATE_LIMITED', true],
    [
      400,
      JSON.stringify({
        schema_version: '1.0',
        code: 'INVALID_PARAMS',
        message: 'private proxy details',
        retryable: 'false',
      }),
      'GATEWAY_REQUEST_REJECTED',
      false,
    ],
  ] as const)(
    'uses a safe fallback for nonstandard %s error bodies (case %#)',
    async (status, body, code, retryable) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
      try {
        await new HttpTextCapabilityClient({ backendUrl: 'http://127.0.0.1' }).generate(
          textRequest,
        );
        throw new Error('Expected Gateway rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(GatewayClientError);
        expect(error).toMatchObject({ code, retryable });
        expect((error as Error).message).not.toContain('private proxy details');
      }
    },
  );
});
