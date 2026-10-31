import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as asar from '@electron/asar';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
describe('Wave E4 packaging consumer compatibility', () => {
  it('keeps vulnerable minimatch and retired import/Squirrel consumers out of the resolved graph', () => {
    const root = resolve(import.meta.dirname, '../..');
    const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
    const versions = [...lock.matchAll(/^ {2}minimatch@([^:]+):/gmu)].map((match) => match[1]);
    expect([...new Set(versions)]).toEqual(['11.0.3']);
    expect(lock).not.toMatch(
      /^ {2}(?:eslint-plugin-import(?:-x)?|electron-builder-squirrel-windows|electron-winstaller)@|^ {2}glob@7\./mu,
    );
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).not.toMatch(
      /^ {2}minimatch:/mu,
    );
  });
  it('packs, lists, reads, extracts and preserves file integrity using actual ASAR 4 and CLI', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'e3-asar-'));
    const source = join(directory, 'input');
    mkdirSync(source);
    writeFileSync(join(source, 'fixture.txt'), 'synthetic archive bytes');
    writeFileSync(join(source, 'fixture.node'), 'synthetic native fixture');
    const archive = join(directory, 'fixture.asar');
    await asar.createPackageWithOptions(source, archive, { unpack: '*.node' });
    expect(asar.listPackage(archive)).toContain('/fixture.txt');
    expect(asar.extractFile(archive, 'fixture.txt').toString()).toBe('synthetic archive bytes');
    expect(asar.statFile(archive, 'fixture.node')).toMatchObject({ unpacked: true });
    asar.extractAll(archive, join(directory, 'extracted'));
    expect(readFileSync(join(directory, 'extracted/fixture.txt'), 'utf8')).toBe(
      'synthetic archive bytes',
    );
    const asarRequire = createRequire(require.resolve('@electron/asar'));
    expect(asarRequire('minimatch/package.json').version).toMatch(/^11\./u);
    expect(appBuilderRequire.resolve('@electron/asar')).toBe(require.resolve('@electron/asar'));
    const cli = resolve(dirname(require.resolve('@electron/asar')), '../bin/asar.mjs');
    execFileSync(process.execPath, [cli, 'pack', source, join(directory, 'cli.asar')]);
    expect(
      execFileSync(process.execPath, [cli, 'list', join(directory, 'cli.asar')], {
        encoding: 'utf8',
      }),
    ).toContain('fixture.txt');
    execFileSync(process.execPath, [
      cli,
      'extract',
      join(directory, 'cli.asar'),
      join(directory, 'cli-extract'),
    ]);
    expect(readFileSync(join(directory, 'cli-extract/fixture.txt'), 'utf8')).toBe(
      'synthetic archive bytes',
    );
  });

  it.skipIf(process.platform === 'win32')('preserves ASAR relative symlink reads', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'e3-asar-link-'));
    mkdirSync(join(directory, 'input'));
    writeFileSync(join(directory, 'input/target.txt'), 'link target');
    symlinkSync('target.txt', join(directory, 'input/link.txt'));
    await asar.createPackage(join(directory, 'input'), join(directory, 'link.asar'));
    expect(asar.extractFile(join(directory, 'link.asar'), 'link.txt').toString()).toBe(
      'link target',
    );
  });

  it('retires the unused Squirrel peer and retains filelist match compatibility', () => {
    expect(() => appBuilderRequire.resolve('electron-builder-squirrel-windows')).toThrow();
    const directory = mkdtempSync(join(tmpdir(), 'e3-glob-'));
    mkdirSync(join(directory, 'nested'));
    writeFileSync(join(directory, 'nested/a.txt'), 'a');
    writeFileSync(join(directory, 'nested/b.js'), 'b');
    const ejs = createRequire(appBuilderRequire.resolve('ejs'));
    const jake = createRequire(ejs.resolve('jake'));
    const filelist = jake('filelist');
    const list = new filelist.FileList();
    list.include(join(directory, 'nested/*.txt'));
    expect(list.toArray()).toEqual([join(directory, 'nested/a.txt')]);
  });
});
