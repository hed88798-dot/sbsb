import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlibabaQwen37C3cTextAdapter, ProviderAdapterError } from '@app/provider-adapters';
import { ShotPlanAuthorityService } from '../../apps/desktop/src/main/shot-plan-authority-service.js';
import { ShotPlanProposerServiceV1 } from '../../apps/desktop/src/main/shot-plan-proposer-service.js';
import { SourceDocumentAuthorityService } from '../../apps/desktop/src/main/source-document-authority-service.js';
import { sha256, signingMessage } from '../../apps/gateway/src/index.js';
import {
  CopywritingRepository,
  ShotPlanAuthorityRepository,
  SourceDocumentRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import { HttpTextCapabilityClient } from '../../packages/provider-client/src/index.js';
import {
  createGatewayFixture,
  requestFor,
  signedInject,
  type GatewayFixture,
} from '../helpers/gateway-fixture.js';
import { textRequest } from '../helpers/text-structured-output.js';

let fixture: GatewayFixture | undefined;
let desktop: Database | undefined;
afterEach(async () => {
  await fixture?.close();
  desktop?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sensitiveProviderMessage = 'private upstream response; Bearer fake-secret; workspace-private';
const failures = [
  ['AUTH_FAILED', false],
  ['QUOTA_EXHAUSTED', false],
  ['INVALID_PARAMS', false],
  ['RATE_LIMITED', true],
  ['UPSTREAM_5XX', true],
  ['UNAVAILABLE', true],
] as const;

describe('synchronous text Provider error propagation', () => {
  it.each(failures)('publishes only sanitized %s failure authority', async (code, retryable) => {
    fixture = await createGatewayFixture();
    const submit = vi
      .spyOn(fixture.adapter, 'submit')
      .mockRejectedValue(new ProviderAdapterError(code, sensitiveProviderMessage, retryable));
    const requestId = 'req_sanitized_text_error';
    const send = () =>
      signedInject(fixture!, {
        method: 'POST',
        url: '/v1/text/generate',
        requestId,
        body: textRequest,
      });
    const response = await send();
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      schema_version: '1.0',
      code,
      message: expect.any(String),
      retryable,
      request_id: requestId,
    });
    expect(response.body).not.toContain(sensitiveProviderMessage);
    expect(response.body).not.toContain('fake-secret');
    expect(response.body).not.toContain('workspace-private');
    // A replay must derive the same failure from the persistent job, without resubmitting.
    expect((await send()).json()).toEqual(response.json());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('sanitizes unrecognized stored failure classes without granting retries', async () => {
    fixture = await createGatewayFixture();
    vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(new Error(sensitiveProviderMessage));
    await signedInject(fixture, {
      method: 'POST',
      url: '/v1/text/generate',
      body: textRequest,
    });
    fixture.database.db
      .prepare('UPDATE provider_jobs SET error_class = ?')
      .run(sensitiveProviderMessage);
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/text/generate',
      body: textRequest,
    });
    expect(response.json()).toMatchObject({ code: 'TEXT_PROVIDER_FAILED', retryable: false });
    expect(response.body).not.toContain(sensitiveProviderMessage);
  });

  it.each(['token', 'signature'] as const)(
    'preserves local %s authentication rejection',
    async (kind) => {
      fixture = await createGatewayFixture();
      const submit = vi.spyOn(fixture.adapter, 'submit');
      const signingFixture =
        kind === 'signature'
          ? { ...fixture, privateKey: generateKeyPairSync('ed25519').privateKey }
          : fixture;
      const response = await signedInject(signingFixture, {
        method: 'POST',
        url: '/v1/text/generate',
        body: textRequest,
        ...(kind === 'token' ? { accessToken: 'invalid-local-token' } : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ retryable: false });
      expect(response.json().code).not.toBe('AUTH_FAILED');
      if (kind === 'signature') {
        expect(response.json().code).toBe('INVALID_DEVICE_SIGNATURE');
      }
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it('leaves generic Provider Job failure semantics unchanged', async () => {
    fixture = await createGatewayFixture();
    vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(
      new ProviderAdapterError('AUTH_FAILED', sensitiveProviderMessage, false),
    );
    const created = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('text.generate.v1', 'req_generic_failure'),
    });
    expect(created.statusCode).toBe(201);
    const job = created.json();
    expect(job).toMatchObject({
      state: 'FAILED',
      error: { code: 'PROVIDER_REQUEST_FAILED', message: 'Provider job failed', retryable: false },
    });
    const polled = await signedInject(fixture, { method: 'GET', url: `/v1/jobs/${job.job_id}` });
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toEqual(job);
  });
});

async function realLocalChain() {
  fixture = await createGatewayFixture({ textModelAlias: 'text.semantic-shot-planning' });
  const gateway = fixture;
  await gateway.app.listen({ host: '127.0.0.1', port: 0 });
  const address = gateway.app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local Gateway address');
  const directory = mkdtempSync(join(tmpdir(), 'text-failure-proposer-'));
  desktop = (
    await openDatabase({
      dbPath: join(directory, 'desktop.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    })
  ).db;
  const now = '2026-09-17T00:00:00.000Z';
  const text = '使用康健100后，猪群采食状态逐步恢复。';
  desktop
    .prepare(
      'INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at) VALUES (?, NULL, 1, ?, ?)',
    )
    .run('script_error_test', now, now);
  desktop
    .prepare(
      `INSERT INTO script_versions(
        script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
        fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
        provider_model, request_snapshot_hash, created_at
      ) VALUES (?, 1, ?, ?, 'SUCCEEDED', NULL, '[]', 'synthetic', '1', 'synthetic', 'synthetic', ?, ?)`,
    )
    .run('script_error_test', text, text, sha256(text), now);
  const sourceDocuments = new SourceDocumentRepository(desktop);
  const source = new SourceDocumentAuthorityService({
    scripts: new CopywritingRepository(desktop),
    sourceDocuments,
    clock: () => now,
  }).ensureFromScriptVersion({ script_id: 'script_error_test', script_version: 1 });
  const client = new HttpTextCapabilityClient({
    backendUrl: `http://127.0.0.1:${address.port}`,
    accessToken: gateway.accessToken,
    requestSigner: {
      sign: async (input) => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const nonce = randomBytes(18).toString('base64url');
        return {
          timestamp,
          nonce,
          bodySha256: sha256(input.body),
          signature: sign(
            null,
            Buffer.from(signingMessage({ ...input, timestamp, nonce })),
            gateway.privateKey,
          ).toString('base64'),
        };
      },
    },
  });
  const service = new ShotPlanProposerServiceV1({
    sourceDocuments,
    shotPlans: new ShotPlanAuthorityService({
      sourceDocuments,
      repository: new ShotPlanAuthorityRepository(desktop),
      clock: () => now,
    }),
    client,
    // Deliberately use the production default retry policy.
    audit: () => undefined,
  });
  const operation = {
    operation_id: 'synthetic_error_propagation',
    source_document_id: source.source_document_id,
    source_document_version: source.source_document_version,
    source_document_hash: source.source_document_hash,
  };
  return { gateway, client, service, operation, text };
}

describe('default C3C retry policy through authenticated HTTP Gateway', () => {
  it.each([
    [403, 'QUOTA_EXHAUSTED', false, 1, 'Text provider quota exhausted'],
    [429, 'RATE_LIMITED', true, 2, 'Text provider rate limited'],
  ] as const)(
    'preserves status-aware real adapter classification of HTTP %s insufficient_quota',
    async (status, errorClass, retryable, attempts, message) => {
      const { gateway, client, service, operation } = await realLocalChain();
      const endpoint =
        'https://synthetic-quota-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
      const alibaba = new AlibabaQwen37C3cTextAdapter({
        endpoint,
        apiKey: 'synthetic-quota-key',
        webhookSecret: 'synthetic-quota-webhook',
        inputUnitCost: 0.000002,
        outputUnitCost: 0.000008,
        currency: 'CNY',
      });
      const originalFetch = globalThis.fetch;
      const upstream = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'insufficient_quota',
              request_id: 'synthetic-upstream-quota-id',
              message: sensitiveProviderMessage,
            }),
            { status },
          ),
      );
      vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(input) === endpoint) return upstream();
        if (new URL(String(input)).hostname !== '127.0.0.1')
          throw new Error('TEST_NETWORK_BOUNDARY');
        return originalFetch(input, init);
      });
      const adapterSubmit = vi.spyOn(alibaba, 'submit');
      // The fixture registers the synthetic route; execution delegates to the real Alibaba adapter.
      const gatewaySubmit = vi
        .spyOn(gateway.adapter, 'submit')
        .mockImplementation((request) => alibaba.submit(request));
      const generate = vi.spyOn(client, 'generate');
      await expect(service.propose(operation)).rejects.toMatchObject({
        code: `SHOT_PLAN_PROPOSAL_PROVIDER_${errorClass}`,
      });
      expect(upstream).toHaveBeenCalledTimes(attempts);
      expect(adapterSubmit).toHaveBeenCalledTimes(attempts);
      expect(gatewaySubmit).toHaveBeenCalledTimes(attempts);
      expect(generate).toHaveBeenCalledTimes(attempts);
      await expect(generate.mock.results[0]!.value).rejects.toMatchObject({
        code: errorClass,
        retryable,
        message,
      });
      expect(
        gateway.database.db.prepare('SELECT state, error_class FROM provider_jobs').all(),
      ).toEqual(
        Array.from({ length: attempts }, () => ({ state: 'FAILED', error_class: errorClass })),
      );
      expect(
        gateway.database.db.prepare('SELECT state, amount FROM cost_reservations').all(),
      ).toEqual(Array.from({ length: attempts }, () => ({ state: 'RELEASED', amount: 0 })));
      const audit = gateway.database.db
        .prepare(
          "SELECT metadata_json FROM audit_events WHERE action = 'PROVIDER_FAILURE_DIAGNOSTIC'",
        )
        .all() as Array<{ metadata_json: string }>;
      expect(audit).toHaveLength(attempts);
      for (const event of audit) {
        expect(JSON.parse(event.metadata_json)).toEqual({
          provider_alias: gateway.adapter.alias,
          provider_model: gateway.adapter.providerModel,
          error_class: errorClass,
          http_status: status,
          provider_code: 'insufficient_quota',
          provider_request_id: 'synthetic-upstream-quota-id',
        });
        expect(event.metadata_json).not.toContain(sensitiveProviderMessage);
      }
      expect(desktop!.prepare('SELECT COUNT(*) AS count FROM shot_plan_candidates').get()).toEqual({
        count: 0,
      });
    },
  );

  it.each(failures)('preserves %s retryability end-to-end', async (code, retryable) => {
    const { gateway, client, service, operation, text } = await realLocalChain();
    const error = new ProviderAdapterError(code, sensitiveProviderMessage, retryable, undefined, {
      providerRequestId: 'synthetic-upstream-request',
    });
    const submit = vi.spyOn(gateway.adapter, 'submit');
    const generate = vi.spyOn(client, 'generate');
    if (retryable) {
      submit.mockRejectedValueOnce(error).mockResolvedValueOnce({
        providerJobId: 'synthetic_recovered_text',
        state: 'SUCCEEDED',
        finalCost: 0.01,
        billedUnits: 10,
        artifacts: [],
        text: JSON.stringify({
          schema_version: '1.0',
          segmentation_state: 'RESOLVED',
          review_warnings: [],
          units: [
            {
              exact_fragment: text,
              route: 'ANIMAL',
              route_state: 'RESOLVED',
              continuity_action: 'START_NEW',
              continuity_state: 'RESOLVED',
              rationale: '合成动物状态描述。',
              review_warnings: [],
            },
          ],
        }),
      });
      const result = await service.propose(operation);
      expect(result.trace.provider_attempts).toBe(2);
      expect(result.candidate.candidate_revision).toBe(1);
    } else {
      submit.mockRejectedValue(error);
      await expect(service.propose(operation)).rejects.toMatchObject({
        code: `SHOT_PLAN_PROPOSAL_PROVIDER_${code}`,
      });
      expect(desktop!.prepare('SELECT COUNT(*) AS count FROM shot_plan_candidates').get()).toEqual({
        count: 0,
      });
    }
    const attempts = retryable ? 2 : 1;
    expect(submit).toHaveBeenCalledTimes(attempts);
    expect(generate).toHaveBeenCalledTimes(attempts);
    await expect(generate.mock.results[0]!.value).rejects.toMatchObject({ code, retryable });
    expect(
      gateway.database.db
        .prepare('SELECT COUNT(DISTINCT request_id) AS count FROM provider_jobs')
        .get(),
    ).toEqual({ count: attempts });
    expect(
      gateway.database.db
        .prepare("SELECT error_class FROM provider_jobs WHERE state = 'FAILED'")
        .all(),
    ).toEqual([{ error_class: code }]);
  });

  it('keeps AUTH_FAILED non-retryable and releases budget if diagnostic audit fails', async () => {
    const { gateway, client, service, operation } = await realLocalChain();
    gateway.database.db.exec(`
      CREATE TRIGGER reject_diagnostic_audit BEFORE INSERT ON audit_events
      WHEN NEW.action = 'PROVIDER_FAILURE_DIAGNOSTIC'
      BEGIN SELECT RAISE(ABORT, 'synthetic diagnostic failure'); END;
    `);
    const submit = vi.spyOn(gateway.adapter, 'submit').mockRejectedValue(
      new ProviderAdapterError('AUTH_FAILED', sensitiveProviderMessage, false, undefined, {
        httpStatus: 403,
        providerCode: 'Workspace.AccessDenied',
        providerRequestId: 'synthetic-upstream',
      }),
    );
    const generate = vi.spyOn(client, 'generate');
    await expect(service.propose(operation)).rejects.toMatchObject({
      code: 'SHOT_PLAN_PROPOSAL_PROVIDER_AUTH_FAILED',
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      gateway.database.db.prepare('SELECT state, error_class FROM provider_jobs').get(),
    ).toEqual({ state: 'FAILED', error_class: 'AUTH_FAILED' });
    expect(
      gateway.database.db.prepare('SELECT state, amount FROM cost_reservations').get(),
    ).toEqual({ state: 'RELEASED', amount: 0 });
    expect(
      gateway.database.db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'PROVIDER_FAILURE_DIAGNOSTIC'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });
});
