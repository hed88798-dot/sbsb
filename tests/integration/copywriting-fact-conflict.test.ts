import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CopywritingService } from '../../apps/desktop/src/main/copywriting-service.js';
import {
  CopywritingRepository,
  JobRepository,
  ProductRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import { MockTextCapabilityClient } from '../../packages/provider-client/src/index.js';

describe('Copywriting Fact Conflict persistence', () => {
  it('stores raw output and returns REVIEW_REQUIRED instead of silently succeeding', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'copywriting-conflict-'));
    const { db } = await openDatabase({
      dbPath: join(directory, 'app.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    });
    const products = new ProductRepository(db);
    const jobs = new JobRepository(db);
    const copywriting = new CopywritingRepository(db);
    const product = products.create({
      name: '合成事实产品',
      aliases: [],
      category: '',
      target_object: '猪',
      ingredients: '合成成分10%',
      specification: '100g/袋',
      approved_scope: '合成批准范围',
      usage: '每次10g',
      contraindications: ['合成禁忌'],
      selling_points: [],
      description: '',
      marketing_focus: '',
      forbidden_claims: [],
      notes: '',
      industry_metadata: { synthetic: true },
    });
    const rawOutput = '合成事实产品，规格：500g/袋，适用于鸡，本品没有任何禁忌。';
    const service = new CopywritingService({
      products,
      jobs,
      copywriting,
      client: new MockTextCapabilityClient({ text: rawOutput }),
    });
    const job = service.enqueue({
      schema_version: '1.0',
      request_id: 'fact_conflict_request',
      mode: 'PRODUCT',
      product_id: product.product_id,
      direction: '产品介绍',
      target_duration_seconds: 30,
      style: '专业',
      colloquial_level: 1,
      requirements: '',
    });
    for (let index = 0; index < 100; index += 1) {
      if (jobs.require(job.job_id).state === 'SUCCEEDED') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
    const result = service.getResult(job.job_id);
    expect(jobs.require(job.job_id).state).toBe('SUCCEEDED');
    expect(result?.result_status).toBe('REVIEW_REQUIRED');
    expect(result?.raw_model_output).toBe(rawOutput);
    expect(result?.fact_snapshot?.specification).toBe('100g/袋');
    expect(result?.fact_conflicts.map((conflict) => conflict.field)).toEqual(
      expect.arrayContaining(['specification', 'target_object', 'contraindications']),
    );
    db.close();
  });
});
