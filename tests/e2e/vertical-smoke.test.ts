import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockGateway, type MockGatewayHandle } from '../../apps/gateway/src/index.js';
import {
  CopywritingRepository,
  JobRepository,
  ProductRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import { HttpTextCapabilityClient } from '../../packages/provider-client/src/index.js';
import { CopywritingService } from '../../apps/desktop/src/main/copywriting-service.js';
import { callMockSidecar } from '../../apps/desktop/src/main/sidecar-client.js';
import { resolveMockSidecarScript, resolvePythonExecutable } from '../helpers/python-runtime.js';

let gateway: MockGatewayHandle;

beforeAll(async () => {
  gateway = await startMockGateway();
});

afterAll(async () => {
  await gateway.close();
});

describe('Desktop vertical smoke', () => {
  it('runs DB -> Product -> sidecar -> Gateway -> Job -> Script', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-vertical-'));
    const { db } = await openDatabase({
      dbPath: join(directory, 'app.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    });
    const products = new ProductRepository(db);
    const jobs = new JobRepository(db);
    const copywriting = new CopywritingRepository(db);
    const product = products.create({
      name: '合成底座产品',
      aliases: ['底座样例'],
      category: '合成测试',
      target_object: '猪',
      ingredients: '合成成分10%',
      specification: '100g/袋',
      approved_scope: '仅用于合成测试',
      usage: '每次10g',
      contraindications: ['妊娠期禁用'],
      selling_points: ['事实清晰'],
      description: '不对应任何真实商品',
      marketing_focus: '垂直链路',
      forbidden_claims: ['保证治愈'],
      notes: '',
      industry_metadata: { synthetic: true },
    });

    const sidecarEvents = await callMockSidecar({
      pythonPath: resolvePythonExecutable(),
      scriptPath: resolveMockSidecarScript(),
      request: {
        type: 'request',
        protocol_version: '1.0',
        request_id: 'vertical_sidecar',
        method: 'ping',
        payload: {},
      },
    });
    expect(sidecarEvents.at(-1)?.payload).toEqual({ pong: true });

    const service = new CopywritingService({
      products,
      jobs,
      copywriting,
      client: new HttpTextCapabilityClient({ backendUrl: gateway.url }),
    });
    const job = service.enqueue({
      schema_version: '1.0',
      request_id: 'vertical_copywriting',
      mode: 'PRODUCT',
      product_id: product.product_id,
      direction: '产品介绍',
      target_duration_seconds: 30,
      style: '专业清晰',
      colloquial_level: 1,
      requirements: '合成 smoke',
    });
    expect(job.state).toBe('QUEUED');
    for (let index = 0; index < 100; index += 1) {
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(jobs.require(job.job_id).state)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    expect(jobs.require(job.job_id).state).toBe('SUCCEEDED');
    const result = service.getResult(job.job_id);
    expect(result?.result_status).toBe('SUCCEEDED');
    expect(result?.text).toContain('合成底座产品');
    expect(result?.text).toContain('100g/袋');
    expect(result?.fact_conflicts).toEqual([]);
    db.close();
  });
});
