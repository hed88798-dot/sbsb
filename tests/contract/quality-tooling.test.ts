import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const secretScanner = join(repositoryRoot, 'tools/secret-scan.mjs');
const goldenValidator = join(repositoryRoot, 'tools/golden/validate-manifest.mjs');
const goldenManifest = join(
  repositoryRoot,
  'tests/golden/manifests/product-fact-synthetic.v1.json',
);

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
    const before = readFileSync(goldenManifest);
    const result = spawnSync(process.execPath, [goldenValidator], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('golden-verify: PASS');
    expect(readFileSync(goldenManifest)).toEqual(before);
  });

  it('forces canonical LF checkouts for every locked text target', () => {
    const result = spawnSync(
      'git',
      [
        'check-attr',
        'eol',
        '--',
        'packages/test-fixtures/src/index.ts',
        'tests/golden/product-fact-regression.test.ts',
      ],
      { cwd: repositoryRoot, encoding: 'utf8', shell: false },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('packages/test-fixtures/src/index.ts: eol: lf');
    expect(result.stdout).toContain('tests/golden/product-fact-regression.test.ts: eol: lf');
  });

  it('rejects CRLF drift instead of normalizing or refreshing the manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'golden-crlf-regression-'));
    try {
      mkdirSync(join(directory, 'fixtures'), { recursive: true });
      mkdirSync(join(directory, 'tests/golden/manifests'), { recursive: true });
      const canonical = Buffer.from('approved\n', 'utf8');
      writeFileSync(join(directory, 'fixtures/locked.txt'), 'approved\r\n', 'utf8');
      writeFileSync(
        join(directory, 'tests/golden/manifests/test.json'),
        `${JSON.stringify(
          {
            schema_version: '1.0',
            dataset_id: 'crlf-regression',
            dataset_version: '1.0.0',
            authorization: { status: 'SYNTHETIC' },
            provenance: { source_type: 'SYNTHETIC', contains_customer_data: false },
            splits: [{ name: 'test', locked: true, anonymous_ids: ['fixture-001'] }],
            integrity: {
              algorithm: 'SHA-256',
              files: [
                {
                  path: 'fixtures/locked.txt',
                  canonicalization: 'UTF8_LF',
                  sha256: createHash('sha256').update(canonical).digest('hex'),
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      const result = spawnSync(process.execPath, [goldenValidator, '--root', directory], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        shell: false,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('UTF8_LF forbids CRLF/CR line endings');
      const manifest = readFileSync(join(directory, 'tests/golden/manifests/test.json'), 'utf8');
      expect(manifest).toContain(createHash('sha256').update(canonical).digest('hex'));
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('never invokes golden:update from a GitHub Actions workflow', () => {
    const workflowDirectory = join(repositoryRoot, '.github/workflows');
    const workflowText = readdirSync(workflowDirectory)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .map((name) => readFileSync(join(workflowDirectory, name), 'utf8'))
      .join('\n');
    expect(workflowText).toContain('golden:verify');
    expect(workflowText).not.toContain('golden:update');
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
