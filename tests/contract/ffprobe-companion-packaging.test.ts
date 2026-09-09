import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyCompanionBundle } from '../../tools/native-runtime-companion/companion.mjs';

const root = resolve(import.meta.dirname, '../..');
const profile = resolve(
  root,
  'compliance/runtime-dependency-intake/ffprobe-v2/FFPROBE_BUILD_PROFILE_V1.json',
);
const loaderPolicy = resolve(
  root,
  'compliance/runtime-dependency-intake/native-runtime-companion-v1/RUNTIME_LOADER_POLICY_RECORD_V1.json',
);

describe('FFprobe companion packaging', () => {
  it('keeps the authority manifest at package root, outside the runtime bundle', () => {
    const work = mkdtempSync(join(tmpdir(), 'ffprobe-companion-packaging-'));
    try {
      const bundle = join(work, 'bundle');
      const records = join(work, 'records');
      const output = join(work, 'manifest.json');
      const runtimeDeps = join(work, 'runtime-deps.json');
      const license = join(work, 'license.json');
      mkdirSync(bundle, { recursive: true });
      writeFileSync(join(bundle, 'ffprobe'), 'fixture-entrypoint\n');
      writeFileSync(runtimeDeps, JSON.stringify({ internal: [] }));
      writeFileSync(license, JSON.stringify({ evidence_id: 'fixture-license' }));

      const sourceSha = 'f'.repeat(64);
      const commit = 'a'.repeat(40);
      execFileSync(
        process.execPath,
        [
          'tools/ffprobe-build/create_records.mjs',
          '--platform',
          'linux',
          '--architecture',
          'x86_64',
          '--output',
          records,
          '--profile',
          profile,
          '--loader-policy',
          loaderPolicy,
          '--source-sha256',
          sourceSha,
          '--source-archive',
          'ffmpeg-9.0.1.tar.xz',
          '--compiler',
          'fixture-gcc',
          '--toolchain',
          'fixture-toolchain',
          '--build-json',
          '[]',
          '--run-id',
          'packaging-test',
          '--commit',
          commit,
        ],
        { cwd: root, stdio: 'ignore' },
      );
      execFileSync(
        process.execPath,
        [
          'tools/ffprobe-build/assemble_manifest.mjs',
          '--bundle',
          bundle,
          '--records',
          records,
          '--runtime-deps',
          runtimeDeps,
          '--license',
          license,
          '--platform',
          'linux',
          '--output',
          output,
        ],
        { cwd: root, stdio: 'ignore' },
      );

      expect(existsSync(output)).toBe(true);
      expect(existsSync(join(bundle, 'manifest.json'))).toBe(false);
      const manifest = JSON.parse(readFileSync(output, 'utf8'));
      expect(
        verifyCompanionBundle({
          manifest,
          bundleRoot: bundle,
          expectedSourceBinding: manifest.provenance,
          expectedBuildRecipe: {
            id: manifest.provenance.build_recipe_id,
            sha256: manifest.provenance.build_recipe_sha256,
          },
          expectedEnvironmentDescriptor: {
            id: manifest.provenance.build_environment_descriptor_id,
            sha256: manifest.provenance.build_environment_descriptor_sha256,
          },
          expectedBuildContext: {
            id: manifest.provenance.build_context_id,
            sha256: manifest.provenance.build_context_sha256,
          },
          expectedPlatform: manifest.platform,
        }).status,
      ).toBe('PASS');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
