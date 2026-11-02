import { channel } from 'node:diagnostics_channel';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shotPlanSemanticGoldenFixturesV1 } from '../../packages/test-fixtures/src/shot-plan-semantic.js';
import {
  openC3cAuthPreflight,
  AUTH_PREFLIGHT_PROMPT,
  AUTH_PREFLIGHT_STRUCTURED_OUTPUT,
} from '../helpers/c3c-auth-preflight.js';

const endpoint =
  'https://synthetic-auth.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
const roots: string[] = [];
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const close of cleanup.splice(0)) await close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture(
  status = 200,
  code = 'InvalidApiKey',
  options: {
    timeout?: boolean;
    text?: string;
    omitUsage?: boolean;
    outputTokens?: number;
    thinking?: string;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'auth-preflight-test-'));
  roots.push(directory);
  const now = new Date();
  const environment = await openC3cAuthPreflight({
    directory,
    listen: false,
    provider: {
      endpoint,
      apiKey: 'test-auth-key',
      webhookSecret: 'test-webhook',
      inputUnitCost: 0.000002,
      outputUnitCost: 0.000008,
      currency: 'CNY',
    },
    approval: {
      apiTermsVersion: 'synthetic-only',
      modelCodeLicense: 'TEST',
      modelWeightLicense: 'TEST',
      commercialUse: true,
      outputOwnership: 'synthetic-only',
      trainingOrRetentionPolicy: 'synthetic-only',
      regionDataTransfer: 'synthetic-only',
      prohibitedContent: 'synthetic-only',
      attributionRequirement: 'synthetic-only',
      approvedBy: 'deterministic-test',
      approvedAt: new Date(now.getTime() - 1000).toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString(),
    },
  });
  cleanup.push(environment.close);
  let providerCalls = 0;
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url === 'http://127.0.0.1/v1/text/generate') {
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({
        model_alias: 'text.semantic-shot-planning',
        prompt: AUTH_PREFLIGHT_PROMPT,
        structured_output: AUTH_PREFLIGHT_STRUCTURED_OUTPUT,
      });
      expect(new Headers(init?.headers).get('x-device-signature')).not.toBeNull();
      const response = await environment.gateway.inject({
        method: 'POST',
        url: '/v1/text/generate',
        headers: Object.fromEntries(new Headers(init?.headers)),
        payload: String(init?.body),
      });
      return new Response(response.body, { status: response.statusCode });
    }
    if (url !== endpoint) throw new Error('NETWORK_FORBIDDEN');
    providerCalls++;
    const wire = JSON.parse(String(init?.body));
    expect(wire).toMatchObject({
      model: 'qwen3.7-plus',
      temperature: 0.7,
      enable_thinking: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          name: 'ShotPlanSemanticProposalV1',
          schema: AUTH_PREFLIGHT_STRUCTURED_OUTPUT.schema,
        },
      },
    });
    for (const absent of [
      'max_tokens',
      'max_completion_tokens',
      'thinking_budget',
      'reasoning_effort',
      'tools',
      'stream',
    ])
      expect(wire).not.toHaveProperty(absent);
    const urlObject = new URL(endpoint);
    const request = { origin: urlObject.origin, path: urlObject.pathname };
    channel('undici:request:create').publish({ request });
    if (options.timeout) throw new Error('fake transport timeout, do not expose');
    const body =
      status === 200
        ? {
            id: 'synthetic-response',
            choices: [
              {
                message: {
                  content: options.text ?? '{"synthetic":true}',
                  ...(options.thinking ? { reasoning_content: options.thinking } : {}),
                },
              },
            ],
            ...(options.omitUsage
              ? {}
              : {
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: options.outputTokens ?? 20,
                    total_tokens: 10 + (options.outputTokens ?? 20),
                  },
                }),
          }
        : {
            code,
            message: 'test-auth-key private Provider message must never persist',
            request_id: 'safe-request-id',
          };
    channel('undici:request:headers').publish({
      request,
      response: { statusCode: status, headers: [] },
    });
    channel('undici:request:bodyChunkReceived').publish({
      request,
      chunk: Buffer.from(JSON.stringify(body)),
    });
    channel('undici:request:trailers').publish({ request });
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetch);
  return { directory, environment, providerCalls: () => providerCalls };
}

describe('same-path authentication-only preflight, zero network', () => {
  it('contains no fixture ID/source or production semantic instructions', () => {
    expect(shotPlanSemanticGoldenFixturesV1).toHaveLength(30);
    for (const fixture of shotPlanSemanticGoldenFixturesV1) {
      expect(AUTH_PREFLIGHT_PROMPT).not.toContain(fixture.id);
      expect(AUTH_PREFLIGHT_PROMPT).not.toContain(fixture.source_text);
    }
    expect(AUTH_PREFLIGHT_PROMPT).toContain('AUTH_PREFLIGHT_ONLY');
    const helper = readFileSync(
      new URL('../helpers/c3c-auth-preflight.ts', import.meta.url),
      'utf8',
    );
    for (const forbidden of [
      'ShotPlanProposerServiceV1',
      'shot-plan-proposer-prompt',
      'test-fixtures',
      'openDatabase',
      'desktop.db',
      'SourceDocument',
    ])
      expect(helper).not.toContain(forbidden);
    const entry = readFileSync(
      new URL('../canary/real-c3c-auth-preflight.canary.test.ts', import.meta.url),
      'utf8',
    );
    expect(entry).toContain("process.env.REAL_C3C_AUTH_PREFLIGHT_CANARY === '1'");
    expect(entry).toContain('describe.skipIf(!enabled)');
    expect(entry).toContain("'wx', 0o600");
  });
  it('uses the real signed client, Gateway, frozen Alibaba adapter and canonical strict wire once', async () => {
    const test = await fixture();
    const report = await test.environment.run();
    expect(report).toMatchObject({
      result: 'PASS',
      classification: 'SUCCESS',
      model_alias: 'text.semantic-shot-planning',
      provider_alias: 'alibaba-beijing-qwen37-plus-c3c-nonthinking',
      provider_model: 'qwen3.7-plus',
      provider_requests: 1,
      http_status: 200,
      settlement_count: 1,
      returned_text_nonempty: true,
      identity_matches: true,
      semantic_acceptance: 'NOT_EVALUATED',
    });
    expect(report.settled_cost_cny).toBeCloseTo(0.00018, 10);
    expect(test.providerCalls()).toBe(1);
    expect(readdirSync(test.directory).every((n) => n.startsWith('gateway.db'))).toBe(true);
    await expect(test.environment.run()).rejects.toThrow('AUTH_PREFLIGHT_ALREADY_INVOKED');
    expect(test.providerCalls()).toBe(1);
  });
  it.each([
    [401, 'InvalidApiKey', 'AUTH_FAILED'],
    [403, 'AccessDenied', 'AUTH_FAILED'],
    [403, 'insufficient_quota', 'QUOTA_EXHAUSTED'],
    [429, 'insufficient_quota', 'RATE_LIMITED'],
    [400, 'InvalidParameter', 'INVALID_PARAMS'],
    [503, 'ServiceUnavailable', 'UPSTREAM_5XX'],
  ] as const)(
    'preserves %i / %s as %s without retry or secret exposure',
    async (status, code, classification) => {
      const test = await fixture(status, code);
      const report = await test.environment.run();
      expect(report).toMatchObject({
        result: 'FAIL',
        classification,
        http_status: status,
        provider_requests: 1,
        settlement_count: 0,
        settled_cost_cny: 0,
      });
      expect(test.providerCalls()).toBe(1);
      expect(JSON.stringify(report)).not.toContain('test-auth-key');
      expect(JSON.stringify(report)).not.toContain('private Provider message');
      expect(JSON.stringify(report)).not.toContain(endpoint);
      expect(report.provider_code).toBe(code);
    },
  );
  it('preserves TIMEOUT_UNKNOWN, unknown settlement and one request without retry', async () => {
    const test = await fixture(200, '', { timeout: true });
    const report = await test.environment.run();
    expect(report).toMatchObject({
      result: 'FAIL',
      classification: 'TIMEOUT_UNKNOWN',
      settled_cost_cny: null,
      provider_requests: 1,
    });
    expect(test.providerCalls()).toBe(1);
  });
  it('reuses adapter redaction for a credential copied into diagnostic fields', async () => {
    const test = await fixture(401, 'test-auth-key');
    const report = await test.environment.run();
    expect(report.provider_code).toBeNull();
    expect(JSON.stringify(report)).not.toContain('test-auth-key');
    expect(test.providerCalls()).toBe(1);
  });
  it('does not retain returned text, even if the response echoes a secret', async () => {
    const test = await fixture(200, '', { text: 'test-auth-key' });
    const report = await test.environment.run();
    expect(report.result).toBe('PASS');
    expect(JSON.stringify(report)).not.toContain('test-auth-key');
    expect(report.semantic_acceptance).toBe('NOT_EVALUATED');
  });
  it.each([{ text: ' ' }, { omitUsage: true }, { thinking: 'not retained' }])(
    'rejects incomplete or policy-drifting success %j',
    async (options) => {
      const test = await fixture(200, '', options);
      const report = await test.environment.run();
      expect(report.result).toBe('FAIL');
      expect(test.providerCalls()).toBe(1);
      expect(JSON.stringify(report)).not.toContain('not retained');
    },
  );
  it('reports a settled-cost target violation honestly without changing the frozen reservation or retrying', async () => {
    const test = await fixture(200, '', { outputTokens: 7000 });
    const report = await test.environment.run();
    expect(report).toMatchObject({
      result: 'FAIL',
      failure_reason: 'PREFLIGHT_COST_LIMIT',
      settlement_count: 1,
    });
    expect(report.settled_cost_cny).toBeGreaterThan(0.05);
    expect(test.providerCalls()).toBe(1);
  });
});
