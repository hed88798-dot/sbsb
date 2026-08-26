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
});
