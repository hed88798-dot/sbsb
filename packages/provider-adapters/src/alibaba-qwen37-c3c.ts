import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ProviderRequestV1 } from '@app/contracts';
import { ProviderAdapterError } from './errors.js';
import type {
  ProviderAdapter,
  ProviderEstimate,
  ProviderStatus,
  ProviderSubmission,
  VerifiedWebhook,
} from './index.js';

export const ALIBABA_QWEN37_C3C_PROVIDER_ALIAS =
  'alibaba-beijing-qwen37-plus-20260526-c3c-nonthinking' as const;
export const ALIBABA_QWEN37_C3C_PROVIDER_MODEL = 'qwen3.7-plus-2026-05-26' as const;
export const ALIBABA_QWEN37_C3C_SCHEMA_NAME = 'ShotPlanSemanticProposalV1' as const;
export const ALIBABA_QWEN37_C3C_MAX_WIRE_INPUT_BYTES = 131_072 as const;
export const ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS = 256_000 as const;
export const ALIBABA_QWEN37_C3C_MAX_OUTPUT_TOKENS = 131_072 as const;
export const ALIBABA_QWEN37_C3C_MIN_INPUT_UNIT_COST_CNY = 2 / 1_000_000;
export const ALIBABA_QWEN37_C3C_MIN_OUTPUT_UNIT_COST_CNY = 8 / 1_000_000;

export interface AlibabaQwen37C3cTextAdapterOptions {
  endpoint: string;
  apiKey: string;
  webhookSecret: string;
  inputUnitCost: number;
  outputUnitCost: number;
  currency: 'CNY';
}

function assertAlibabaBeijingChatCompletionsEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  const workspaceSuffix = '.cn-beijing.maas.aliyuncs.com';
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith(workspaceSuffix) ||
    url.hostname.length === workspaceSuffix.length ||
    url.port !== '' ||
    url.pathname !== '/compatible-mode/v1/chat/completions' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error(
      'Alibaba Model Studio endpoint must be the workspace-specific Beijing Chat Completions endpoint',
    );
  }
}

function buildAlibabaQwen37C3cWire(request: ProviderRequestV1): {
  serializedBody: string;
} {
  if (request.capability !== 'text.generate.v1') {
    throw new ProviderAdapterError('UNSUPPORTED_MODEL', 'unsupported capability', false);
  }
  const structuredOutput = request.parameters.structured_output;
  if (
    !structuredOutput ||
    structuredOutput.mode !== 'JSON_SCHEMA_STRICT' ||
    structuredOutput.schema_name !== ALIBABA_QWEN37_C3C_SCHEMA_NAME
  ) {
    throw new ProviderAdapterError(
      'INVALID_PARAMS',
      'the frozen Alibaba route requires the pinned strict structured-output schema',
      false,
    );
  }

  const serializedBody = JSON.stringify({
    model: ALIBABA_QWEN37_C3C_PROVIDER_MODEL,
    messages: [{ role: 'user', content: request.parameters.prompt }],
    temperature: 0.7,
    enable_thinking: false,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: ALIBABA_QWEN37_C3C_SCHEMA_NAME,
        strict: true,
        schema: structuredOutput.schema,
      },
    },
  });
  if (Buffer.byteLength(serializedBody, 'utf8') > ALIBABA_QWEN37_C3C_MAX_WIRE_INPUT_BYTES) {
    throw new ProviderAdapterError(
      'INVALID_PARAMS',
      'the frozen Alibaba request exceeds the V1 wire-input safety limit',
      false,
    );
  }
  return { serializedBody };
}

/** Server-only adapter for the frozen C3C formal-acceptance route. */
export class AlibabaQwen37C3cTextAdapter implements ProviderAdapter {
  readonly capabilities = ['text.generate.v1'] as const;
  readonly alias = ALIBABA_QWEN37_C3C_PROVIDER_ALIAS;
  readonly providerModel = ALIBABA_QWEN37_C3C_PROVIDER_MODEL;
  private readonly jobs = new Map<string, ProviderStatus>();

  constructor(private readonly options: AlibabaQwen37C3cTextAdapterOptions) {
    assertAlibabaBeijingChatCompletionsEndpoint(options.endpoint);
    if (
      !Number.isFinite(options.inputUnitCost) ||
      options.inputUnitCost < ALIBABA_QWEN37_C3C_MIN_INPUT_UNIT_COST_CNY ||
      !Number.isFinite(options.outputUnitCost) ||
      options.outputUnitCost < ALIBABA_QWEN37_C3C_MIN_OUTPUT_UNIT_COST_CNY
    ) {
      throw new Error(
        'Alibaba Model Studio token prices must not understate the reviewed Beijing rates',
      );
    }
  }

  estimate(request: ProviderRequestV1): ProviderEstimate {
    buildAlibabaQwen37C3cWire(request);
    const maximumInputUnits = ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS;
    const maximumOutputUnits = ALIBABA_QWEN37_C3C_MAX_OUTPUT_TOKENS;
    const maximumAmount =
      maximumInputUnits * this.options.inputUnitCost +
      maximumOutputUnits * this.options.outputUnitCost;
    return {
      amount: maximumAmount,
      maximumAmount,
      currency: this.options.currency,
      billedUnits: maximumInputUnits + maximumOutputUnits,
    };
  }

  async submit(request: ProviderRequestV1): Promise<ProviderSubmission> {
    const { serializedBody } = buildAlibabaQwen37C3cWire(request);
    let response: Response;
    try {
      response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: serializedBody,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ProviderAdapterError('TIMEOUT_UNKNOWN', 'provider outcome unknown', true);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderAdapterError('AUTH_FAILED', 'provider authentication failed', false);
    }
    if (response.status === 429) {
      throw new ProviderAdapterError('RATE_LIMITED', 'provider rate limited', true);
    }
    if (response.status >= 500) {
      throw new ProviderAdapterError('UPSTREAM_5XX', 'provider unavailable', true);
    }
    if (!response.ok) {
      throw new ProviderAdapterError('INVALID_PARAMS', 'provider rejected request', false);
    }

    let body: {
      id?: unknown;
      choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new ProviderAdapterError('INTERNAL', 'invalid provider response', false);
    }
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new ProviderAdapterError('INTERNAL', 'invalid provider response', false);
    }
    const inputUnits = typeof body.usage?.prompt_tokens === 'number' ? body.usage.prompt_tokens : 0;
    if (inputUnits > ALIBABA_QWEN37_C3C_MAX_LOW_TIER_INPUT_TOKENS) {
      throw new ProviderAdapterError(
        'INTERNAL',
        'provider reported prompt usage outside the frozen low-tier envelope',
        false,
      );
    }
    const outputUnits =
      typeof body.usage?.completion_tokens === 'number' ? body.usage.completion_tokens : 0;
    const billedUnits =
      typeof body.usage?.total_tokens === 'number'
        ? body.usage.total_tokens
        : inputUnits + outputUnits;
    const providerJobId = typeof body.id === 'string' ? body.id : `remote_${randomUUID()}`;
    const status: ProviderStatus = {
      providerJobId,
      state: 'SUCCEEDED',
      finalCost:
        inputUnits * this.options.inputUnitCost + outputUnits * this.options.outputUnitCost,
      billedUnits,
      artifacts: [],
      text,
    };
    this.jobs.set(providerJobId, status);
    return status;
  }

  async getJob(providerJobId: string): Promise<ProviderStatus> {
    return (
      this.jobs.get(providerJobId) ?? {
        providerJobId,
        state: 'UNKNOWN',
        finalCost: null,
        billedUnits: 0,
        artifacts: [],
      }
    );
  }

  verifyWebhook(rawBody: string, signature: string): VerifiedWebhook {
    const expected = createHmac('sha256', this.options.webhookSecret).update(rawBody).digest('hex');
    const expectedBytes = Buffer.from(expected, 'utf8');
    const actualBytes = Buffer.from(signature, 'utf8');
    if (
      expectedBytes.length !== actualBytes.length ||
      !timingSafeEqual(expectedBytes, actualBytes)
    ) {
      throw new ProviderAdapterError('AUTH_FAILED', 'invalid webhook signature', false);
    }
    return JSON.parse(rawBody) as VerifiedWebhook;
  }
}
