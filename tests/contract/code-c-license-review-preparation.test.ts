import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const fixtureRoot = join(
  repositoryRoot,
  'tests/fixtures/python-supply-chain/code-c-seven-wheel-license-qicr',
);
const tool = join(
  repositoryRoot,
  'tools/code-c-python-supply-chain/create_license_review_bundle.mjs',
);
const baseline = 'd1348c50e36b725bfcbf9bec17343392cf0412c7';
const temporaryDirectories: string[] = [];

function fixtureTarget(target: 'linux' | 'windows') {
  const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8'));
  return {
    schema_version: '1',
    document_type: 'CODE_C_EXACT_WHEEL_LICENSE_TARGET_EVIDENCE',
    target,
    code_c_head_sha: 'a'.repeat(40),
    main_quality_baseline_sha: baseline,
    graph_id: `fixture-${target}-graph`,
    graph_sha256: target === 'linux' ? 'b'.repeat(64) : 'c'.repeat(64),
    artifact_set_sha256: target === 'linux' ? 'd'.repeat(64) : 'e'.repeat(64),
    inventories: [],
    pyinstaller_worker_build_license: { status: 'PASS' },
    artifacts: manifest.artifacts.map((item: { evidence: string }) => {
      const evidencePath = join(fixtureRoot, item.evidence);
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
      return {
        package: evidence.artifact.package,
        version: evidence.artifact.version,
        filename: evidence.artifact.filename,
        sha256: evidence.artifact.sha256,
        purl: evidence.artifact.purl,
        evidence_path: evidencePath,
        evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
        uses: [
          {
            target,
            scope: 'PRODUCTION_WORKER_RUNTIME',
            inventory_id: `fixture-${target}-runtime`,
            artifact_role: 'RUNTIME_WHEEL',
            distribution_role: 'RUNTIME_DISTRIBUTION',
            dependency_paths: [[evidence.artifact.purl]],
          },
        ],
      };
    }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Code C exact-artifact license review preparation', () => {
  it('classifies all regression evidence exclusively without creating an approval', () => {
    const root = mkdtempSync(join(tmpdir(), 'code-c-license-review-'));
    temporaryDirectories.push(root);
    const input = join(root, 'input');
    const output = join(root, 'output');
    for (const target of ['linux', 'windows'] as const) {
      const directory = join(input, target);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'target-license-evidence.json'),
        `${JSON.stringify(fixtureTarget(target), null, 2)}\n`,
      );
    }
    execFileSync(process.execPath, [tool, '--input-root', input, '--output-root', output], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    const bundle = JSON.parse(
      readFileSync(join(output, 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.json'), 'utf8'),
    );
    expect(bundle.counts).toEqual({
      total_unique_wheel_artifacts: 7,
      auto_approved_by_evidence: 0,
      required_review: 5,
      hard_blocked: 2,
    });
    expect(bundle.required_review_artifacts).toHaveLength(5);
    expect(bundle.required_review_artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          package: 'flatbuffers',
          suggested_spdx_expression: 'Apache-2.0',
          suggestion_status: 'MACHINE_SUGGESTION_NOT_APPROVAL',
          review_status: 'PENDING',
        }),
      ]),
    );
    expect(bundle.hard_blocked_artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ package: 'pyinstaller-hooks-contrib' }),
        expect.objectContaining({ package: 'sentencepiece' }),
      ]),
    );
    expect(bundle).not.toHaveProperty('reviewer');
    expect(bundle.python_license_gate).toBe('FAIL');
    expect(bundle.stage_b).toBe('BLOCKED_NOT_RERUN');
    expect(bundle.regression_fixture_used_as_production_approval).toBe(false);
  });
});
