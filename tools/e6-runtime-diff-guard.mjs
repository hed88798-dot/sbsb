import { execFileSync } from 'node:child_process';

const E5_FROZEN_BASELINE = 'd227ee2c586ceedc726e6764c52ac749ac87d50b';
const allowedPathPatterns = [
  /^tests\//u,
  /^tools\/e6-runtime-diff-guard\.mjs$/u,
  /^CODE_E_E6_COMPLETION_REPORT\.md$/u,
];

function gitLines(args) {
  const output = execFileSync('git', args, { encoding: 'utf8' }).trim();
  return output.length === 0 ? [] : output.split(/\r?\n/u);
}

const changedPaths = new Set([
  ...gitLines(['diff', '--name-only', E5_FROZEN_BASELINE, '--']),
  ...gitLines(['diff', '--cached', '--name-only', E5_FROZEN_BASELINE, '--']),
  ...gitLines(['ls-files', '--others', '--exclude-standard']),
]);
const forbiddenPaths = [...changedPaths]
  .filter((path) => !allowedPathPatterns.some((pattern) => pattern.test(path)))
  .sort();

if (forbiddenPaths.length > 0) {
  throw new Error(`E6_RUNTIME_DIFF_GUARD_FAILED:\n${forbiddenPaths.join('\n')}`);
}

process.stdout.write(`E6_RUNTIME_DIFF_GUARD: PASS (${changedPaths.size} validation-only paths)\n`);
