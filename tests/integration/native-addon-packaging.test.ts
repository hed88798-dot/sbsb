import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function findExecutable(releaseDirectory: string): string | null {
  if (process.platform === 'win32') {
    const directory = join(releaseDirectory, 'win-unpacked');
    if (!existsSync(directory)) return null;
    return (
      readdirSync(directory)
        .filter((name) => name.endsWith('.exe'))
        .map((name) => join(directory, name))[0] ?? null
    );
  }
  if (process.platform === 'darwin') {
    for (const folder of readdirSync(releaseDirectory)) {
      const directory = join(releaseDirectory, folder);
      if (!statSync(directory).isDirectory()) continue;
      for (const appName of readdirSync(directory).filter((name) => name.endsWith('.app'))) {
        const macos = join(directory, appName, 'Contents', 'MacOS');
        if (!existsSync(macos)) continue;
        const executable = readdirSync(macos).map((name) => join(macos, name))[0];
        if (executable) return executable;
      }
    }
  }
  return null;
}

describe('packaged Electron native addon', () => {
  it('launches the packaged runtime and reads/writes SQLite', () => {
    const releaseDirectory = resolve(import.meta.dirname, '../../apps/desktop/release');
    const executable = existsSync(releaseDirectory) ? findExecutable(releaseDirectory) : null;
    if (!executable) {
      if (process.env.REQUIRE_PACKAGED_SMOKE === '1')
        throw new Error('Packaged executable not found');
      return;
    }
    const result = spawnSync(executable, [], {
      env: { ...process.env, DESKTOP_NATIVE_SMOKE: '1' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('NATIVE_SQLITE_SMOKE:PASS');
  });
});
