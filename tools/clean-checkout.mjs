import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repositoryRoot = process.cwd();
const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const expectedNode = packageManifest.engines.node;
const expectedPnpm = packageManifest.engines.pnpm;
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const temporaryRoot = mkdtempSync(join(tmpdir(), 'ai-video-clean-checkout-'));
const worktree = join(temporaryRoot, 'source with spaces');
const store = join(temporaryRoot, 'isolated-pnpm-store');
const keepOnFailure = process.env.KEEP_CLEAN_CHECKOUT === '1';
let failed = false;

function run(command, args, cwd = repositoryRoot, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

function output(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout.trim();
}

try {
  const actualNode = process.versions.node;
  const actualPnpm = output(pnpmCommand, ['--version']);
  if (actualNode !== expectedNode) {
    throw new Error(`Node version mismatch: expected ${expectedNode}, got ${actualNode}`);
  }
  if (actualPnpm !== expectedPnpm) {
    throw new Error(`pnpm version mismatch: expected ${expectedPnpm}, got ${actualPnpm}`);
  }

  run('git', ['worktree', 'add', '--detach', worktree, 'HEAD']);
  const generatedDirectories = [
    'node_modules',
    'apps/desktop/dist-electron',
    'apps/desktop/dist-renderer',
    'apps/desktop/release',
    'packages/contracts/dist',
  ];
  const leaked = generatedDirectories.filter((path) => existsSync(join(worktree, path)));
  if (leaked.length > 0) {
    throw new Error(`clean checkout contains generated state: ${leaked.join(', ')}`);
  }

  const cleanEnvironment = {
    ...process.env,
    CI: 'true',
    PNPM_HOME: join(temporaryRoot, 'pnpm-home'),
  };
  run(
    pnpmCommand,
    ['install', '--frozen-lockfile', '--store-dir', store],
    worktree,
    cleanEnvironment,
  );
  for (const args of [
    ['ci:prepare'],
    ['package:resolution'],
    ['format:check'],
    ['lint'],
    ['ci:typecheck'],
    ['ci:test'],
    ['dependency:check'],
    ['portability:check'],
    ['workflow:security'],
    ['secret:scan'],
    ['license:scan'],
    ['golden:validate'],
    ['build'],
  ]) {
    run(pnpmCommand, args, worktree, cleanEnvironment);
  }

  const trackedChanges = output('git', ['status', '--porcelain', '--untracked-files=no'], worktree);
  if (trackedChanges) throw new Error(`clean build modified tracked files:\n${trackedChanges}`);
  console.log(`clean-checkout: PASS (${output('git', ['rev-parse', 'HEAD'], worktree)})`);
} catch (error) {
  failed = true;
  console.error(`clean-checkout: FAIL\n${error.message}`);
  process.exitCode = 1;
} finally {
  if (!failed || !keepOnFailure) {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: repositoryRoot,
      stdio: 'ignore',
      shell: false,
    });
    rmSync(temporaryRoot, { force: true, recursive: true });
  } else {
    console.error(`clean-checkout retained for diagnosis: ${temporaryRoot}`);
  }
}
