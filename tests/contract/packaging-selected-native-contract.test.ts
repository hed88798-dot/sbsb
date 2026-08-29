import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adaptV2NativeEvidence,
  packagingSelectionEvidenceSha256,
  reconcilePackagingNativeEvidence,
  validatePackagingSelectionEvidence,
} from '../../tools/python-supply-chain/packaging-selection.mjs';
import { buildRuntimeNativeSbomRecords } from '../../tools/python-supply-chain/sbom.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const target = { os: 'linux', architecture: 'x86_64', python_version: '3.13.15' };
const contextId = 'fixture-packaging-context-v1';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function baseEntry(id: string, path = `${id}.so`, ownerKind = 'WHEEL_OWNED_NATIVE') {
  return {
    entry_id: id,
    source_artifact_id:
      ownerKind === 'DERIVED_NATIVE' ? 'derived-tool-output' : 'wheel-fixture-1.0.0',
    source_artifact_sha256: hash(`${id}-source-artifact`),
    source_path: `site-packages/${path}`,
    internal_path: path,
    payload_sha256: hash(`${id}-payload`),
    owner_kind: ownerKind,
    target,
    build_context_id: contextId,
  };
}

function selectionEntry(entry: ReturnType<typeof baseEntry>) {
  return {
    ...entry,
    pyinstaller_stage: 'PKG_TOC',
    pyinstaller_category: 'BINARY',
    required_in_final: true,
    resolution_basis: 'PAYLOAD_SHA256_AND_SELECTED_SOURCE_PATH',
  };
}

function selection(entries = [selectionEntry(baseEntry('selected-foo', 'lib/foo.so'))]) {
  return {
    schema_version: '1',
    evidence_id: 'fixture-selection-evidence-v1',
    build_context: {
      build_context_id: contextId,
      code_commit_sha: '1'.repeat(40),
      target,
      cpython_artifact_sha256: hash('cpython'),
      pyinstaller_artifact_sha256: hash('pyinstaller'),
      wheel_graph_sha256: hash('wheel-graph'),
      specification_sha256: hash('specification'),
      source_import_graph_sha256: hash('source-import-graph'),
    },
    parser: {
      engine: 'pyinstaller',
      engine_version: '6.22.2',
      parser_name: 'code-f-pyinstaller-toc-parser',
      parser_version: '1',
    },
    raw_evidence: {
      analysis_toc: { sha256: hash('analysis-toc') },
      pkg_toc: { sha256: hash('pkg-toc') },
      exe_toc: { sha256: hash('exe-toc') },
      pyz_toc: { sha256: hash('pyz-toc') },
      build_log: { sha256: hash('build-log') },
      specification: { sha256: hash('specification') },
    },
    authoritative_native_entries: structuredClone(entries),
    selected_native_entries: structuredClone(entries),
    symlink_metadata: [],
  };
}

function reconciliation(selectionDocument: ReturnType<typeof selection>) {
  const selected = selectionDocument.selected_native_entries[0];
  const approved = {
    ...selected,
    entry_id: 'approved-foo',
  } as Record<string, unknown>;
  delete approved.pyinstaller_stage;
  delete approved.pyinstaller_category;
  delete approved.required_in_final;
  delete approved.resolution_basis;
  const unused = baseEntry('approved-unused', 'lib/unused.so');
  const materialized = {
    ...approved,
    entry_id: 'materialized-foo',
    selected_entry_id: selected.entry_id,
    transformation: { kind: 'NONE' },
  };
  const final = {
    ...approved,
    entry_id: 'final-foo',
    materialized_entry_id: materialized.entry_id,
    carchive_typecode: 'b',
  };
  return {
    schema_version: '3',
    reconciliation_id: 'fixture-native-reconciliation-v3',
    build_context_id: contextId,
    selection_evidence: {
      evidence_id: selectionDocument.evidence_id,
      sha256: packagingSelectionEvidenceSha256(selectionDocument),
    },
    approved_native_universe: [approved, unused],
    approved_late_stage_native: [],
    materialized_native_entries: [materialized],
    final_native_entries: [final],
    legacy_missing_domain: {
      domain_name: 'V2_EXPECTED_BUT_FINAL_MISSING',
      entries: [{ entry_id: unused.entry_id, classification: 'APPROVED_NOT_SELECTED' }],
    },
  };
}

describe('packaging selected native contract v3', () => {
  it('allows an approved subset while preserving unused approved entries', () => {
    const selected = selection();
    const report = reconcilePackagingNativeEvidence(selected, reconciliation(selected));
    expect(report.status).toBe('PASS');
    expect(report.identity_model).toBe('ENTRY_MANIFEST_MULTISET');
    expect(report.counts.approved_manifest).toBe(2);
    expect(report.counts.selected_manifest).toBe(1);
    expect(report.counts.approved_not_selected).toBe(1);
  });

  it('emits runtime SBOM entries only for final native records', () => {
    const selected = selection();
    const document = reconciliation(selected);
    const records = buildRuntimeNativeSbomRecords(selected, document);
    expect(records.components).toHaveLength(1);
    expect(records.components[0].properties).toContainEqual({
      name: 'com.company.native.scope',
      value: 'RUNTIME_FINAL_WORKER',
    });
    expect(JSON.stringify(records)).not.toContain('approved-unused');
  });

  it('fails closed when a selected required native is absent from final', () => {
    const selected = selection();
    const document = reconciliation(selected);
    document.final_native_entries = [];
    expect(() => reconcilePackagingNativeEvidence(selected, document)).toThrow(
      /schema invalid|missing from final CArchive/,
    );
  });

  it('fails closed when final contains an unapproved evil.dll', () => {
    const selected = selection();
    const document = reconciliation(selected);
    document.final_native_entries.push({
      ...baseEntry('final-evil', 'evil.dll'),
      materialized_entry_id: 'materialized-evil',
      carchive_typecode: 'b',
    });
    expect(() => reconcilePackagingNativeEvidence(selected, document)).toThrow(
      /no selected\/materialized provenance/,
    );
  });

  it('fails closed when final is approved but lacks selection provenance', () => {
    const selected = selection();
    const document = reconciliation(selected);
    const approved = document.approved_native_universe[1];
    const staged = {
      ...approved,
      entry_id: 'materialized-approved-unselected',
      selected_entry_id: approved.entry_id,
      transformation: { kind: 'NONE' },
    };
    document.materialized_native_entries.push(staged);
    document.final_native_entries.push({
      ...approved,
      entry_id: 'final-approved-unselected',
      materialized_entry_id: staged.entry_id,
      carchive_typecode: 'b',
    });
    expect(() => reconcilePackagingNativeEvidence(selected, document)).toThrow(
      /materialized native has no selected provenance/,
    );
  });

  it('detects a selected manifest that omits an authoritative raw TOC entry', () => {
    const foo = selectionEntry(baseEntry('selected-foo', 'lib/foo.so'));
    const bar = selectionEntry(baseEntry('selected-bar', 'lib/bar.so'));
    const document = selection([foo, bar]);
    document.selected_native_entries = [foo];
    expect(() => validatePackagingSelectionEvidence(document)).toThrow(
      /omits 1 authoritative PyInstaller native entry/,
    );
  });

  it('invalidates selection evidence when a bound build input changes', () => {
    const selected = selection();
    const document = reconciliation(selected);
    selected.build_context.source_import_graph_sha256 = hash('changed-import-graph');
    expect(() => reconcilePackagingNativeEvidence(selected, document)).toThrow(
      /selection evidence canonical hash binding mismatch/,
    );
  });

  it('treats a valid typecode n symlink as metadata and validates its target', () => {
    const document = selection();
    document.symlink_metadata = [
      {
        entry_id: 'symlink-foo',
        internal_path: 'libfoo.so',
        target_path: 'lib/foo.so',
        encoding: 'utf-8',
        typecode: 'n',
        build_context_id: contextId,
      },
    ];
    expect(validatePackagingSelectionEvidence(document).symlink_metadata).toHaveLength(1);
  });

  it('fails closed for a malformed symlink target', () => {
    const document = selection();
    document.symlink_metadata = [
      {
        entry_id: 'symlink-evil',
        internal_path: 'libfoo.so',
        target_path: 'missing/libfoo.so',
        encoding: 'utf-8',
        typecode: 'n',
        build_context_id: contextId,
      },
    ];
    expect(() => validatePackagingSelectionEvidence(document)).toThrow(
      /target is not a selected packaged entry/,
    );
  });

  it('allows an explicitly recorded relocation with stable payload provenance', () => {
    const selected = selection();
    const document = reconciliation(selected);
    document.materialized_native_entries[0].internal_path = 'relocated/libfoo.so';
    document.materialized_native_entries[0].transformation = { kind: 'RELOCATED' };
    document.final_native_entries[0].internal_path = 'relocated/libfoo.so';
    expect(reconcilePackagingNativeEvidence(selected, document).status).toBe('PASS');
  });

  it('uses source provenance to disambiguate equal hashes and rejects unresolved owners', () => {
    const selected = selection();
    const document = reconciliation(selected);
    const sameHashDifferentOwner = {
      ...document.approved_native_universe[0],
      entry_id: 'approved-same-hash-other-owner',
      source_artifact_id: 'wheel-other-1.0.0',
      source_artifact_sha256: hash('other-wheel'),
      source_path: 'site-packages/other/lib/foo.so',
    };
    document.approved_native_universe.push(sameHashDifferentOwner);
    expect(reconcilePackagingNativeEvidence(selected, document).status).toBe('PASS');

    const ambiguous = structuredClone(document);
    ambiguous.approved_native_universe.push({
      ...ambiguous.approved_native_universe[0],
      entry_id: 'approved-indistinguishable-owner',
    });
    expect(() => reconcilePackagingNativeEvidence(selected, ambiguous)).toThrow(
      /owner is ambiguous/,
    );
  });

  it('allows an approved derived native only with tool and configuration provenance', () => {
    const derived = selectionEntry(
      baseEntry('selected-derived', 'derived/output.so', 'DERIVED_NATIVE'),
    );
    const selected = selection([derived]);
    const document = reconciliation(selected);
    document.approved_native_universe = [baseEntry('approved-unused', 'lib/unused.so')];
    const approval = {
      ...derived,
      entry_id: 'approved-derived',
      approval_basis: 'LOCKED_DERIVATION',
    };
    delete approval.pyinstaller_stage;
    delete approval.pyinstaller_category;
    delete approval.required_in_final;
    delete approval.resolution_basis;
    document.approved_late_stage_native = [approval];
    document.materialized_native_entries[0] = {
      ...approval,
      entry_id: 'materialized-derived',
      selected_entry_id: derived.entry_id,
      transformation: {
        kind: 'DERIVED',
        tool_id: 'native-deriver-1',
        tool_sha256: hash('native-deriver'),
        configuration_sha256: hash('native-deriver-config'),
      },
    };
    document.final_native_entries[0] = {
      ...approval,
      entry_id: 'final-derived',
      materialized_entry_id: 'materialized-derived',
      carchive_typecode: 'b',
    };
    document.legacy_missing_domain.entries = [];
    expect(reconcilePackagingNativeEvidence(selected, document).status).toBe('PASS');

    delete document.materialized_native_entries[0].transformation.tool_sha256;
    expect(() => reconcilePackagingNativeEvidence(selected, document)).toThrow(
      /derived native lacks tool\/config provenance|schema invalid/,
    );
  });

  it('keeps v2 historical evidence readable but refuses semantic reinterpretation without TOC evidence', () => {
    expect(() => adaptV2NativeEvidence({ schema_version: '2' }, undefined, undefined)).toThrow(
      /cannot be reinterpreted as selected evidence/,
    );
  });
});

describe('Code C real Linux QICR machine evidence fixture', () => {
  const fixture = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        'tests/fixtures/python-supply-chain/code-c-real-native-qicr/evidence.json',
      ),
      'utf8',
    ),
  );

  function realSelection() {
    return {
      schema_version: '1',
      evidence_id: 'code-c-real-linux-selection-v1',
      build_context: fixture.build_context,
      parser: {
        engine: 'pyinstaller',
        engine_version: '6.22.2',
        parser_name: 'code-c-pyinstaller-build-evidence',
        parser_version: '1',
      },
      raw_evidence: fixture.raw_evidence,
      authoritative_native_entries: fixture.selected_native_entries,
      selected_native_entries: fixture.selected_native_entries,
      symlink_metadata: fixture.symlink_metadata,
    };
  }

  it('preserves the immutable build and raw TOC identities without the 118 MB worker', () => {
    expect(fixture.provenance.run_id).toBe(33239833877);
    expect(fixture.provenance.code_c_head_sha).toBe('2fb7eefb5f5ea7d2b260dd9fd6f7559235239eea');
    expect(fixture.provenance.candidate_worker_sha256).toBe(
      'fdccca4cffcd6d399f959d38d11969d8773380b99476c9b19dec4dfcdf2c7c91',
    );
    expect(fixture.raw_evidence.pkg_toc.sha256).toBe(
      '9fc85ab593084d1564c04e88812f6a6dccb2a884020ddb4ccb50c49528a5106e',
    );
    expect(fixture.provenance.selected_native_set_sha256).toBe(
      '7bad352fd42d76e95c962a92ed142411a7a2e9092b237a63fe9c15dd2aaec95c',
    );
    expect(fixture.provenance.materialized_native_set_sha256).toBe(
      'e8f85770ab72639af2f2782dea0738a23ba413d3f558363b2c9b37c17ca0a16e',
    );
    expect(
      Object.values(fixture.raw_evidence).map((entry: { sha256: string }) => entry.sha256),
    ).toEqual(
      expect.arrayContaining([
        '2b3be851c4dc7c3a419e97d4698a543450590b38881c0678e4db902a09e8a10c',
        'f2e9bb2b22ce4a9380d278ad24a79b98bcdac0c416f03e248154929b5f3cad3b',
        '61ce4c50749ad1ef35e78c9a2c0e61cd5290f5f092b5119cb03116fe0fdaa6fe',
        '370df9f6a7c8d38a55be472b09cad15ebbda131a7a094f26b1be0fcdc273ddf7',
      ]),
    );
    expect(validatePackagingSelectionEvidence(realSelection()).symlink_metadata).toHaveLength(32);
  });

  it('reconciles the four count domains and keeps legacy 15 distinct from A minus B', () => {
    const selected = realSelection();
    const approvedSelected = fixture.selected_native_entries
      .filter((entry: { owner_kind: string }) => entry.owner_kind !== 'SYSTEM_BUILD_RUNTIME_NATIVE')
      .map((entry: Record<string, unknown>) => {
        const copy = structuredClone(entry);
        delete copy.pyinstaller_stage;
        delete copy.pyinstaller_category;
        delete copy.required_in_final;
        delete copy.resolution_basis;
        return copy;
      });
    const inferredUnselectedCpython = Array.from({ length: 30 }, (_, index) => ({
      ...baseEntry(
        `approved-cpython-unselected-${String(index + 1).padStart(2, '0')}`,
        `lib/python3.13/lib-dynload/unselected-${String(index + 1).padStart(2, '0')}.so`,
        'CPYTHON_TOOLCHAIN_NATIVE',
      ),
      source_artifact_id: 'cpython-3.13.15-linux-x86_64',
      source_artifact_sha256: fixture.build_context.cpython_artifact_sha256,
      target: fixture.build_context.target,
      build_context_id: fixture.build_context.build_context_id,
    }));
    const legacyApproved = fixture.legacy_missing_entries.map((entry: Record<string, unknown>) => {
      const copy = structuredClone(entry);
      delete copy.classification;
      return copy;
    });
    const approved = [...approvedSelected, ...legacyApproved, ...inferredUnselectedCpython];
    expect(approved).toHaveLength(151);
    const reconciliationDocument = {
      schema_version: '3',
      reconciliation_id: 'code-c-real-linux-reconciliation-v3',
      build_context_id: fixture.build_context.build_context_id,
      selection_evidence: {
        evidence_id: selected.evidence_id,
        sha256: packagingSelectionEvidenceSha256(selected),
      },
      approved_native_universe: approved,
      approved_late_stage_native: fixture.approved_late_stage_native,
      materialized_native_entries: fixture.materialized_native_entries,
      final_native_entries: fixture.final_native_entries,
      legacy_missing_domain: {
        domain_name: 'V2_EXPECTED_BUT_FINAL_MISSING',
        entries: fixture.legacy_missing_entries.map((entry: { entry_id: string }) => ({
          entry_id: entry.entry_id,
          classification: 'APPROVED_NOT_SELECTED',
        })),
      },
    };
    const report = reconcilePackagingNativeEvidence(selected, reconciliationDocument);
    expect(report.counts).toMatchObject({
      approved_manifest: 151,
      selected_manifest: 117,
      materialized_manifest: 117,
      final_manifest: 117,
      approved_intersect_selected: 106,
      approved_not_selected: 45,
      selected_not_approved_universe: 11,
      selected_without_any_approval: 0,
      legacy_expected_domain: 15,
      legacy_approved_not_selected: 15,
      symlink_metadata: 32,
    });
    expect(report.counts.approved_manifest - report.counts.selected_manifest).toBe(34);
    expect(report.counts.legacy_missing).toBe(15);
  });
});
