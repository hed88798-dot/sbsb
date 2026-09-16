import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobRepository, openDatabase } from '../../packages/local-db/src/index.js';

describe('JobRepository recovery', () => {
  it('marks stale RUNNING work as INTERRUPTED', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-job-'));
    const { db } = await openDatabase({
      dbPath: join(directory, 'app.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    });
    const jobs = new JobRepository(db);
    const queued = jobs.create('COPYWRITING', '0'.repeat(64));
    jobs.start(queued.job_id);
    expect(jobs.recoverInterrupted()).toBe(1);
    expect(jobs.require(queued.job_id).state).toBe('INTERRUPTED');
    db.close();
  });

  it('explicitly excludes RENDER ownership from generic recovery', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-job-filter-'));
    const { db } = await openDatabase({
      dbPath: join(directory, 'app.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    });
    const jobs = new JobRepository(db);
    const copywriting = jobs.create('COPYWRITING', '1'.repeat(64));
    const render = jobs.create('RENDER', '2'.repeat(64));
    jobs.start(copywriting.job_id);
    jobs.start(render.job_id);

    expect(jobs.recoverInterruptedNonRenderJobs()).toBe(1);
    expect(jobs.require(copywriting.job_id).state).toBe('INTERRUPTED');
    expect(jobs.require(render.job_id).state).toBe('RUNNING');
    db.close();
  });
});
