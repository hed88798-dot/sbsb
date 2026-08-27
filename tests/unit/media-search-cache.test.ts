import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSearchCache,
  encodeNormalizedVector,
  verifySearchCache,
} from '../../packages/domain-media-index/src/index.js';

describe('search cache consistency', () => {
  it('rebuilds from truth and rejects signature and row mapping mismatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'search-cache-'));
    try {
      const rows = [
        {
          shotId: 'shot_a',
          assetId: 'asset_a',
          revision: 1,
          startMs: 0,
          endMs: 1000,
          vectorF16: encodeNormalizedVector([1, 0, 0, 0]),
        },
        {
          shotId: 'shot_b',
          assetId: 'asset_b',
          revision: 2,
          startMs: 1000,
          endMs: 2000,
          vectorF16: encodeNormalizedVector([0, 1, 0, 0]),
        },
      ];
      await buildSearchCache({
        cacheRoot: root,
        generationId: 'generation_1',
        signatureHash: 'a'.repeat(64),
        dimension: 4,
        rows,
      });
      const verified = await verifySearchCache({
        cacheRoot: root,
        expectedSignatureHash: 'a'.repeat(64),
      });
      expect(verified.rows.map((row) => row.shot_id)).toEqual(['shot_a', 'shot_b']);
      await expect(
        verifySearchCache({ cacheRoot: root, expectedSignatureHash: 'b'.repeat(64) }),
      ).rejects.toThrow('CACHE_SIGNATURE_MISMATCH');
      const rowPath = join(root, 'generation_1', 'rows.json');
      const manifestPath = join(root, 'generation_1', 'manifest.json');
      const rowDocument = JSON.parse(readFileSync(rowPath, 'utf8')) as { rows: unknown[] };
      rowDocument.rows.pop();
      const tamperedRows = JSON.stringify(rowDocument);
      writeFileSync(rowPath, tamperedRows);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        row_map_sha256: string;
      };
      manifest.row_map_sha256 = createHash('sha256').update(tamperedRows).digest('hex');
      writeFileSync(manifestPath, JSON.stringify(manifest));
      await expect(
        verifySearchCache({ cacheRoot: root, expectedSignatureHash: 'a'.repeat(64) }),
      ).rejects.toThrow('CACHE_ROW_MAPPING_MISMATCH');
      writeFileSync(join(root, 'generation_1', 'matrix.f16'), Buffer.alloc(2));
      await expect(
        verifySearchCache({ cacheRoot: root, expectedSignatureHash: 'a'.repeat(64) }),
      ).rejects.toThrow('CACHE_MATRIX_HASH_MISMATCH');
      rmSync(join(root, 'generation_1'), { recursive: true, force: true });
      await buildSearchCache({
        cacheRoot: root,
        generationId: 'generation_2',
        signatureHash: 'a'.repeat(64),
        dimension: 4,
        rows,
      });
      expect(
        (await verifySearchCache({ cacheRoot: root, expectedSignatureHash: 'a'.repeat(64) })).rows,
      ).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
