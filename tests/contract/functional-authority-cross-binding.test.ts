import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../tools/native-runtime-companion/companion.mjs';
import { verifyAuthorityGraph } from '../../tools/functional-acceptance/verify-authority-graph.mjs';

const repositoryRoot = resolve(dirname(import.meta.filename), '../..');
const authorityRelativeRoot = 'compliance/functional-acceptance/2026-09-05';
const authorityV2RelativePath = `${authorityRelativeRoot}/FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V2.json`;
const windowsV2RelativePath = `${authorityRelativeRoot}/WINDOWS_LOW_END_PROFILES_V2.json`;

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function writeSelfHashedJson(
  root: string,
  relativePath: string,
  field: string,
  override?: Record<string, unknown>,
) {
  const path = resolve(root, relativePath);
  const document = override ?? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>);
  const withoutSelf = { ...document };
  delete withoutSelf[field];
  document[field] = sha256(JSON.stringify(canonicalJson(withoutSelf)));
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(path, bytes);
  writeFileSync(
    path.replace(/\.json$/u, '.sha256'),
    `${sha256(bytes)}  ${relativePath.split('/').at(-1)}\n`,
  );
}

function withFixture<T>(callback: (root: string) => T): T {
  const root = mkdtempSync(join('/tmp', 'functional-authority-'));
  mkdirSync(resolve(root, 'compliance'), { recursive: true });
  cpSync(resolve(repositoryRoot, 'compliance'), resolve(root, 'compliance'), { recursive: true });
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function mutateAuthorityV2(root: string, mutate: (document: Record<string, unknown>) => void) {
  const path = resolve(root, authorityV2RelativePath);
  const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  mutate(document);
  writeSelfHashedJson(root, authorityV2RelativePath, 'record_sha256', document);
}

describe('functional acceptance authority cross-binding gate', () => {
  it('passes the complete active v2 graph', () => {
    const result = verifyAuthorityGraph();
    expect(result.selfHashGate).toBe('PASS');
    expect(result.crossRecordBindingGate).toBe('PASS');
    expect(result.graphRegression).toBe('PASS');
    expect(result.unresolvedCrossBindingCount).toBe(0);
    expect(result.conflictingCrossBindingCount).toBe(0);
    expect(result.activeAuthorityReferenceToSupersededV1Count).toBe(0);
  });

  it('fails when the category Golden threshold diverges from the protocol', () => {
    withFixture((root) => {
      mutateAuthorityV2(root, (document) => {
        const references = document.references as Record<string, Record<string, unknown>>;
        references.golden_retrieval_protocol.threshold_sha256 =
          '01eb1790ac4fe3fea0a1533ff0952a197edb9783ee9d54ca2d365673d3440f42';
      });
      expect(() => verifyAuthorityGraph(root)).toThrow(/golden\.category_threshold_to_protocol/u);
    });
  });

  it('fails when the Golden protocol raw-file binding is stale', () => {
    withFixture((root) => {
      mutateAuthorityV2(root, (document) => {
        const references = document.references as Record<string, Record<string, unknown>>;
        references.golden_retrieval_protocol.raw_file_sha256 =
          'e8a1b201c674c5f7c3f064f994cf65ff004744f655d693132d8b549c46cbdb15';
      });
      expect(() => verifyAuthorityGraph(root)).toThrow(/golden\.protocol_raw_to_sidecar/u);
    });
  });

  it('fails when an active graph reference points to superseded v1', () => {
    withFixture((root) => {
      mutateAuthorityV2(root, (document) => {
        const references = document.references as Record<string, unknown>;
        references.invalid_active_reference =
          'code-f-final-functional-acceptance-authority-set-20260905-v1';
      });
      expect(() => verifyAuthorityGraph(root)).toThrow(/superseded\.v1_not_in_active_graph/u);
    });
  });

  it('fails when Windows child profile subjects are not uniquely identifiable', () => {
    withFixture((root) => {
      const path = resolve(root, windowsV2RelativePath);
      const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const profiles = document.profiles as Record<string, Record<string, unknown>>;
      profiles.WINDOWS_4C_16GB_PROFILE.profile_id = profiles.WINDOWS_4C_8GB_PROFILE.profile_id;
      writeSelfHashedJson(root, windowsV2RelativePath, 'record_sha256', document);
      expect(() => verifyAuthorityGraph(root)).toThrow(/duplicate profile id/u);
    });
  });
});
