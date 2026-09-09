import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyV3Authority } from '../../tools/functional-acceptance/verify-v3-authority.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function withFixture(callback: (root: string) => void) {
  const root = mkdtempSync(join('/tmp', 'functional-acceptance-v3-'));
  cpSync(resolve(repositoryRoot, 'compliance'), resolve(root, 'compliance'), { recursive: true });
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('V1 functional acceptance V3 authority', () => {
  it('passes exact V3 input/output, UTF-8, supersession and cross-binding gates', () => {
    const result = verifyV3Authority();
    expect(result.activeAuthoritySetSelection).toBe('V3_ONLY');
    expect(result.selfHashGate).toBe('PASS');
    expect(result.rawFileBindingGate).toBe('PASS');
    expect(result.crossRecordBindingGate).toBe('PASS');
    expect(result.v3InputOutputBindingGate).toBe('PASS');
    expect(result.supersessionGate).toBe('PASS');
    expect(result.unresolvedV3InputBindingCount).toBe(0);
    expect(result.unresolvedV3OutputBindingCount).toBe(0);
  });

  it('fails closed when a V3 output byte changes', () => {
    withFixture((root) => {
      const path = resolve(
        root,
        'compliance/functional-acceptance/2026-09-09/v3/evidence/outputs/variant-summary-v3.csv',
      );
      const bytes = readFileSync(path);
      bytes[bytes.length - 3] ^= 1;
      writeFileSync(path, bytes);
      expect(() => verifyV3Authority(root)).toThrow(/evidence SHA-256 mismatch/u);
    });
  });

  it('fails closed when GQ006 automated output no longer matches the manual anchor', () => {
    withFixture((root) => {
      const path = resolve(
        root,
        'compliance/functional-acceptance/2026-09-09/v3/GOLDEN_BENCHMARK_V3_AUTHORITY.json',
      );
      const document = JSON.parse(readFileSync(path, 'utf8')) as {
        gq006_utf8_regression_anchor: {
          manual_exact_search_path: { first_four_asset_ids: string[] };
        };
      };
      document.gq006_utf8_regression_anchor.manual_exact_search_path.first_four_asset_ids[0] =
        'v2_asset_999';
      writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
      expect(() => verifyV3Authority(root)).toThrow(/semantic self-hash mismatch/u);
    });
  });

  it('fails closed when the active selection references a legacy authority', () => {
    withFixture((root) => {
      const path = resolve(
        root,
        'compliance/functional-acceptance/2026-09-09/FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V3.json',
      );
      const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      document.active_authority_set_selection = 'V2_ONLY';
      writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
      expect(() => verifyV3Authority(root)).toThrow(/semantic self-hash mismatch/u);
    });
  });
});
