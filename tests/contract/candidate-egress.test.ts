import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '../..');
const egressTool = join(repositoryRoot, 'tools/python-supply-chain/candidate-egress.mjs');
const nodePath = process.execPath;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

describe('candidate egress and local retention', () => {
  it('hashes runner outputs, transfers transiently and freezes one local copy after recovery', () => {
    const directory = mkdtempSync(join(tmpdir(), 'candidate-egress-test-'));
    const worker = join(directory, 'worker');
    const carchive = join(directory, 'worker.carchive');
    const transferManifest = join(directory, 'candidate-transfer-manifest.json');
    const retention = join(directory, 'retention.json');
    const recovery = join(directory, 'recovery.json');
    const localRoot = join(directory, 'frozen-candidates');
    writeFileSync(worker, 'worker bytes\n');
    writeFileSync(carchive, 'carchive bytes\n');
    const execute = (args: string[]) => {
      const result = spawnSync(nodePath, [egressTool, ...args], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        shell: false,
      });
      expect(result.status, result.stderr).toBe(0);
      return result;
    };
    execute([
      'create-transfer-manifest',
      '--candidate-id',
      'candidate-egress-test',
      '--platform',
      'linux',
      '--worker',
      worker,
      '--carchive',
      carchive,
      '--build-recipe-id',
      'recipe-test',
      '--build-recipe-sha256',
      sha256('recipe'),
      '--environment-id',
      'environment-test',
      '--environment-sha256',
      sha256('environment'),
      '--build-context-id',
      'context-test',
      '--build-context-sha256',
      sha256('context'),
      '--output',
      transferManifest,
    ]);
    const manifest = JSON.parse(readFileSync(transferManifest, 'utf8'));
    expect(manifest.transfer_role).toBe('TRANSIENT_ACTIONS_TRANSFER');
    expect(manifest.actions_artifact).toMatchObject({
      retention_days: 1,
      authority_role: 'TRANSPORT_ONLY',
    });
    execute([
      'retain-local',
      '--manifest',
      transferManifest,
      '--worker',
      worker,
      '--carchive',
      carchive,
      '--root',
      localRoot,
      '--output',
      retention,
      '--recovery-output',
      recovery,
    ]);
    const retainedDirectory = join(localRoot, 'candidate-egress-test', 'linux');
    expect(existsSync(join(retainedDirectory, 'manifest.json'))).toBe(true);
    expect(statSync(join(retainedDirectory, 'worker')).size).toBe(statSync(worker).size);
    expect(JSON.parse(readFileSync(retention, 'utf8'))).toMatchObject({
      schema_version: '2',
      storage_channel_class: 'MAC_LOCAL_PROJECT_FOLDER',
      secondary_retention_copy_required: false,
      retention_state: 'FROZEN_CANDIDATE',
      local_copy: {
        storage_locator: 'frozen-candidates/candidate-egress-test/linux/',
        storage_location_identity: 'MAC_LOCAL_PROJECT_FOLDER',
      },
    });
    expect(JSON.parse(readFileSync(recovery, 'utf8'))).toMatchObject({
      schema_version: '2',
      status: 'PASS',
      local_recovery: { status: 'PASS' },
    });
  });

  it('fails closed when a runner output changes after manifest creation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'candidate-egress-mismatch-'));
    const worker = join(directory, 'worker');
    const carchive = join(directory, 'carchive');
    const manifest = join(directory, 'manifest.json');
    writeFileSync(worker, 'original worker');
    writeFileSync(carchive, 'original carchive');
    const result = spawnSync(
      nodePath,
      [
        egressTool,
        'create-transfer-manifest',
        '--candidate-id',
        'candidate-mismatch',
        '--platform',
        'windows',
        '--worker',
        worker,
        '--carchive',
        carchive,
        '--build-recipe-id',
        'recipe-test',
        '--build-recipe-sha256',
        sha256('recipe'),
        '--environment-id',
        'environment-test',
        '--environment-sha256',
        sha256('environment'),
        '--build-context-id',
        'context-test',
        '--build-context-sha256',
        sha256('context'),
        '--output',
        manifest,
      ],
      { cwd: repositoryRoot, encoding: 'utf8', shell: false },
    );
    expect(result.status, result.stderr).toBe(0);
    writeFileSync(worker, 'tampered worker');
    const verify = spawnSync(
      nodePath,
      [
        egressTool,
        'verify-transfer',
        '--manifest',
        manifest,
        '--worker',
        worker,
        '--carchive',
        carchive,
      ],
      { cwd: repositoryRoot, encoding: 'utf8', shell: false },
    );
    expect(verify.status).toBe(1);
    expect(verify.stderr).toContain('SHA-256 mismatch');
  });
});
