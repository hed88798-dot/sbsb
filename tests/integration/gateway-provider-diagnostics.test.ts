import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderAdapterError } from '@app/provider-adapters';
import {
  createGatewayFixture,
  signedInject,
  type GatewayFixture,
} from '../helpers/gateway-fixture.js';
import { textRequest } from '../helpers/text-structured-output.js';
import { withCanaryProviderDiagnostics } from '../helpers/canary-provider-diagnostics.js';

let fixture: GatewayFixture | undefined;
afterEach(async () => {
  await fixture?.close();
  vi.restoreAllMocks();
});

const sensitive =
  'sensitive upstream message; Bearer synthetic-api-key; workspace-private.example; prompt; schema';
function authError() {
  return new ProviderAdapterError('AUTH_FAILED', sensitive, false, undefined, {
    httpStatus: 403,
    providerCode: 'Workspace.AccessDenied',
    providerRequestId: 'upstream-test-request',
  });
}
function diagnosticEvents() {
  return fixture!.database.db
    .prepare("SELECT * FROM audit_events WHERE action = 'PROVIDER_FAILURE_DIAGNOSTIC'")
    .all() as Array<{
    actor_type: string;
    actor_id: string;
    target_type: string;
    target_id: string;
    metadata_json: string;
  }>;
}
function send() {
  return signedInject(fixture!, { method: 'POST', url: '/v1/text/generate', body: textRequest });
}

describe('internal Provider diagnostic audit', () => {
  it('records exactly one allowlisted event per failed attempt and none on replay', async () => {
    fixture = await createGatewayFixture();
    const submit = vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(authError());
    const response = await send();
    const replay = await send();
    expect(response.statusCode).toBe(502);
    expect(replay.json()).toMatchObject({ code: 'AUTH_FAILED', retryable: false });
    expect(submit).toHaveBeenCalledTimes(1);
    const events = diagnosticEvents();
    expect(events).toHaveLength(1);
    const job = fixture.database.db.prepare('SELECT job_id FROM provider_jobs').get() as {
      job_id: string;
    };
    expect(events[0]).toMatchObject({
      actor_type: 'SYSTEM',
      actor_id: 'gateway',
      target_type: 'PROVIDER_JOB',
      target_id: job.job_id,
    });
    expect(JSON.parse(events[0]!.metadata_json)).toEqual({
      provider_alias: fixture.adapter.alias,
      provider_model: fixture.adapter.providerModel,
      error_class: 'AUTH_FAILED',
      http_status: 403,
      provider_code: 'Workspace.AccessDenied',
      provider_request_id: 'upstream-test-request',
    });
    for (const value of [
      sensitive,
      'Bearer',
      'synthetic-api-key',
      'workspace-private.example',
      'prompt',
      'schema',
    ]) {
      expect(events[0]!.metadata_json).not.toContain(value);
    }
    expect(response.json()).toEqual({
      schema_version: '1.0',
      code: 'AUTH_FAILED',
      message: 'Text provider authentication failed',
      retryable: false,
      request_id: expect.any(String),
    });
    expect(response.body).not.toContain('Workspace.AccessDenied');
    expect(response.body).not.toContain('upstream-test-request');
  });

  it('does not record raw diagnostics on an error without safe fields', async () => {
    fixture = await createGatewayFixture();
    vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(
      new ProviderAdapterError('AUTH_FAILED', sensitive, false),
    );
    await send();
    expect(diagnosticEvents()).toHaveLength(0);
  });

  it('revalidates mutated diagnostic objects at the audit boundary', async () => {
    fixture = await createGatewayFixture();
    const error = authError();
    Object.defineProperty(error, 'providerDiagnostic', {
      value: {
        httpStatus: 403,
        providerCode: sensitive,
        providerRequestId: 'unsafe\nrequest',
        message: sensitive,
        authorization: sensitive,
      },
    });
    vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(error);
    await send();
    expect(JSON.parse(diagnosticEvents()[0]!.metadata_json)).toEqual({
      provider_alias: fixture.adapter.alias,
      provider_model: fixture.adapter.providerModel,
      error_class: 'AUTH_FAILED',
      http_status: 403,
    });
  });

  it('records each failed fallback attempt once with the correct adapter identity', async () => {
    fixture = await createGatewayFixture({ fallbackScenario: 'success' });
    const primary = vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(
      new ProviderAdapterError('RATE_LIMITED', sensitive, true, undefined, {
        httpStatus: 429,
        providerCode: 'Throttled',
        providerRequestId: 'primary-upstream-id',
      }),
    );
    const fallback = vi.spyOn(fixture.fallback!, 'submit').mockRejectedValue(authError());
    expect((await send()).json()).toMatchObject({ code: 'AUTH_FAILED', retryable: false });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    const events = diagnosticEvents();
    expect(events).toHaveLength(2);
    expect(events.map((event) => JSON.parse(event.metadata_json).provider_alias)).toEqual([
      fixture.adapter.alias,
      fixture.fallback!.alias,
    ]);
    expect(events[0]!.target_id).toBe(events[1]!.target_id);
  });

  it('leaves success free of failure-diagnostic events', async () => {
    fixture = await createGatewayFixture();
    expect((await send()).statusCode).toBe(200);
    expect(diagnosticEvents()).toHaveLength(0);
  });
});

describe('opt-in canary diagnostic reporting helper', () => {
  it('reports only safe evidence and rethrows the identical application failure', async () => {
    fixture = await createGatewayFixture();
    vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(authError());
    await send();
    const report = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const failure = new Error('synthetic original application failure');
    await expect(
      withCanaryProviderDiagnostics(fixture.database.db, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(report).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        error_class: 'AUTH_FAILED',
        http_status: 403,
        provider_code: 'Workspace.AccessDenied',
        provider_request_id: 'upstream-test-request',
      }),
    );
  });

  it('revalidates stored metadata before printing and omits every extra field', async () => {
    fixture = await createGatewayFixture();
    vi.spyOn(fixture.adapter, 'submit').mockRejectedValue(authError());
    await send();
    fixture.database.db
      .prepare(
        "UPDATE audit_events SET metadata_json = ? WHERE action = 'PROVIDER_FAILURE_DIAGNOSTIC'",
      )
      .run(
        JSON.stringify({
          error_class: 'AUTH_FAILED',
          http_status: 403,
          provider_code: sensitive,
          provider_request_id: 'unsafe\nrequest',
          raw_body: sensitive,
          headers: { authorization: sensitive },
        }),
      );
    const report = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const failure = new Error('synthetic failure');
    await expect(
      withCanaryProviderDiagnostics(fixture.database.db, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(report).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ error_class: 'AUTH_FAILED', http_status: 403 }),
    );
  });

  it('preserves the original failure when reading diagnostic audit fails', async () => {
    fixture = await createGatewayFixture();
    vi.spyOn(fixture.database.db, 'prepare').mockImplementationOnce(() => {
      throw new Error('synthetic audit read failure');
    });
    const failure = new Error('synthetic original failure');
    await expect(
      withCanaryProviderDiagnostics(fixture.database.db, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  it('keeps success unchanged and does not print failure diagnostics', async () => {
    fixture = await createGatewayFixture();
    const report = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await expect(
      withCanaryProviderDiagnostics(fixture.database.db, () =>
        Promise.resolve('synthetic success'),
      ),
    ).resolves.toBe('synthetic success');
    expect(report).not.toHaveBeenCalled();
  });
});
