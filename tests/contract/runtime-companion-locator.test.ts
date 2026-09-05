import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FFPROBE_LOCATORS,
  resolveBundledFfprobe,
} from '../../apps/desktop/src/main/runtime-companion.js';

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

describe('explicit runtime companion locator', () => {
  it('resolves only the fixed bundled locator and verifies its bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'runtime-companion '));
    try {
      const bundle = join(root, 'runtime', 'ffprobe', 'linux', 'bundle');
      mkdirSync(bundle, { recursive: true });
      const bytes = Buffer.from('approved-linux-ffprobe');
      writeFileSync(join(bundle, 'ffprobe'), bytes);

      expect(FFPROBE_LOCATORS.linux).toBe('runtime/ffprobe/linux/bundle/ffprobe');
      expect(
        resolveBundledFfprobe({
          resourcesRoot: root,
          platform: 'linux',
          expectedSha256: sha256(bytes),
        }),
      ).toBe(join(bundle, 'ffprobe'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlink, a missing entrypoint, and a byte mismatch', () => {
    const root = mkdtempSync(join(tmpdir(), 'runtime-companion '));
    try {
      const bundle = join(root, 'runtime', 'ffprobe', 'linux', 'bundle');
      mkdirSync(bundle, { recursive: true });
      writeFileSync(join(root, 'decoy-ffprobe'), 'decoy');
      symlinkSync(join(root, 'decoy-ffprobe'), join(bundle, 'ffprobe'));
      expect(() => resolveBundledFfprobe({ resourcesRoot: root, platform: 'linux' })).toThrow(
        'FFPROBE_LOCATOR_MUST_REFERENCE_REGULAR_FILE',
      );

      rmSync(join(bundle, 'ffprobe'));
      expect(() => resolveBundledFfprobe({ resourcesRoot: root, platform: 'linux' })).toThrow();

      writeFileSync(join(bundle, 'ffprobe'), 'actual');
      expect(() =>
        resolveBundledFfprobe({
          resourcesRoot: root,
          platform: 'linux',
          expectedSha256: '0'.repeat(64),
        }),
      ).toThrow('FFPROBE_LOCATOR_SHA256_MISMATCH');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
