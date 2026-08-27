import {
  providerJobV1Schema,
  providerRequestV1Schema,
  textGatewayRequestV1Schema,
  textGatewayResultV1Schema,
  type ProviderJobV1,
  type ProviderRequestV1,
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
  requestSigner?: GatewayRequestSigner;
}

export interface GatewayRequestSigner {
  sign(input: { method: string; path: string; body: string; requestId: string }): Promise<{
    timestamp: string;
    nonce: string;
    bodySha256: string;
    signature: string;
  }>;
}

async function signedHeaders(
  signer: GatewayRequestSigner | undefined,
  input: { method: string; path: string; body: string; requestId: string },
): Promise<Record<string, string>> {
  if (!signer) return {};
  const signed = await signer.sign(input);
  return {
    'x-timestamp': signed.timestamp,
    'x-nonce': signed.nonce,
    'x-body-sha256': signed.bodySha256,
    'x-device-signature': signed.signature,
    'x-request-id': input.requestId,
  };
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
      const path = '/v1/text/generate';
      const requestBody = JSON.stringify(validatedRequest);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.#options.accessToken) headers.authorization = `Bearer ${this.#options.accessToken}`;
      if (this.#options.mockScenario) headers['x-mock-scenario'] = this.#options.mockScenario;
      Object.assign(
        headers,
        await signedHeaders(this.#options.requestSigner, {
          method: 'POST',
          path,
          body: requestBody,
          requestId: validatedRequest.request_id,
        }),
      );
      const response = await fetch(new URL(path, this.#options.backendUrl), {
        method: 'POST',
        headers,
        body: requestBody,
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

export class HttpProviderGatewayClient {
  constructor(
    private readonly options: {
      backendUrl: string;
      accessToken: string;
      requestSigner: GatewayRequestSigner;
      timeoutMs?: number;
    },
  ) {}

  async createJob(request: ProviderRequestV1): Promise<ProviderJobV1> {
    const validated = providerRequestV1Schema.parse(request);
    return this.request('/v1/jobs', 'POST', JSON.stringify(validated), validated.request_id);
  }

  async getJob(jobId: string): Promise<ProviderJobV1> {
    if (!/^job_[A-Za-z0-9-]+$/u.test(jobId)) {
      throw new GatewayClientError('INVALID_JOB_ID', '任务编号无效', false);
    }
    const requestId = `poll_${crypto.randomUUID()}`;
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, 'GET', '', requestId);
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body: string,
    requestId: string,
  ): Promise<ProviderJobV1> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.accessToken}`,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...(await signedHeaders(this.options.requestSigner, { method, path, body, requestId })),
    };
    let response: Response;
    try {
      response = await fetch(new URL(path, this.options.backendUrl), {
        method,
        headers,
        ...(method === 'POST' ? { body } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch {
      throw new GatewayClientError('GATEWAY_NETWORK_ERROR', '无法连接素材服务', true);
    }
    if (response.status === 429) {
      throw new GatewayClientError('RATE_LIMITED', '请求过于频繁，请稍后重试', true);
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { code?: unknown } | null;
      throw new GatewayClientError(
        typeof error?.code === 'string' ? error.code : 'GATEWAY_REQUEST_REJECTED',
        '素材请求未被接受',
        response.status >= 500,
      );
    }
    const parsed = providerJobV1Schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new GatewayClientError('INVALID_GATEWAY_RESPONSE', '素材服务返回了无效响应', false);
    }
    return parsed.data;
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
