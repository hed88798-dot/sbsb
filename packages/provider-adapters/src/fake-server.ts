import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type ProviderFakeServerScenario =
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
  | 'cost-over-estimate'
  | 'duplicate-webhook'
  | 'out-of-order-webhook'
  | 'expired-object'
  | 'invalid-signature';

export interface ProviderFakeServerHandle {
  url: string;
  submissionCount: () => number;
  close(): Promise<void>;
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function json(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function equalSignature(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function startProviderFakeServer(
  input: {
    scenario?: ProviderFakeServerScenario;
    webhookSecret?: string;
    port?: number;
  } = {},
): Promise<ProviderFakeServerHandle> {
  const scenario = input.scenario ?? 'success';
  const webhookSecret = input.webhookSecret ?? 'provider-fake-webhook-secret';
  const jobs = new Map<string, { requestId: string; state: string; finalCost: number }>();
  let submissions = 0;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://provider-fake.invalid');
    if (request.method === 'POST' && requestUrl.pathname === '/v1/jobs') {
      const body: Record<string, unknown> = await json(request).catch(() => ({}));
      const requestId =
        typeof body.request_id === 'string' ? body.request_id : `request_${randomUUID()}`;
      if (scenario === 'invalid-params') return respond(response, 400, { code: 'INVALID_PARAMS' });
      if (scenario === 'moderation-rejected')
        return respond(response, 422, { code: 'MODERATION_REJECTED' });
      if (scenario === '429') return respond(response, 429, { code: 'RATE_LIMITED' });
      if (scenario === '5xx') return respond(response, 503, { code: 'UNAVAILABLE' });
      submissions += 1;
      const jobId = `fake_job_${randomUUID()}`;
      const finalCost =
        scenario === 'cost-under-estimate' ? 0.05 : scenario === 'cost-over-estimate' ? 0.15 : 0.1;
      jobs.set(jobId, {
        requestId,
        state: scenario === 'queue' ? 'QUEUED' : 'SUCCEEDED',
        finalCost,
      });
      if (scenario === 'slow' || scenario === 'timeout-but-succeeded') {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return respond(response, 200, {
        job_id: jobId,
        state: scenario === 'timeout-but-succeeded' ? 'UNKNOWN' : jobs.get(jobId)?.state,
        estimated_cost: 0.1,
        final_cost: finalCost,
      });
    }
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/v1/jobs/')) {
      if (scenario === 'unknown-job') return respond(response, 200, { state: 'UNKNOWN' });
      const jobId = decodeURIComponent(requestUrl.pathname.slice('/v1/jobs/'.length));
      const job = jobs.get(jobId);
      return job
        ? respond(response, 200, { job_id: jobId, state: job.state, final_cost: job.finalCost })
        : respond(response, 404, { code: 'NOT_FOUND' });
    }
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/v1/by-request/')) {
      const requestId = decodeURIComponent(requestUrl.pathname.slice('/v1/by-request/'.length));
      const found = [...jobs].find(([, job]) => job.requestId === requestId);
      return found
        ? respond(response, 200, { job_id: found[0], state: found[1].state })
        : respond(response, 404, { code: 'NOT_FOUND' });
    }
    if (request.method === 'GET' && requestUrl.pathname === '/v1/webhook-events') {
      const base = { provider_job_id: 'fake_job_webhook', final_cost: 0.1 };
      return respond(
        response,
        200,
        scenario === 'duplicate-webhook'
          ? [
              { ...base, event_id: 'event_1', state: 'SUCCEEDED' },
              { ...base, event_id: 'event_1', state: 'SUCCEEDED' },
            ]
          : scenario === 'out-of-order-webhook'
            ? [
                { ...base, event_id: 'event_2', state: 'SUCCEEDED' },
                { ...base, event_id: 'event_3', state: 'RUNNING' },
              ]
            : [],
      );
    }
    if (request.method === 'GET' && requestUrl.pathname === '/v1/objects/check') {
      return scenario === 'expired-object'
        ? respond(response, 410, { code: 'OBJECT_EXPIRED' })
        : respond(response, 200, { state: 'AVAILABLE' });
    }
    if (request.method === 'POST' && requestUrl.pathname === '/v1/webhook/verify') {
      const raw = JSON.stringify(await json(request).catch(() => ({})));
      const expected = createHmac('sha256', webhookSecret).update(raw).digest('hex');
      const actual =
        typeof request.headers['x-provider-signature'] === 'string'
          ? request.headers['x-provider-signature']
          : '';
      if (scenario === 'invalid-signature' || !equalSignature(expected, actual)) {
        return respond(response, 401, { code: 'INVALID_SIGNATURE' });
      }
      return respond(response, 202, { accepted: true });
    }
    return respond(response, 404, { code: 'NOT_FOUND' });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Provider fake server failed to bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    submissionCount: () => submissions,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
