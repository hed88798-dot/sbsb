import { channel } from 'node:diagnostics_channel';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  shotPlanSemanticGoldenFixturesV1 as fixtures,
  type ShotPlanSemanticGoldenFixtureV1,
} from '../../packages/test-fixtures/src/shot-plan-semantic.js';
import type {
  TextGatewayRequestV1,
  TextGatewayResultV1,
} from '../../packages/contracts/src/index.js';
import { openGoldenEvaluationEnvironment } from '../helpers/golden-evaluation-environment.js';
import { observeGoldenProviderUsage } from '../helpers/golden-provider-usage.js';
import {
  automatedSemanticPass,
  captureGoldenClient,
  runShotPlanGoldenEvaluation,
} from '../helpers/shot-plan-golden-evaluation.js';

const endpoint =
  'https://synthetic-eval.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
const head = '3daca337b2bcd316d2ff8a95ba3d439097e2c8cc';
const directories: string[] = [];
const cleanup: Array<() => Promise<void> | void> = [];
function directory() {
  const result = mkdtempSync(join(tmpdir(), 'golden-harness-test-'));
  directories.push(result);
  return result;
}

function proposal(
  fixture: ShotPlanSemanticGoldenFixtureV1,
  alternativeIndex = 0,
  nullContexts = false,
) {
  const alternative = fixture.acceptable_alternatives[alternativeIndex]!;
  return {
    schema_version: '1.0',
    segmentation_state: fixture.expected_needs_review ? 'NEEDS_REVIEW' : 'RESOLVED',
    review_warnings: [],
    units: alternative.units.map((unit) => ({
      exact_fragment: unit.exact_fragment,
      ...(unit.left_context === undefined
        ? nullContexts
          ? { left_context: null }
          : {}
        : { left_context: unit.left_context }),
      ...(unit.right_context === undefined
        ? nullContexts
          ? { right_context: null }
          : {}
        : { right_context: unit.right_context }),
      route: unit.route,
      route_state: unit.route_state ?? 'RESOLVED',
      continuity_action: unit.continuity_actions[0] ?? null,
      continuity_state: unit.continuity_state ?? 'RESOLVED',
      rationale: '合成测试理由。',
      review_warnings: [],
    })),
  };
}

function publishResponse(body: unknown, status: number) {
  const url = new URL(endpoint),
    request = { origin: url.origin, path: url.pathname };
  channel('undici:request:create').publish({ request });
  channel('undici:request:headers').publish({
    request,
    response: { statusCode: status, headers: [] },
  });
  channel('undici:request:bodyChunkReceived').publish({
    request,
    chunk: Buffer.from(JSON.stringify(body)),
  });
  channel('undici:request:trailers').publish({ request });
}

async function environment(
  respond?: (
    fixture: ShotPlanSemanticGoldenFixtureV1,
    attempt: number,
  ) => { status?: number; text?: string; omitUsage?: boolean },
  budgetCny = 2,
) {
  const path = directory();
  const now = new Date();
  const env = await openGoldenEvaluationEnvironment({
    directory: path,
    budgetCny,
    listen: false,
    provider: {
      endpoint,
      apiKey: 'eval-key',
      webhookSecret: 'eval-webhook',
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
      approvedBy: 'deterministic-test-only',
      approvedAt: new Date(now.getTime() - 1000).toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    },
  });
  cleanup.push(env.close);
  const usage = observeGoldenProviderUsage(endpoint);
  cleanup.push(usage.close);
  const snapshots = new Map<string, { index: number; attempt: number }>();
  const order: string[] = [];
  let current: { index: number; attempt: number };
  let active = 0,
    maximumActive = 0,
    providerCalls = 0;
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1/v1/text/generate')) {
      const body = JSON.parse(String(init!.body));
      let state = snapshots.get(body.request_snapshot_hash);
      if (!state) {
        state = { index: snapshots.size, attempt: 0 };
        snapshots.set(body.request_snapshot_hash, state);
        order.push(fixtures[state.index]!.id);
      }
      state.attempt += 1;
      current = state;
      const response = await env.gateway.inject({
        method: 'POST',
        url: '/v1/text/generate',
        headers: Object.fromEntries(new Headers(init!.headers)),
        payload: String(init!.body),
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url !== endpoint) throw new Error('NETWORK_FORBIDDEN');
    providerCalls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    const fixture = fixtures[current.index]!;
    const chosen = respond?.(fixture, current.attempt) ?? {};
    const status = chosen.status ?? 200;
    const wire = JSON.parse(String(init!.body));
    expect(wire).toMatchObject({
      model: 'qwen3.7-plus',
      enable_thinking: false,
      temperature: 0.7,
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, name: 'ShotPlanSemanticProposalV1' },
      },
    });
    for (const key of [
      'max_tokens',
      'max_completion_tokens',
      'thinking_budget',
      'reasoning_effort',
      'tools',
      'stream',
    ])
      expect(wire).not.toHaveProperty(key);
    const body =
      status === 200
        ? {
            id: `synthetic_response_${providerCalls}`,
            model: 'qwen3.7-plus',
            choices: [{ message: { content: chosen.text ?? JSON.stringify(proposal(fixture)) } }],
            ...(chosen.omitUsage
              ? {}
              : { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }),
          }
        : {
            code: status === 403 ? 'insufficient_quota' : 'InvalidApiKey',
            message: 'private Provider message must not be persisted',
          };
    publishResponse(body, status);
    active -= 1;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    env,
    usage,
    path,
    order,
    run: () =>
      runShotPlanGoldenEvaluation({
        ...env,
        usage,
        directory: path,
        gitHead: head,
        executionKind: 'DETERMINISTIC_FAKE_TRANSPORT',
      }),
    stats: () => ({ maximumActive, providerCalls }),
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const close of cleanup.splice(0).reverse()) await close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('zero-network real golden harness preparation', () => {
  it('discovers exactly 30 fixtures, preserves order, traverses the authenticated chain sequentially and aggregates actual settlements', async () => {
    const test = await environment();
    const result = await test.run();
    expect(test.order).toEqual(fixtures.map((f) => f.id));
    expect(test.stats()).toEqual({ maximumActive: 1, providerCalls: 30 });
    expect(new Set(result.cases.map((c) => c.operation_id)).size).toBe(30);
    expect(new Set(result.cases.map((c) => c.source_document_id)).size).toBe(30);
    expect(new Set(result.cases.map((c) => c.candidate?.candidate_id)).size).toBe(30);
    expect(result.summary).toMatchObject({
      FIXTURES_EXPECTED: 30,
      FIXTURES_STARTED: 30,
      FIXTURES_TECHNICALLY_COMPLETED: 30,
      FIXTURES_AUTOMATED_SEMANTIC_PASS: 30,
      FIXTURES_TECHNICAL_FAIL: 0,
      STRUCTURAL_PASS_COUNT: 30,
      SEGMENTATION_PASS_COUNT: 30,
      ROUTE_PASS_COUNT: 30,
      CONTINUITY_PASS_COUNT: 30,
      NEEDS_REVIEW_PASS_COUNT: 30,
      FORBIDDEN_VIOLATION_CASE_COUNT: 0,
      AUTOMATED_30_CASE_GOLDEN_RESULT: 'PASS',
      C3C_REAL_MODEL_SEMANTIC_ACCEPTANCE: 'PENDING_BRAIN1_REVIEW',
      PROMPT_TOKENS_TOTAL: 300,
      COMPLETION_TOKENS_TOTAL: 600,
      TOTAL_TOKENS_TOTAL: 900,
      git_head: head,
      execution_kind: 'DETERMINISTIC_FAKE_TRANSPORT',
      REAL_PROVIDER_REQUEST_COUNT: 0,
      model_version_policy: 'ROLLING_PROVIDER_MODEL',
    });
    expect(result.summary.SETTLED_COST_CNY_TOTAL).toBeCloseTo(0.0054, 10);
    const ambiguity = result.cases.find((c) => c.expected_needs_review)!;
    expect(ambiguity.actual_needs_review).toBe(true);
    expect(ambiguity.automated_semantic_result).toBe('AUTOMATED_SEMANTIC_PASS');
    for (const c of result.cases) {
      expect(c.provider_attempts).toBe(1);
      expect(c.candidate?.candidate_revision).toBe(1);
      expect(c.attempts[0]?.normalization_audit?.NORMALIZATION_AUDIT_CAPTURED).toBe(
        'NOT_APPLICABLE',
      );
    }
    const summaryPath = join(test.path, 'real-30-golden-summary.json');
    const casesPath = join(test.path, 'real-30-golden-cases.json');
    expect(JSON.parse(readFileSync(summaryPath, 'utf8'))).toEqual(result.summary);
    const saved = JSON.parse(readFileSync(casesPath, 'utf8'));
    expect(saved.fixture_count).toBe(30);
    expect(saved.fixture_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(saved.cases).toHaveLength(30);
    if (process.platform !== 'win32') expect(statSync(summaryPath).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(casesPath, 'utf8');
    await expect(test.run()).rejects.toThrow('GOLDEN_EVIDENCE_ALREADY_EXISTS');
    expect(readFileSync(casesPath, 'utf8')).toBe(bytes);
    expect(test.stats().providerCalls).toBe(30);
  });

  it('accepts approved alternatives beyond alternative zero and captures null-context normalization with no extra requests', async () => {
    expect(fixtures.some((f) => f.acceptable_alternatives.length > 1)).toBe(true);
    const test = await environment((fixture) => ({
      text: JSON.stringify(
        proposal(fixture, fixture.acceptable_alternatives.length > 1 ? 1 : 0, true),
      ),
    }));
    const result = await test.run();
    expect(result.summary.AUTOMATED_30_CASE_GOLDEN_RESULT).toBe('PASS');
    expect(test.stats().providerCalls).toBe(30);
    for (const c of result.cases) {
      expect(c.attempts[0]!.raw_provider_canonical_schema_validation).toBe('FAIL');
      expect(c.attempts[0]!.post_normalization_canonical_schema_validation).toBe('PASS');
      expect(c.attempts[0]!.normalization_audit?.NORMALIZATION_AUDIT_CAPTURED).toBe('YES');
      expect(c.attempts[0]!.normalization_audit_events).toHaveLength(1);
    }
  });

  it('keeps semantic mismatches separate, preserves exact forbidden reasons, and continues to fixture 30', async () => {
    const target = fixtures.find((f) => f.id === 'vet-commerce-product-name-animal-outcome')!;
    const test = await environment((fixture) => {
      const value = proposal(fixture);
      if (fixture.id === target.id) value.units[0]!.route = 'PRODUCT';
      return { text: JSON.stringify(value) };
    });
    const result = await test.run();
    const failed = result.cases.find((c) => c.fixture_id === target.id)!;
    expect(failed.technical_result).toBe('PASS');
    expect(failed.automated_semantic_result).toBe('AUTOMATED_SEMANTIC_FAIL');
    expect(failed.evaluation!.forbidden_outcome_violations).toEqual(
      target.forbidden_outcomes.filter((o) => o.route === 'PRODUCT').map((o) => o.reason),
    );
    expect(result.summary).toMatchObject({
      FIXTURES_STARTED: 30,
      FIXTURES_TECHNICALLY_COMPLETED: 30,
      FIXTURES_AUTOMATED_SEMANTIC_PASS: 29,
      FIXTURES_AUTOMATED_SEMANTIC_FAIL: 1,
      FORBIDDEN_VIOLATION_CASE_COUNT: 1,
      AUTOMATED_30_CASE_GOLDEN_RESULT: 'FAIL',
    });
  });

  it.each([401, 403])(
    'stops on systemic nonretryable HTTP %i without wasting the remaining calls',
    async (status) => {
      const test = await environment(() => ({ status }));
      const result = await test.run();
      expect(result.cases[0]?.error_code).toBe(status === 403 ? 'QUOTA_EXHAUSTED' : 'AUTH_FAILED');
      expect(test.stats().providerCalls).toBe(1);
      expect(result.summary.FIXTURES_STARTED).toBe(1);
      expect(result.summary.SUITE_STOP_REASON).toBe(
        status === 403 ? 'QUOTA_EXHAUSTED' : 'AUTH_FAILED',
      );
      expect(result.cases[0]?.technical_result).toBe('FAIL_PROVIDER');
      expect(result.cases[0]?.automated_semantic_result).toBe('NOT_EVALUATED');
      expect(result.summary.SETTLED_COST_CNY_TOTAL).toBe(0);
    },
  );

  it('retains the failed first structural attempt and its actual cost when the default bounded retry succeeds', async () => {
    const test = await environment((fixture, attempt) => ({
      text:
        fixture.id === fixtures[0]!.id && attempt === 1
          ? 'not JSON'
          : JSON.stringify(proposal(fixture, 0, true)),
    }));
    const result = await test.run();
    expect(result.summary.AUTOMATED_30_CASE_GOLDEN_RESULT).toBe('PASS');
    expect(test.stats().providerCalls).toBe(31);
    expect(result.cases[0]!.attempts).toHaveLength(2);
    expect(result.cases[0]!.attempts[0]!.raw_json_parse).toBe('FAIL');
    expect(result.cases[0]!.provider_attempts).toBe(2);
    expect(result.summary.SETTLED_COST_CNY_TOTAL).toBeCloseTo(31 * 0.00018, 10);
  });

  it('retains failed normalization audit from an earlier legitimate canonical retry', async () => {
    const test = await environment((fixture, attempt) => {
      const value = proposal(fixture, 0, true);
      return {
        text: JSON.stringify(
          fixture.id === fixtures[0]!.id && attempt === 1
            ? { ...value, unknown_field: true }
            : value,
        ),
      };
    });
    const result = await test.run();
    expect(result.summary.AUTOMATED_30_CASE_GOLDEN_RESULT).toBe('PASS');
    expect(result.cases[0]!.attempts[0]!.normalization_audit_events[0]).toMatchObject({
      post_normalization_canonical_schema_validation: 'FAIL',
    });
    expect(result.cases[0]!.attempts[1]!.normalization_audit?.NORMALIZATION_AUDIT_CAPTURED).toBe(
      'YES',
    );
    expect(test.stats().providerCalls).toBe(31);
  });

  it('does not reward blanket NEEDS_REVIEW while preserving the genuinely approved ambiguous case', async () => {
    const test = await environment((fixture) => ({
      text: JSON.stringify({ ...proposal(fixture), segmentation_state: 'NEEDS_REVIEW' }),
    }));
    const result = await test.run();
    expect(result.summary.FIXTURES_TECHNICALLY_COMPLETED).toBe(30);
    expect(result.summary.NEEDS_REVIEW_PASS_COUNT).toBe(
      fixtures.filter((f) => f.expected_needs_review).length,
    );
    expect(result.summary.FIXTURES_AUTOMATED_SEMANTIC_FAIL).toBe(29);
  });

  it('reports raw JSON, canonical and exact-reconciliation failures as technical failures rather than semantic mismatches', async () => {
    const test = await environment((fixture) => {
      if (fixture.id === fixtures[0]!.id) return { text: 'invalid JSON' };
      const value = proposal(fixture);
      if (fixture.id === fixtures[1]!.id)
        return { text: JSON.stringify({ ...value, unknown_field: true }) };
      if (fixture.id === fixtures[2]!.id)
        value.units[0]!.exact_fragment = 'synthetic source mismatch';
      return { text: JSON.stringify(value) };
    });
    const result = await test.run();
    expect(result.cases.slice(0, 3).map((c) => c.technical_result)).toEqual([
      'FAIL_RAW_JSON',
      'FAIL_CANONICAL',
      'FAIL_RECONCILIATION',
    ]);
    expect(result.summary.FIXTURES_TECHNICAL_FAIL).toBe(3);
    expect(result.cases[1]!.attempts[0]!.raw_semantic_proposal?.units[0]).toMatchObject({
      exact_fragment: fixtures[1]!.acceptable_alternatives[0]!.units[0]!.exact_fragment,
    });
    expect(result.cases[1]!.attempts[0]!.canonical_proposal).toBeNull();
    expect(result.summary.FIXTURES_AUTOMATED_SEMANTIC_FAIL).toBe(0);
    expect(result.summary.FIXTURES_STARTED).toBe(30);
  });

  it('rejects secret-bearing semantic evidence without persisting credentials, endpoint, prompt or schema', async () => {
    const test = await environment((fixture) => {
      const value = proposal(fixture);
      value.units[0]!.rationale = 'eval-key';
      return { text: JSON.stringify(value) };
    });
    await expect(test.run()).rejects.toThrow('EVIDENCE_SECRET_REJECTED');
    expect(test.stats().providerCalls).toBe(1);
    for (const name of ['real-30-golden-summary.json', 'real-30-golden-cases.json']) {
      const value = readFileSync(join(test.path, name), 'utf8');
      expect(value).not.toContain('eval-key');
      expect(value).not.toContain(endpoint);
      expect(value).not.toContain('synthetic-eval');
      expect(value).not.toContain('activation_code');
      expect(value).not.toContain('PRIVATE KEY');
    }
  });

  it('checks collisions before any Provider request', async () => {
    const test = await environment();
    writeFileSync(join(test.path, 'real-30-golden-cases.json'), 'existing-evidence');
    await expect(test.run()).rejects.toThrow('GOLDEN_EVIDENCE_ALREADY_EXISTS');
    expect(test.stats().providerCalls).toBe(0);
  });

  it.each([0, -1, NaN, Infinity])(
    'rejects invalid explicit evaluation budget %s before HTTP',
    async (budget) => {
      await expect(environment(undefined, budget)).rejects.toThrow(
        'GOLDEN_INVALID_EXPLICIT_BUDGET',
      );
    },
  );

  it('distinguishes Candidate persistence failure and stops an invalid local environment', async () => {
    const test = await environment();
    test.env.desktopDb.exec(
      "CREATE TRIGGER reject_test_candidate BEFORE INSERT ON shot_plan_candidates BEGIN SELECT RAISE(ABORT, 'synthetic rejection'); END;",
    );
    const result = await test.run();
    expect(result.cases[0]!.technical_result).toBe('FAIL_CANDIDATE');
    expect(result.cases[0]!.automated_semantic_result).toBe('NOT_EVALUATED');
    expect(result.summary.SUITE_STOP_REASON).toBe('CANDIDATE_PERSISTENCE_FAILED');
    expect(test.stats().providerCalls).toBe(1);
  });

  it('stops before a new paid request when the explicit temporary budget cannot reserve the next case', async () => {
    const test = await environment(undefined, 1.560576);
    const result = await test.run();
    expect(result.summary.FIXTURES_STARTED).toBe(2);
    expect(test.stats().providerCalls).toBe(1);
    expect(result.summary.SUITE_STOP_REASON).toBe('BUDGET_EXCEEDED');
    expect(result.summary.SETTLED_COST_CNY_TOTAL).toBeCloseTo(0.00018, 10);
    expect(result.summary.TOTAL_TOKENS_TOTAL).toBe(30);
  });

  it('records unknown usage as unknown and stops instead of substituting an estimate', async () => {
    const test = await environment(() => ({ omitUsage: true }));
    const result = await test.run();
    expect(result.summary.SUITE_STOP_REASON).toBe('USAGE_EVIDENCE_INCONSISTENT');
    expect(result.summary.PROMPT_TOKENS_TOTAL).toBeNull();
    expect(result.summary.SETTLED_COST_CNY_TOTAL).toBe(0);
    expect(result.cases[0]!.technical_result).toBe('FAIL_EVIDENCE');
    expect(test.stats().providerCalls).toBe(1);
  });
});

describe('test-only client capture and aggregate rule', () => {
  it('returns the exact result object and forwards original arguments even when observation fails', async () => {
    const request = {} as TextGatewayRequestV1,
      result = {} as TextGatewayResultV1;
    const options = { signal: new AbortController().signal };
    const generate = vi.fn(async () => result);
    const wrapper = captureGoldenClient(
      { generate },
      () => {
        throw new Error('observer');
      },
      () => {
        throw new Error('observer');
      },
    );
    expect(await wrapper.generate(request, options)).toBe(result);
    expect(generate).toHaveBeenCalledExactlyOnceWith(request, options);
    const failure = new Error('original failure');
    await expect(
      captureGoldenClient(
        {
          generate: async () => {
            throw failure;
          },
        },
        () => {},
        () => {},
      ).generate(request),
    ).rejects.toBe(failure);
  });

  it('requires every dimension and an empty forbidden list, without averaging', () => {
    const success = {
      structural_validity: true,
      segmentation: true,
      route: true,
      continuity: true,
      needs_review: true,
      forbidden_outcome_violations: [] as string[],
    };
    expect(automatedSemanticPass(success)).toBe(true);
    for (const key of [
      'structural_validity',
      'segmentation',
      'route',
      'continuity',
      'needs_review',
    ])
      expect(automatedSemanticPass({ ...success, [key]: false })).toBe(false);
    expect(
      automatedSemanticPass({
        ...success,
        forbidden_outcome_violations: ['fixture-approved reason'],
      }),
    ).toBe(false);
  });
});
