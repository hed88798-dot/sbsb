import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { openDatabase, TimelinePlanRepository } from '../../packages/local-db/dist/index.js';
import { commitDemoTimeline } from './timeline.mjs';

test('fresh database cannot commit a timeline before explicit confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-render-authority-'));
  const { db } = await openDatabase({
    dbPath: join(directory, 'app.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
  });
  try {
    await assert.rejects(
      commitDemoTimeline({
        database: db,
        shot_plan_id: 'unconfirmed',
        shot_plan_version: 1,
        timing_snapshot: {},
        selection_request_ids: [],
      }),
      /DEMO_CONFIRMED_PLAN_REQUIRED/,
    );
    assert.deepEqual(new TimelinePlanRepository(db).listLatestCommitted(), []);
  } finally {
    db.close();
  }
});
