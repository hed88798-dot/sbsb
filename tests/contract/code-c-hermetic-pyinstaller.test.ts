import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifier = resolve(
  repositoryRoot,
  'tools/code-c-python-supply-chain/verify_hermetic_pyinstaller_regressions.py',
);
const outputProtocolVerifier = resolve(
  repositoryRoot,
  'tools/code-c-python-supply-chain/verify_machine_output_protocol_regressions.py',
);

describe('Code C hermetic PyInstaller source provenance', () => {
  it('keeps machine stdout to one strict JSON document', () => {
    const result = spawnSync(process.env.PYTHON_EXECUTABLE || 'python3', [outputProtocolVerifier], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      ACTUAL_TEST_ASSERTIONS_EXECUTED: 'YES',
      CHILD_STDERR_CAPTURE_POLICY: 'PASS',
      CHILD_STDOUT_CAPTURE_POLICY: 'PASS',
      CHILD_STDOUT_INHERITANCE: 'NONE',
      CHILD_STDOUT_NOISE_ISOLATED: 'PASS',
      MULTIPLE_JSON_DOCUMENTS_FAIL_CLOSED: 'PASS',
      STDERR_HUMAN_LOGGING: 'PASS',
      STDERR_INCLUDED_IN_EVIDENCE_HASH: 'NO',
      STDERR_LOG_SAFETY_POLICY: 'PASS',
      STDOUT_BOM_FAIL_CLOSED: 'PASS',
      STDOUT_BOM_FORBIDDEN: 'PASS',
      STDOUT_CRLF_FORBIDDEN: 'PASS',
      STDOUT_CRLF_REJECTED: 'PASS',
      STDOUT_EXTRA_WHITESPACE_FAIL_CLOSED: 'PASS',
      STDOUT_JSON_PARSE: 'PASS',
      STDOUT_JSON_PROTOCOL: 'PASS',
      STDOUT_LEADING_WHITESPACE_FORBIDDEN: 'PASS',
      STDOUT_PREFIX_CONTAMINATION_FAIL_CLOSED: 'PASS',
      STDOUT_RAW_BYTE_CONTRACT: 'PASS',
      STDOUT_SUFFIX_CONTAMINATION_FAIL_CLOSED: 'PASS',
      STDOUT_TRAILING_WHITESPACE_FORBIDDEN: 'PASS',
      STDOUT_UTF8: 'PASS',
      UNICODE_OUTPUT_PORTABILITY: 'PASS',
    });
  });

  it('attests Python search roots and rejects ambient source and realpath escapes', () => {
    const result = spawnSync(process.env.PYTHON_EXECUTABLE || 'python3', [verifier], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      APPROVED_ROOT_REPARSE_ESCAPE_REGRESSION: 'PASS',
      ARBITRARY_MISSING_PYTHON_SEARCH_ROOT_FAIL_CLOSED: 'PASS',
      HOSTILE_AMBIENT_PATH_REGRESSION: 'PASS',
      MSVC_RUNTIME_IMPORT_CLOSURE_REGRESSION: 'PASS',
      MISSING_POINTER_FAIL_CLOSED: 'PASS',
      OPTIONAL_CPYTHON_STDLIB_ZIP_ATTESTATION: 'PASS',
      POSITIVE_FIXTURE_ROUNDTRIP: 'PASS',
      SAME_BYTES_UNAPPROVED_SOURCE_FAIL_CLOSED: 'PASS',
      SYNTHETIC_FIXTURE_SCHEMA_PARITY: 'PASS',
      SYNTHETIC_MANIFEST_SCHEMA: 'code-c-pyinstaller-build-environment-v1',
      SYNTHETIC_PYINSTALLER_EVIDENCE: 'PASS',
      WRONG_ARTIFACT_REFERENCE_FAIL_CLOSED: 'PASS',
      WRONG_BUILD_CONTEXT_FAIL_CLOSED: 'PASS',
      WRONG_HASH_FAIL_CLOSED: 'PASS',
      WRONG_USAGE_BINDING_FAIL_CLOSED: 'PASS',
    });
  });
});
