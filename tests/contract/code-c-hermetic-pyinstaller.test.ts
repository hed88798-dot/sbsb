import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifier = resolve(
  repositoryRoot,
  'tools/code-c-python-supply-chain/verify_hermetic_pyinstaller_regressions.py',
);

describe('Code C hermetic PyInstaller source provenance', () => {
  it('attests Python search roots and rejects ambient source and realpath escapes', () => {
    const result = spawnSync(process.env.PYTHON_EXECUTABLE || 'python3', [verifier], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      APPROVED_ROOT_REPARSE_ESCAPE_REGRESSION: 'PASS',
      ARBITRARY_MISSING_PYTHON_SEARCH_ROOT_FAIL_CLOSED: 'PASS',
      HOSTILE_AMBIENT_PATH_REGRESSION: 'PASS',
      OPTIONAL_CPYTHON_STDLIB_ZIP_ATTESTATION: 'PASS',
      SAME_BYTES_UNAPPROVED_SOURCE_FAIL_CLOSED: 'PASS',
    });
  });
});
