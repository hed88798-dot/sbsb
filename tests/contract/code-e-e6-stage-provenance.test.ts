import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const frozenCommits = [
  ['E1', 'e1d32dffe88bf727b41a9faecde33a23151cccd3'],
  ['E2', 'e846d159489c86f698403f1a15d572e14fe31968'],
  ['E3', 'c387acf3704fd56bbbcea68f86ee85b9698f7195'],
  ['E4', '0c04ca9534d6ff5c2c6ad338b6d0e64f8ab6c470'],
  ['E3.1', '15c927966f42ee4a2fffb54e4f2ab74b04f1b4b5'],
  ['E5', 'd227ee2c586ceedc726e6764c52ac749ac87d50b'],
  ['E6', 'c9587a46d75aede2919fe354312517394b671d75'],
] as const;

describe('Code E E6 stage provenance', () => {
  it.each(frozenCommits)('%s frozen commit remains an ancestor', (_stage, commit) => {
    expect(() =>
      execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('contains only the original validation-only E5-to-E6 changes', () => {
    const output = execFileSync('node', ['tools/e6-runtime-diff-guard.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toMatch(/^E6_RUNTIME_DIFF_GUARD: PASS/u);
  });

  it('does not let legitimate post-E6 production files invalidate historical provenance', () => {
    const postE6ProductionPath = resolve(
      root,
      `apps/desktop/.e6-post-production-regression-${process.pid}.tmp`,
    );
    writeFileSync(postE6ProductionPath, 'post-E6 production fixture\n', 'utf8');
    try {
      const output = execFileSync('node', ['tools/e6-runtime-diff-guard.mjs'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(output).toMatch(/^E6_RUNTIME_DIFF_GUARD: PASS/u);
    } finally {
      unlinkSync(postE6ProductionPath);
    }
  });
});
