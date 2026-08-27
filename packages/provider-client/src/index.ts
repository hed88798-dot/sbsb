import {
  textGatewayRequestV1Schema,
  textGatewayResultV1Schema,
  type TextGatewayRequestV1,
  type TextGatewayResultV1,
} from '@app/contracts';

export interface TextCapabilityClient {
  generate(
    request: TextGatewayRequestV1,
    options?: { signal?: AbortSignal },
  ): Promise<TextGatewayResultV1>;
}

export class GatewayClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'GatewayClientError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function isGatewayClientError(error: unknown): error is GatewayClientError {
  if (error instanceof GatewayClientError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  );
}

export interface HttpTextCapabilityClientOptions {
  backendUrl: string;
  accessToken?: string;
  timeoutMs?: number;
  mockScenario?: 'success' | 'timeout' | '429' | '500' | 'invalid';
}

export class HttpTextCapabilityClient implements TextCapabilityClient {
  readonly #options: HttpTextCapabilityClientOptions;

  constructor(options: HttpTextCapabilityClientOptions) {
    this.#options = options;
  }

  async generate(
    request: TextGatewayRequestV1,
    options: { signal?: AbortSignal } = {},
  ): Promise<TextGatewayResultV1> {
    const validatedRequest = textGatewayRequestV1Schema.parse(request);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort('timeout'),
      this.#options.timeoutMs ?? 30_000,
    );
    const onAbort = () => controller.abort('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.#options.accessToken) headers.authorization = `Bearer ${this.#options.accessToken}`;
      if (this.#options.mockScenario) headers['x-mock-scenario'] = this.#options.mockScenario;
      const response = await fetch(new URL('/v1/text/generate', this.#options.backendUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(validatedRequest),
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new GatewayClientError('RATE_LIMITED', '请求过于频繁，请稍后重试', true);
      }
      if (response.status >= 500) {
        throw new GatewayClientError('GATEWAY_UPSTREAM_ERROR', '文案服务暂时不可用', true);
      }
      if (!response.ok) {
        throw new GatewayClientError('GATEWAY_REQUEST_REJECTED', '文案请求未被接受', false);
      }
      const body: unknown = await response.json();
      const parsed = textGatewayResultV1Schema.safeParse(body);
      if (!parsed.success) {
        throw new GatewayClientError('INVALID_GATEWAY_RESPONSE', '文案服务返回了无效响应', false);
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof GatewayClientError) throw error;
      if (controller.signal.aborted) {
        const cancelledByCaller = options.signal?.aborted === true;
        throw new GatewayClientError(
          cancelledByCaller ? 'CANCELLED' : 'GATEWAY_TIMEOUT',
          cancelledByCaller ? '任务已取消' : '文案服务响应超时',
          !cancelledByCaller,
        );
      }
      throw new GatewayClientError('GATEWAY_NETWORK_ERROR', '无法连接文案服务', true);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

export type MockTextScenario = 'success' | 'timeout' | '429' | '500' | 'invalid' | 'cancel';

export class MockTextCapabilityClient implements TextCapabilityClient {
  readonly #scenario: MockTextScenario;
  readonly #text: string;

  constructor(options: { scenario?: MockTextScenario; text?: string } = {}) {
    this.#scenario = options.scenario ?? 'success';
    this.#text = options.text ?? '这是一段确定性的离线合成文案。';
  }

  async generate(
    request: TextGatewayRequestV1,
    options: { signal?: AbortSignal } = {},
  ): Promise<TextGatewayResultV1> {
    textGatewayRequestV1Schema.parse(request);
    if (this.#scenario === 'cancel' || options.signal?.aborted) {
      throw new GatewayClientError('CANCELLED', '任务已取消', false);
    }
    if (this.#scenario === 'timeout') {
      throw new GatewayClientError('GATEWAY_TIMEOUT', '文案服务响应超时', true);
    }
    if (this.#scenario === '429') {
      throw new GatewayClientError('RATE_LIMITED', '请求过于频繁，请稍后重试', true);
    }
    if (this.#scenario === '500') {
      throw new GatewayClientError('GATEWAY_UPSTREAM_ERROR', '文案服务暂时不可用', true);
    }
    if (this.#scenario === 'invalid') {
      throw new GatewayClientError('INVALID_GATEWAY_RESPONSE', '文案服务返回了无效响应', false);
    }
    return textGatewayResultV1Schema.parse({
      schema_version: '1.0',
      request_id: request.request_id,
      text: this.#text,
      provider_alias: 'mock-text',
      provider_model: 'mock-text-v1',
      latency_ms: 1,
      billed_units: 0,
      request_snapshot_hash: request.request_snapshot_hash,
    });
  }
}
