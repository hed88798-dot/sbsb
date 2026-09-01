import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifier = resolve(
  repositoryRoot,
  'tools/code-c-python-supply-chain/verify_inventory_review_regressions.py',
);

describe('Code C Python Inventory-only review preparation', () => {
  it('keeps approval role-scoped, current-HEAD-bound, and artifact-contained', () => {
    const result = spawnSync(process.env.PYTHON_EXECUTABLE || 'python3', [verifier], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      ACTUAL_TEST_ASSERTIONS_EXECUTED: 'YES',
      ASSERTION_COUNT: 7,
      BATCH_CONTAINER_ONLY: 'PASS',
      CROSS_HEAD_MISMATCH_FAIL_CLOSED: 'PASS',
      FOUR_ROLE_SCOPED_APPROVALS: 'PASS',
      INVENTORY_ONLY_ARTIFACT_BUDGET: 'PASS',
      NO_CODE_C_SELF_APPROVAL: 'PASS',
      UNSAFE_ARCHIVE_MEMBER_FAIL_CLOSED: 'PASS',
    });
  });
});
