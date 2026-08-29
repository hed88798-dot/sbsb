import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifier = resolve(
  repositoryRoot,
  'tools/code-c-python-supply-chain/verify_hermetic_pyinstaller_regressions.py',
);

describe('Code C hermetic PyInstaller source provenance', () => {
  it('excludes hostile PATH entries and rejects same-byte and realpath escapes', () => {
    const result = spawnSync(process.env.PYTHON_EXECUTABLE || 'python3', [verifier], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      APPROVED_ROOT_REPARSE_ESCAPE_REGRESSION: 'PASS',
      HOSTILE_AMBIENT_PATH_REGRESSION: 'PASS',
      SAME_BYTES_UNAPPROVED_SOURCE_FAIL_CLOSED: 'PASS',
    });
  });
});
