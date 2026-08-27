import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checkerPath = fileURLToPath(new URL('../../tools/portability-check.mjs', import.meta.url));

function runChecker(root: string) {
  return spawnSync(process.execPath, [checkerPath, root], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

describe('developer-specific absolute path scan', () => {
  it('rejects macOS, Linux, Windows and Codex cache paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'portability regression '));
    try {
      const forwardSlash = '/';
      const backslash = '\\';
      const samples = [
        ['', 'Users', 'developer', 'project'].join(forwardSlash),
        ['', 'home', 'developer', 'project'].join(forwardSlash),
        ['C:', 'Users', 'developer', 'project'].join(backslash),
        [['.', 'cache'].join(''), ['codex', 'runtimes'].join('-'), 'python'].join(forwardSlash),
      ];
      writeFileSync(join(root, 'unsafe.ts'), samples.join('\n'));

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('developer-specific-path: FAIL');
      expect(result.stderr).toContain('developer macOS home');
      expect(result.stderr).toContain('developer Linux home');
      expect(result.stderr).toContain('developer Windows home');
      expect(result.stderr).toContain('Codex runtime cache');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('accepts repository-relative and generic executable names', () => {
    const root = mkdtempSync(join(tmpdir(), 'portability regression '));
    try {
      writeFileSync(join(root, 'safe.ts'), "spawn('python', ['tests/fixtures/mock.py'])");

      const result = runChecker(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('developer-specific-path: PASS');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
