import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const desktopManifest = join(repositoryRoot, 'apps/desktop/package.json');
const contractsManifest = join(repositoryRoot, 'packages/contracts/package.json');
const requireFromDesktop = createRequire(desktopManifest);

describe('@app/contracts workspace package boundary', () => {
  it('resolves the runtime entry by package name from the Desktop consumer', async () => {
    const runtimeEntry = requireFromDesktop.resolve('@app/contracts');
    const relativeEntry = relative(repositoryRoot, runtimeEntry).split(sep).join('/');

    expect(relativeEntry).toBe('packages/contracts/dist/index.js');
    expect(relativeEntry).not.toContain('/src/');

    const contracts = (await import(pathToFileURL(runtimeEntry).href)) as Record<string, unknown>;
    expect(contracts.SCHEMA_VERSION_V1).toBe('1.0');
    expect(contracts.SIDECAR_PROTOCOL_VERSION_V1).toBe('1.0');
  });

  it('declares runtime and type entries that exist after the package build', () => {
    const manifest = JSON.parse(readFileSync(contractsManifest, 'utf8')) as {
      main: string;
      types: string;
      exports: { '.': { default: string; import: string; types: string } };
    };
    const packageRoot = dirname(contractsManifest);

    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.types).toBe('./dist/index.d.ts');
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    });
    expect(() => readFileSync(join(packageRoot, manifest.main))).not.toThrow();
    expect(() => readFileSync(join(packageRoot, manifest.types))).not.toThrow();
  });
});
