import { spawnSync } from 'node:child_process';
import { verifyImmutableEvidence } from './verify-immutable-evidence-allowlist.mjs';

try {
  const result = await verifyImmutableEvidence();
  console.log(`immutable-evidence-allowlist: PASS (${result.entries.size} exact entries)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  process.exit();
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpm, ['exec', 'prettier', '--check', '.'], {
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
