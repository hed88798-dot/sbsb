import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyAssetRevisionArtifact } from '../../packages/domain-media-index/src/index.js';

describe('media index job artifact boundaries', () => {
  it('rejects manifests outside the Main-owned job directory and manifest symlinks', async () => {
    const job = await mkdtemp(join(tmpdir(), '媒体 job '));
    const outside = await mkdtemp(join(tmpdir(), 'media-outside-'));
    try {
      const outsideManifest = join(outside, 'asset-revision-manifest.json');
      writeFileSync(outsideManifest, '{}');
      await expect(
        verifyAssetRevisionArtifact({
          jobOutputDirectory: job,
          result: {
            manifest_path: outsideManifest,
            manifest_sha256: 'a'.repeat(64),
            index_signature_hash: 'b'.repeat(64),
          },
        }),
      ).rejects.toThrow('MEDIA_MANIFEST_PATH_INVALID');
      const linkedManifest = join(job, 'asset-revision-manifest.json');
      symlinkSync(outsideManifest, linkedManifest);
      await expect(
        verifyAssetRevisionArtifact({
          jobOutputDirectory: job,
          result: {
            manifest_path: linkedManifest,
            manifest_sha256: 'a'.repeat(64),
            index_signature_hash: 'b'.repeat(64),
          },
        }),
      ).rejects.toThrow('MEDIA_MANIFEST_PATH_INVALID');
    } finally {
      rmSync(job, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
