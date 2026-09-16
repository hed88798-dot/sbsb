import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobRepository, openDatabase } from '../../packages/local-db/src/index.js';
import { createDesktopRenderCompositionV1 } from '../../apps/desktop/src/main/desktop-render-composition.js';
import { createRuntimeV2AuthorityFixture } from '../helpers/runtime-v2-authority-fixture.js';

async function databaseFixture(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const opened = await openDatabase({
    dbPath: join(directory, 'app.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
  });
  return { directory, ...opened };
}

describe('Desktop Render Main composition', () => {
  it('constructs the accepted Render stack from one explicit Runtime authority', async () => {
    const fixture = await databaseFixture('desktop-render-composition-');
    const runtimeFixture = await createRuntimeV2AuthorityFixture(fixture.directory);
    const requestedLocations: unknown[] = [];
    try {
      const composition = await createDesktopRenderCompositionV1({
        database: fixture.db,
        jobs: new JobRepository(fixture.db),
        userDataPath: fixture.directory,
        runtimeLocation: {
          is_packaged: false,
          controlled_dev_runtime_root: runtimeFixture.runtimeRoot,
        },
        runtimeAuthorityResolver: async (input) => {
          requestedLocations.push(input);
          return runtimeFixture.resolveRuntimeAuthority(runtimeFixture.input);
        },
      });
      expect(composition.available).toBe(true);
      expect(requestedLocations).toEqual([
        { is_packaged: false, controlled_dev_runtime_root: runtimeFixture.runtimeRoot },
      ]);
      expect(composition.staging_root).toBe(join(fixture.directory, 'render', 'staging'));
      expect(composition.output_root).toBe(join(fixture.directory, 'render', 'output'));
      expect(composition.orchestrator.get('missing')).toBeNull();
      expect(composition.timelineHandoff.listTimelineSources()).toEqual([]);
    } finally {
      fixture.db.close();
    }
  });

  it('fails Render closed when packaged Runtime authority is invalid and performs no fallback', async () => {
    const fixture = await databaseFixture('desktop-render-unavailable-');
    const calls: unknown[] = [];
    try {
      const composition = await createDesktopRenderCompositionV1({
        database: fixture.db,
        jobs: new JobRepository(fixture.db),
        userDataPath: fixture.directory,
        runtimeLocation: { is_packaged: true, resources_path: resolve(fixture.directory) },
        runtimeAuthorityResolver: async (input) => {
          calls.push(input);
          throw new Error('PACKAGED_RENDER_RUNTIME_AUTHORITY_INVALID');
        },
      });
      expect(composition.available).toBe(false);
      expect(calls).toHaveLength(1);
      expect(composition.timelineHandoff.listTimelineSources()).toEqual([]);
      await expect(
        composition.orchestrator.prepare({
          schema_version: '1.0',
          timeline_id: 'timeline_1',
          timeline_version: 1,
          expected_timeline_commit_receipt_hash: '1'.repeat(64),
          render_policy_id: 'policy_1',
          render_policy_version: 1,
          render_policy_hash: '2'.repeat(64),
        }),
      ).rejects.toThrowError('RENDER_SUBSYSTEM_UNAVAILABLE');
      expect(() => composition.orchestrator.get('render_job_1')).toThrowError(
        'RENDER_SUBSYSTEM_UNAVAILABLE',
      );
      expect(calls).toHaveLength(1);
    } finally {
      fixture.db.close();
    }
  });
});
