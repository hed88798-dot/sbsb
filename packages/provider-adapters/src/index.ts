import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  ProviderArtifactV1,
  ProviderCapabilityV1,
  ProviderJobStateV1,
  ProviderRequestV1,
} from '@app/contracts';

export {
  startProviderFakeServer,
  type ProviderFakeServerHandle,
  type ProviderFakeServerScenario,
} from './fake-server.js';

export type ProviderErrorClass =
  | 'RATE_LIMITED'
  | 'UPSTREAM_5XX'
  | 'UNAVAILABLE'
  | 'TIMEOUT_UNKNOWN'
  | 'MODERATION_REJECTED'
  | 'INVALID_PARAMS'
  | 'UNSUPPORTED_MODEL'
  | 'AUTH_FAILED'
  | 'INTERNAL';

export class ProviderAdapterError extends Error {
  constructor(
    readonly errorClass: ProviderErrorClass,
    message: string,
    readonly retryable: boolean,
    readonly providerJobId?: string,
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
  }
}

export interface ProviderEstimate {
  amount: number;
  maximumAmount: number;
  currency: 'CNY' | 'USD';
  billedUnits: number;
}

export interface ProviderSubmission {
  providerJobId: string;
  state: ProviderJobStateV1;
  finalCost: number | null;
  billedUnits: number;
  artifacts: ProviderArtifactV1[];
  text?: string;
}

export interface ProviderStatus extends ProviderSubmission {
  errorClass?: ProviderErrorClass;
}

export interface VerifiedWebhook {
  eventId: string;
  providerJobId: string;
  state: ProviderJobStateV1;
  finalCost: number | null;
  billedUnits: number;
  artifacts: ProviderArtifactV1[];
  errorClass?: ProviderErrorClass;
}

export interface ProviderAdapter {
  readonly alias: string;
  readonly providerModel: string;
  readonly capabilities: readonly ProviderCapabilityV1[];
  estimate(request: ProviderRequestV1): ProviderEstimate;
  submit(request: ProviderRequestV1): Promise<ProviderSubmission>;
  getJob(providerJobId: string): Promise<ProviderStatus>;
  verifyWebhook(rawBody: string, signature: string): VerifiedWebhook;
}

export type FakeProviderScenario =
  | 'success'
  | 'queue'
  | 'slow'
  | '429'
  | '5xx'
  | 'timeout-but-succeeded'
  | 'moderation-rejected'
  | 'invalid-params'
  | 'unknown-job'
  | 'cost-under-estimate'
  | 'cost-over-estimate';

export class FakeProviderAdapter implements ProviderAdapter {
  readonly capabilities = [
    'text.generate.v1',
    'image.generate.v1',
    'image.edit.v1',
    'video.generate.v1',
    'tts.synthesize.v1',
    'voice.clone.v1',
    'lipsync.generate.v1',
  ] as const;
  readonly jobs = new Map<string, ProviderStatus>();
  submitCount = 0;

  constructor(
    readonly alias = 'mock-primary',
    readonly providerModel = 'mock-model-v1',
    private readonly scenario: FakeProviderScenario = 'success',
    private readonly webhookSecret = 'mock-webhook-secret',
  ) {}

  estimate(request: ProviderRequestV1): ProviderEstimate {
    const units =
      request.capability === 'video.generate.v1' ? request.parameters.duration_seconds : 1;
    return {
      amount: Number((units * 0.1).toFixed(4)),
      maximumAmount:
        this.scenario === 'cost-over-estimate'
          ? Number((units * 0.15).toFixed(4))
          : Number((units * 0.1).toFixed(4)),
      currency: request.max_cost.currency,
      billedUnits: units,
    };
  }

  async submit(request: ProviderRequestV1): Promise<ProviderSubmission> {
    this.submitCount += 1;
    const providerJobId = `remote_${randomUUID()}`;
    const estimate = this.estimate(request);
    const finalCost =
      this.scenario === 'cost-under-estimate'
        ? estimate.amount * 0.5
        : this.scenario === 'cost-over-estimate'
          ? estimate.amount * 1.25
          : estimate.amount;
    const success: ProviderStatus = {
      providerJobId,
      state: this.scenario === 'queue' ? 'QUEUED' : 'SUCCEEDED',
      finalCost: this.scenario === 'queue' ? null : finalCost,
      billedUnits: estimate.billedUnits,
      artifacts: [],
      ...(request.capability === 'text.generate.v1'
        ? { text: '这是一段由确定性 Provider Fake 生成的合成文案。' }
        : {}),
    };
    this.jobs.set(providerJobId, success);
    if (this.scenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.scenario === '429')
      throw new ProviderAdapterError('RATE_LIMITED', 'provider rate limited', true);
    if (this.scenario === '5xx')
      throw new ProviderAdapterError('UPSTREAM_5XX', 'provider unavailable', true);
    if (this.scenario === 'moderation-rejected')
      throw new ProviderAdapterError('MODERATION_REJECTED', 'content rejected', false);
    if (this.scenario === 'invalid-params')
      throw new ProviderAdapterError('INVALID_PARAMS', 'invalid parameters', false);
    if (this.scenario === 'timeout-but-succeeded') {
      this.jobs.set(providerJobId, { ...success, state: 'SUCCEEDED' });
      throw new ProviderAdapterError(
        'TIMEOUT_UNKNOWN',
        'provider outcome unknown',
        true,
        providerJobId,
      );
    }
    return success;
  }

  async getJob(providerJobId: string): Promise<ProviderStatus> {
    if (this.scenario === 'unknown-job') {
      return {
        providerJobId,
        state: 'UNKNOWN',
        finalCost: null,
        billedUnits: 0,
        artifacts: [],
      };
    }
    const job = this.jobs.get(providerJobId);
    if (!job) throw new ProviderAdapterError('INVALID_PARAMS', 'provider job not found', false);
    if (job.state === 'QUEUED') {
      const settled = { ...job, state: 'SUCCEEDED' as const, finalCost: 0.1 };
      this.jobs.set(providerJobId, settled);
      return settled;
    }
    return job;
  }

  verifyWebhook(rawBody: string, signature: string): VerifiedWebhook {
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
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

export interface FixedEndpointAdapterOptions {
  alias: string;
  providerModel: string;
  capabilities: readonly ProviderCapabilityV1[];
  endpoint: string;
  apiKey: string;
  webhookSecret: string;
  unitCost: number;
  currency: 'CNY' | 'USD';
}

/** Server-only candidate. A deployment must separately pass the legal allowlist. */
export class FixedEndpointJsonAdapter implements ProviderAdapter {
  readonly alias: string;
  readonly providerModel: string;
  readonly capabilities: readonly ProviderCapabilityV1[];

  constructor(private readonly options: FixedEndpointAdapterOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:') throw new Error('Provider endpoint must use HTTPS');
    this.alias = options.alias;
    this.providerModel = options.providerModel;
    this.capabilities = options.capabilities;
  }

  estimate(request: ProviderRequestV1): ProviderEstimate {
    const units =
      request.capability === 'video.generate.v1' ? request.parameters.duration_seconds : 1;
    return {
      amount: units * this.options.unitCost,
      maximumAmount: units * this.options.unitCost,
      currency: this.options.currency,
      billedUnits: units,
    };
  }

  async submit(request: ProviderRequestV1): Promise<ProviderSubmission> {
    let response: Response;
    try {
      response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.providerModel,
          capability: request.capability,
          inputs: request.inputs,
          parameters: request.parameters,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ProviderAdapterError('TIMEOUT_UNKNOWN', 'provider outcome unknown', true);
    }
    if (response.status === 429)
      throw new ProviderAdapterError('RATE_LIMITED', 'provider rate limited', true);
    if (response.status >= 500)
      throw new ProviderAdapterError('UPSTREAM_5XX', 'provider unavailable', true);
    if (!response.ok)
      throw new ProviderAdapterError('INVALID_PARAMS', 'provider rejected request', false);
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.job_id !== 'string')
      throw new ProviderAdapterError('INTERNAL', 'invalid provider response', false);
    return {
      providerJobId: body.job_id,
      state: 'QUEUED',
      finalCost: null,
      billedUnits: 0,
      artifacts: [],
    };
  }

  async getJob(providerJobId: string): Promise<ProviderStatus> {
    const statusUrl = new URL(
      encodeURIComponent(providerJobId),
      `${this.options.endpoint.replace(/\/$/u, '')}/`,
    );
    const response = await fetch(statusUrl, {
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new ProviderAdapterError(
        'UPSTREAM_5XX',
        'provider status unavailable',
        true,
        providerJobId,
      );
    const body = (await response.json()) as Record<string, unknown>;
    const state = typeof body.state === 'string' ? body.state : 'UNKNOWN';
    const allowedStates: ProviderJobStateV1[] = [
      'QUEUED',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'UNKNOWN',
    ];
    return {
      providerJobId,
      state: allowedStates.includes(state as ProviderJobStateV1)
        ? (state as ProviderJobStateV1)
        : 'UNKNOWN',
      finalCost: typeof body.final_cost === 'number' ? body.final_cost : null,
      billedUnits: typeof body.billed_units === 'number' ? body.billed_units : 0,
      artifacts: [],
    };
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

export class OpenAiCompatibleTextAdapter implements ProviderAdapter {
  readonly capabilities = ['text.generate.v1'] as const;
  readonly alias: string;
  readonly providerModel: string;
  private readonly jobs = new Map<string, ProviderStatus>();

  constructor(
    private readonly options: {
      alias: string;
      providerModel: string;
      endpoint: string;
      apiKey: string;
      webhookSecret: string;
      inputUnitCost: number;
      outputUnitCost: number;
      currency: 'CNY' | 'USD';
    },
  ) {
    if (new URL(options.endpoint).protocol !== 'https:') {
      throw new Error('Provider endpoint must use HTTPS');
    }
    this.alias = options.alias;
    this.providerModel = options.providerModel;
  }

  estimate(request: ProviderRequestV1): ProviderEstimate {
    if (request.capability !== 'text.generate.v1') {
      throw new ProviderAdapterError('UNSUPPORTED_MODEL', 'unsupported capability', false);
    }
    return {
      amount: request.parameters.max_tokens * this.options.outputUnitCost,
      maximumAmount: request.parameters.max_tokens * this.options.outputUnitCost,
      currency: this.options.currency,
      billedUnits: request.parameters.max_tokens,
    };
  }

  async submit(request: ProviderRequestV1): Promise<ProviderSubmission> {
    if (request.capability !== 'text.generate.v1') {
      throw new ProviderAdapterError('UNSUPPORTED_MODEL', 'unsupported capability', false);
    }
    let response: Response;
    try {
      response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.providerModel,
          messages: [{ role: 'user', content: request.parameters.prompt }],
          max_tokens: request.parameters.max_tokens,
          temperature: request.parameters.temperature,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ProviderAdapterError('TIMEOUT_UNKNOWN', 'provider outcome unknown', true);
    }
    if (response.status === 429)
      throw new ProviderAdapterError('RATE_LIMITED', 'provider rate limited', true);
    if (response.status >= 500)
      throw new ProviderAdapterError('UPSTREAM_5XX', 'provider unavailable', true);
    if (!response.ok)
      throw new ProviderAdapterError('INVALID_PARAMS', 'provider rejected request', false);
    const body = (await response.json()) as {
      id?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new ProviderAdapterError('INTERNAL', 'invalid provider response', false);
    }
    const inputUnits = typeof body.usage?.prompt_tokens === 'number' ? body.usage.prompt_tokens : 0;
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
