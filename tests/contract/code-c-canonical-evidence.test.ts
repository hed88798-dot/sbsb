import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalJsonBytes,
  canonicalizationVersion,
  writeCanonicalJson,
} from '../../tools/code-c-python-supply-chain/canonical-evidence.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifier = resolve(
  repositoryRoot,
  'tools/code-c-python-supply-chain/verify_canonical_evidence.py',
);
const goldenValue = {
  z_empty_object: {},
  path: 'directory with spaces/证据-é.json',
  empty_array: [],
  nested: { 中文: '跨平台', alpha: 'évidence' },
};
const expectedCanonicalBytes = Buffer.from(
  '{\n' +
    '  "empty_array": [],\n' +
    '  "nested": {\n' +
    '    "alpha": "évidence",\n' +
    '    "中文": "跨平台"\n' +
    '  },\n' +
    '  "path": "directory with spaces/证据-é.json",\n' +
    '  "z_empty_object": {}\n' +
    '}\n',
  'utf8',
);
const expectedCanonicalSha256 = 'fbd6ddd4a49c96d78d365f69b1ea3218ffeb7a9a4756345e93b4678f97a40f54';

describe('Code C canonical evidence bytes', () => {
  it('pins the canonical golden bytes and SHA-256 in Node', () => {
    const actual = canonicalJsonBytes(goldenValue);
    expect(canonicalizationVersion).toBe('json-utf8-lf-v1');
    expect(actual).toEqual(expectedCanonicalBytes);
    expect(createHash('sha256').update(actual).digest('hex')).toBe(expectedCanonicalSha256);
    expect(actual.includes(Buffer.from('\r\n'))).toBe(false);
    expect(actual.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  });

  it('keeps Python and Node canonical bytes identical and fails closed for CRLF tampering', () => {
    const python = process.env.PYTHON_EXECUTABLE || 'python3';
    const result = spawnSync(python, [verifier], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const report = JSON.parse(result.stdout.trim());
    expect(Buffer.from(report.canonical_bytes_base64, 'base64')).toEqual(expectedCanonicalBytes);
    expect(report.canonical_payload_sha256).toBe(expectedCanonicalSha256);
    expect(report.canonical_file_sha256).toBe(expectedCanonicalSha256);
    expect(report).toMatchObject({
      canonical_payload_file_hash_equal: true,
      in_memory_file_byte_identity: true,
      temp_file_same_directory: true,
      atomic_replace: true,
      crlf_tamper_fail_closed: true,
      unicode_canonical_hash_portability: true,
      path_with_spaces_regression: true,
      canonical_golden_vector: true,
    });
  });

  it('publishes Node canonical evidence through the same-directory atomic path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'code c canonical node '));
    const output = join(directory, 'path with spaces', '证据.json');
    try {
      const first = writeCanonicalJson(output, goldenValue);
      const replacement = writeCanonicalJson(output, goldenValue);
      expect(readFileSync(output)).toEqual(expectedCanonicalBytes);
      expect(first).toMatchObject({
        canonical_payload_sha256: expectedCanonicalSha256,
        canonical_file_sha256: expectedCanonicalSha256,
        canonical_payload_file_hash_equal: true,
        in_memory_file_byte_identity: true,
        temp_file_same_directory: true,
        atomic_replace: true,
      });
      expect(replacement).toEqual(first);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps every named hash-bound Code C writer on the exact-byte helper', () => {
    const files = [
      'approve_candidates.py',
      'approve_toolchain.py',
      'capture_pyinstaller_build_evidence.py',
      'capture_target_evidence.py',
      'collect_stage_b_static_evidence.py',
      'create_stage_b_evidence_bundle.py',
      'prepare_pyinstaller_build_context.py',
      'prepare_pyinstaller_environment.py',
      'prepackage_selected_source_gate.py',
      'run_stage_b_candidate_negative.py',
    ];
    for (const name of files) {
      const source = readFileSync(
        resolve(repositoryRoot, 'tools/code-c-python-supply-chain', name),
        'utf8',
      );
      expect(source, name).toContain('write_canonical_json');
      expect(source, name).not.toMatch(/\.write_text\(canonical_(?:json|pretty)/u);
    }
    for (const name of ['prepare_license_target.mjs', 'create_license_review_bundle.mjs']) {
      const source = readFileSync(
        resolve(repositoryRoot, 'tools/code-c-python-supply-chain', name),
        'utf8',
      );
      expect(source, name).toMatch(/\bwrite(?:Canonical|Prettier)Json\b/u);
      expect(source, name).not.toMatch(/writeFileSync\([^\n]+, canonicalJson/u);
    }
  });
});
