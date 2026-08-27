import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGatewayFixture,
  requestFor,
  signedInject,
  type GatewayFixture,
} from '../helpers/gateway-fixture.js';

let fixture: GatewayFixture | undefined;
afterEach(async () => fixture?.close());

describe('Gateway idempotency, ledger and provider state', () => {
  it('creates one upstream job and one settlement for 20 concurrent duplicates', async () => {
    fixture = await createGatewayFixture({ scenario: 'slow' });
    const body = requestFor('image.generate.v1', 'duplicate_request_001');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        signedInject(fixture!, { method: 'POST', url: '/v1/jobs', body }),
      ),
    );
    expect(responses.every((response) => [200, 201].includes(response.statusCode))).toBe(true);
    expect(
      new Set(responses.map((response) => response.json<{ job_id: string }>().job_id)).size,
    ).toBe(1);
    expect(fixture.adapter.submitCount).toBe(1);
    expect(
      (
        fixture.database.db
          .prepare("SELECT COUNT(*) AS count FROM usage_events WHERE event_type = 'SETTLEMENT'")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        fixture.database.db.prepare('SELECT COUNT(*) AS count FROM cost_reservations').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
  });

  it('keeps budget reservation and job creation atomic under concurrency', async () => {
    fixture = await createGatewayFixture({ monthlyBudget: 0.5 });
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        signedInject(fixture!, {
          method: 'POST',
          url: '/v1/jobs',
          body: requestFor('image.generate.v1', `budget_request_${index}`),
        }),
      ),
    );
    const accepted = responses.filter((response) => response.statusCode === 201);
    expect(accepted).toHaveLength(5);
    expect(fixture.adapter.submitCount).toBe(5);
    const jobs = fixture.database.db
      .prepare('SELECT COUNT(*) AS count FROM provider_jobs')
      .get() as {
      count: number;
    };
    const reservations = fixture.database.db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM cost_reservations',
      )
      .get() as { count: number; amount: number };
    expect(jobs.count).toBe(5);
    expect(reservations).toMatchObject({ count: 5, amount: 0.5 });
  });

  it('recovers timeout-but-succeeded by status query without resubmitting', async () => {
    fixture = await createGatewayFixture({ scenario: 'timeout-but-succeeded' });
    const created = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('video.generate.v1', 'unknown_request_001'),
    });
    expect(created.json()).toMatchObject({ state: 'UNKNOWN' });
    const jobId = created.json<{ job_id: string }>().job_id;
    const polled = await signedInject(fixture, {
      method: 'GET',
      url: `/v1/jobs/${jobId}`,
    });
    expect(polled.json()).toMatchObject({ state: 'SUCCEEDED' });
    expect(fixture.adapter.submitCount).toBe(1);
  });

  it('reserves the declared upper bound and audits a cost over-estimate settlement', async () => {
    fixture = await createGatewayFixture({ scenario: 'cost-over-estimate' });
    const created = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'cost_over_request_001'),
    });
    expect(created.json()).toMatchObject({ state: 'SUCCEEDED', final_cost: 0.125 });
    const reservation = fixture.database.db
      .prepare('SELECT amount, state FROM cost_reservations')
      .get() as { amount: number; state: string };
    expect(reservation).toMatchObject({ amount: 0.125, state: 'SETTLED' });
    const ledger = fixture.database.db
      .prepare(
        "SELECT estimated_cost, final_cost FROM usage_events WHERE event_type = 'SETTLEMENT'",
      )
      .get() as { estimated_cost: number; final_cost: number };
    expect(ledger).toEqual({ estimated_cost: 0.1, final_cost: 0.125 });
  });

  it('does not use fallback to bypass moderation rejection', async () => {
    fixture = await createGatewayFixture({
      scenario: 'moderation-rejected',
      fallbackScenario: 'success',
    });
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'moderation_request_001'),
    });
    expect(response.json()).toMatchObject({ state: 'FAILED' });
    expect(fixture.adapter.submitCount).toBe(1);
    expect(fixture.fallback?.submitCount).toBe(0);
  });

  it('verifies webhook signature and ignores duplicate/out-of-order states', async () => {
    fixture = await createGatewayFixture({ scenario: 'queue' });
    const created = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('video.generate.v1', 'webhook_request_001'),
    });
    const jobId = created.json<{ job_id: string }>().job_id;
    const remote = fixture.database.db
      .prepare('SELECT provider_job_id FROM provider_jobs WHERE job_id = ?')
      .get(jobId) as { provider_job_id: string };
    const success = JSON.stringify({
      eventId: 'event_success_001',
      providerJobId: remote.provider_job_id,
      state: 'SUCCEEDED',
      finalCost: 0.2,
      billedUnits: 2,
      artifacts: [],
    });
    const invalid = await fixture.app.inject({
      method: 'POST',
      url: '/v1/webhooks/mock-primary',
      headers: {
        'content-type': 'application/webhook+json',
        'x-provider-signature': 'invalid',
      },
      payload: success,
    });
    expect(invalid.statusCode).toBe(401);
    const signature = createHmac('sha256', 'mock-webhook-secret').update(success).digest('hex');
    const accepted = await fixture.app.inject({
      method: 'POST',
      url: '/v1/webhooks/mock-primary',
      headers: {
        'content-type': 'application/webhook+json',
        'x-provider-signature': signature,
      },
      payload: success,
    });
    expect(accepted.statusCode).toBe(202);
    const duplicate = await fixture.app.inject({
      method: 'POST',
      url: '/v1/webhooks/mock-primary',
      headers: {
        'content-type': 'application/webhook+json',
        'x-provider-signature': signature,
      },
      payload: success,
    });
    expect(duplicate.json()).toMatchObject({ duplicate: true });

    const old = JSON.stringify({
      eventId: 'event_old_001',
      providerJobId: remote.provider_job_id,
      state: 'RUNNING',
      finalCost: null,
      billedUnits: 0,
      artifacts: [],
    });
    const oldSignature = createHmac('sha256', 'mock-webhook-secret').update(old).digest('hex');
    await fixture.app.inject({
      method: 'POST',
      url: '/v1/webhooks/mock-primary',
      headers: {
        'content-type': 'application/webhook+json',
        'x-provider-signature': oldSignature,
      },
      payload: old,
    });
    expect(
      fixture.database.db.prepare('SELECT state FROM provider_jobs WHERE job_id = ?').get(jobId),
    ).toMatchObject({ state: 'SUCCEEDED' });
    expect(
      (
        fixture.database.db
          .prepare(
            "SELECT COUNT(*) AS count FROM usage_events WHERE job_id = ? AND event_type = 'SETTLEMENT'",
          )
          .get(jobId) as { count: number }
      ).count,
    ).toBe(1);
  });
});
