import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TextGatewayRequestV1, TextGatewayResultV1 } from '@app/contracts';
import { CopywritingService } from '../../apps/desktop/src/main/copywriting-service.js';
import {
  CopywritingRepository,
  JobRepository,
  ProductRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import {
  GatewayClientError,
  MockTextCapabilityClient,
  type TextCapabilityClient,
} from '../../packages/provider-client/src/index.js';

async function services(client: TextCapabilityClient) {
  const directory = mkdtempSync(join(tmpdir(), 'job-outcome-'));
  const { db } = await openDatabase({
    dbPath: join(directory, 'app.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
  });
  const jobs = new JobRepository(db);
  const service = new CopywritingService({
    products: new ProductRepository(db),
    jobs,
    copywriting: new CopywritingRepository(db),
    client,
  });
  return { db, jobs, service };
}

const request = {
  schema_version: '1.0' as const,
  request_id: 'job_outcome',
  mode: 'CREATE' as const,
  direction: '合成测试',
  target_duration_seconds: 30,
  style: '专业',
  colloquial_level: 1,
  requirements: '',
};

async function settle(jobs: JobRepository, jobId: string) {
  for (let index = 0; index < 100; index += 1) {
    const job = jobs.require(jobId);
    if (!['QUEUED', 'RUNNING'].includes(job.state)) return job;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  return jobs.require(jobId);
}

describe('copywriting job outcomes', () => {
  it.each([
    ['timeout', 'GATEWAY_TIMEOUT'],
    ['429', 'RATE_LIMITED'],
    ['500', 'GATEWAY_UPSTREAM_ERROR'],
  ] as const)('persists %s as FAILED', async (scenario, code) => {
    const context = await services(new MockTextCapabilityClient({ scenario }));
    const job = context.service.enqueue(request);
    expect(await settle(context.jobs, job.job_id)).toMatchObject({
      state: 'FAILED',
      error_code: code,
    });
    context.db.close();
  });

  it('persists user cancellation as CANCELLED', async () => {
    class HangingClient implements TextCapabilityClient {
      generate(
        _request: TextGatewayRequestV1,
        options: { signal?: AbortSignal } = {},
      ): Promise<TextGatewayResultV1> {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(new GatewayClientError('CANCELLED', '任务已取消', false)),
            { once: true },
          );
        });
      }
    }
    const context = await services(new HangingClient());
    const job = context.service.enqueue({ ...request, request_id: 'job_cancel' });
    for (let index = 0; index < 50; index += 1) {
      if (context.jobs.require(job.job_id).state === 'RUNNING') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 2));
    }
    context.service.cancel(job.job_id);
    expect(context.jobs.require(job.job_id).state).toBe('CANCELLED');
    await context.service.shutdown();
    context.db.close();
  });
});
