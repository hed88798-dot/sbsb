import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const secretScanner = join(repositoryRoot, 'tools/secret-scan.mjs');
const goldenValidator = join(repositoryRoot, 'tools/golden/validate-manifest.mjs');

describe('Code F quality tooling', () => {
  it('keeps release metadata tools and schema in the clean checkout', () => {
    expect(existsSync(join(repositoryRoot, 'tools/release/artifact-metadata.mjs'))).toBe(true);
    expect(existsSync(join(repositoryRoot, 'tools/release/verify-artifact-metadata.mjs'))).toBe(
      true,
    );
    expect(
      existsSync(join(repositoryRoot, 'schemas/release/v1/artifact-metadata.schema.json')),
    ).toBe(true);
  });

  it('validates the committed golden manifest and its hashes', () => {
    const result = spawnSync(process.execPath, [goldenValidator], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('golden-manifest: PASS');
  });

  it('fails closed when a required artifact scan target is absent', () => {
    const result = spawnSync(process.execPath, [secretScanner, '--require', 'missing-artifact'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('required scan target is missing');
  });

  it('finds a provider key inside a generated artifact tree', () => {
    const directory = mkdtempSync(join(tmpdir(), 'artifact-secret-scan-'));
    try {
      mkdirSync(join(directory, 'resources'));
      const secret = ['FAL', 'KEY'].join('_');
      const value = ['live', 'provider', 'credential', 'must', 'fail'].join('_');
      writeFileSync(join(directory, 'resources', 'app.js'), `${secret}=${value}`);
      const result = spawnSync(process.execPath, [secretScanner, '--require', directory], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        shell: false,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('provider-key-assignment');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
