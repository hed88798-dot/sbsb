import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkSourceCycles } from '../../tools/source-cycle-check.mjs';

const oracle = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../fixtures/source-cycle-oracle.json'), 'utf8'),
) as Array<{
  id: string;
  old_result: string;
  new_expected: string;
  change: string;
  compilerOptions: object;
  files: Record<string, string>;
}>;
function fixture(files: Record<string, string>, compilerOptions: object = {}) {
  const root = mkdtempSync(join(tmpdir(), 'source-cycle-policy-'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        jsx: 'react-jsx',
        ...compilerOptions,
      },
      include: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    }),
  );
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

describe('SOURCE_RUNTIME_CYCLE_POLICY_V1', () => {
  it('retains the 12 historical results and identifies seven approved policy strengthenings', () => {
    expect(oracle).toHaveLength(12);
    expect(oracle.filter((row) => row.change === 'INTENTIONAL_POLICY_STRENGTHENING')).toHaveLength(
      7,
    );
    expect(oracle.filter((row) => row.old_result === row.new_expected)).toHaveLength(5);
  });
  it.each(oracle)('$id obeys the approved policy, not historical resolver misses', (row) => {
    const result = checkSourceCycles({ root: fixture(row.files, row.compilerOptions) });
    expect(result.cycles.length ? 'FAIL' : 'PASS').toBe(row.new_expected);
  });
  it('ignores type-only re-exports and type-only edges that break an apparent cycle', () => {
    const root = fixture({
      'a.ts': "export type { B } from './b.js';",
      'b.ts': "import { c } from './c.js'; export type B = string; export const b = c;",
      'c.ts': "export * from './a.js'; export const c = 1;",
    });
    expect(checkSourceCycles({ root }).cycles).toEqual([]);
  });
  it.each([
    ['ts', '.js'],
    ['tsx', '.js'],
    ['mts', '.mjs'],
    ['cts', '.cjs'],
  ])('resolves %s source through emitted extension %s', (extension, emitted) => {
    const root = fixture({
      ['a.' + extension]: `export * from './b${emitted}';`,
      ['b.' + extension]: `export * from './a${emitted}';`,
    });
    expect(checkSourceCycles({ root }).cycles).toHaveLength(1);
  });
  it('uses compiler-derived workspace output bindings even before a package build', () => {
    const root = fixture({
      'packages/a/src/index.ts': "export * from '@fixture/b';",
      'packages/b/src/index.ts': "export * from '@fixture/a';",
    });
    for (const name of ['a', 'b']) {
      const packageRoot = join(root, 'packages', name);
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          name: '@fixture/' + name,
          type: 'module',
          exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        }),
      );
      mkdirSync(join(root, 'node_modules/@fixture'), { recursive: true });
      symlinkSync(packageRoot, join(root, 'node_modules/@fixture', name), 'junction');
      writeFileSync(
        join(packageRoot, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            rootDir: 'src',
            outDir: 'dist',
            declaration: true,
          },
          include: ['src/**/*.ts'],
        }),
      );
    }
    // Paths points at package exports' declaration entry, exactly as workspace resolution does.
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          baseUrl: '.',
          paths: {
            '@fixture/a': ['packages/a/dist/index.d.ts'],
            '@fixture/b': ['packages/b/dist/index.d.ts'],
          },
        },
        include: ['packages/**/*.ts'],
      }),
    );
    expect(checkSourceCycles({ root }).cycles).toHaveLength(1);
  });
  it('does not guess unresolved external imports or scan generated output', () => {
    const root = fixture({
      'a.ts': "import 'not-installed-external'; export const a=1;",
      'dist/b.ts': "export * from './c.js';",
      'dist/c.ts': "export * from './b.js';",
    });
    expect(checkSourceCycles({ root }).cycles).toEqual([]);
  });
  it('prints deterministic compact cycle evidence and fails the CLI', () => {
    const root = fixture(oracle[0]!.files);
    const tool = resolve(import.meta.dirname, '../../tools/source-cycle-check.mjs');
    const first = spawnSync(process.execPath, [tool, '--root', root], { encoding: 'utf8' });
    const second = spawnSync(process.execPath, [tool, '--root', root], { encoding: 'utf8' });
    expect(first.status).toBe(1);
    expect(first.stderr).toBe(second.stderr);
    expect(first.stderr).toContain('SOURCE_RUNTIME_CYCLE:\na.ts\n→ b.ts\n→ a.ts');
    const scripts = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
    ).scripts;
    expect(scripts.lint).toContain('node tools/source-cycle-check.mjs');
    expect(
      execFileSync(process.execPath, [tool, '--root', fixture({ 'a.ts': 'export const a=1;' })], {
        encoding: 'utf8',
      }),
    ).toContain('PASS');
  });
});
