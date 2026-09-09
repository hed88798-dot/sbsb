import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson, repositoryRoot, validatePackagedInventory } from './inventory.mjs';

export const packagingSelectionEvidenceSchemaVersion = '1';
export const nativeReconciliationSchemaVersion = '3';
export const packagingSelectionEvidenceSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/packaging-selection-evidence/v1/evidence.schema.json',
);
export const nativeReconciliationSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/packaged-native-inventory/v3/reconciliation.schema.json',
);

function validatorFor(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

const validateSelectionSchema = validatorFor(packagingSelectionEvidenceSchemaPath);
const validateReconciliationSchema = validatorFor(nativeReconciliationSchemaPath);

function schemaErrors(validator) {
  return (validator.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function multiset(values, identity) {
  const counts = new Map();
  for (const value of values) {
    const key = identity(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function multisetDifference(left, right) {
  const output = [];
  for (const [key, count] of left) {
    const remainder = count - (right.get(key) ?? 0);
    for (let index = 0; index < remainder; index += 1) output.push(key);
  }
  return output;
}

function selectionIdentity(entry) {
  return canonicalJson({
    entry_id: entry.entry_id,
    source_artifact_id: entry.source_artifact_id,
    source_artifact_sha256: entry.source_artifact_sha256,
    source_path: entry.source_path,
    internal_path: entry.internal_path,
    payload_sha256: entry.payload_sha256,
    owner_kind: entry.owner_kind,
    target: entry.target,
    build_context_id: entry.build_context_id,
    pyinstaller_stage: entry.pyinstaller_stage,
    pyinstaller_category: entry.pyinstaller_category,
    required_in_final: entry.required_in_final,
    disposition: entry.disposition ?? 'INTERNAL',
    external_prerequisite: entry.external_prerequisite ?? null,
  });
}

function provenanceIdentity(entry) {
  return canonicalJson({
    source_artifact_id: entry.source_artifact_id,
    source_artifact_sha256: entry.source_artifact_sha256,
    source_path: entry.source_path,
    payload_sha256: entry.payload_sha256,
    owner_kind: entry.owner_kind,
    target: entry.target,
    build_context_id: entry.build_context_id,
  });
}

function assertUniqueEntryIds(entries, label, failures) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.entry_id)) failures.push(`${label}: duplicate entry_id: ${entry.entry_id}`);
    ids.add(entry.entry_id);
  }
}

function assertBuildContext(entries, expected, label, failures) {
  for (const entry of entries) {
    if (entry.build_context_id !== expected) {
      failures.push(`${label}: build_context_id mismatch: ${entry.entry_id}`);
    }
  }
}

function fail(failures) {
  if (failures.length > 0) throw new Error([...new Set(failures)].join('\n'));
}

export function validatePackagingSelectionEvidence(document) {
  if (!validateSelectionSchema(document)) {
    throw new Error(
      `packaging selection evidence schema invalid: ${schemaErrors(validateSelectionSchema)}`,
    );
  }
  const failures = [];
  const context = document.build_context.build_context_id;
  if (document.raw_evidence.specification.sha256 !== document.build_context.specification_sha256) {
    failures.push('raw specification hash differs from build-context specification hash');
  }
  const authoritative = multiset(document.authoritative_native_entries, selectionIdentity);
  const selected = multiset(document.selected_native_entries, selectionIdentity);
  const omitted = multisetDifference(authoritative, selected);
  const invented = multisetDifference(selected, authoritative);
  if (omitted.length > 0) {
    failures.push(
      `selected manifest omits ${omitted.length} authoritative PyInstaller native entry`,
    );
  }
  if (invented.length > 0) {
    failures.push(
      `selected manifest invents ${invented.length} native entry absent from raw TOC evidence`,
    );
  }
  assertUniqueEntryIds(
    document.authoritative_native_entries,
    'authoritative native entries',
    failures,
  );
  assertUniqueEntryIds(document.selected_native_entries, 'selected native entries', failures);
  assertBuildContext(
    document.authoritative_native_entries,
    context,
    'authoritative native entries',
    failures,
  );
  for (const entry of document.selected_native_entries) {
    const disposition = entry.disposition ?? 'INTERNAL';
    if (disposition === 'EXTERNAL_PREREQUISITE') {
      if (entry.required_in_final !== false || !entry.external_prerequisite) {
        failures.push(
          `external selected entry lacks non-final prerequisite disposition: ${entry.entry_id}`,
        );
      }
      if (!/^[a-f0-9]{64}$/u.test(entry.external_prerequisite?.manifest_sha256 ?? '')) {
        failures.push(
          `external selected entry lacks exact prerequisite manifest hash: ${entry.entry_id}`,
        );
      }
    } else if (disposition !== 'INTERNAL' || entry.required_in_final !== true) {
      failures.push(`invalid native selection disposition: ${entry.entry_id}`);
    }
  }
  assertBuildContext(
    document.selected_native_entries,
    context,
    'selected native entries',
    failures,
  );

  const packagedPaths = new Set(
    document.authoritative_native_entries.map((entry) => entry.internal_path),
  );
  const symlinkPaths = new Set();
  for (const link of document.symlink_metadata) {
    if (link.build_context_id !== context)
      failures.push(`symlink build_context_id mismatch: ${link.entry_id}`);
    if (symlinkPaths.has(link.internal_path))
      failures.push(`duplicate symlink path: ${link.internal_path}`);
    symlinkPaths.add(link.internal_path);
    if (link.internal_path === link.target_path)
      failures.push(`symlink resolves to itself: ${link.internal_path}`);
    if (!packagedPaths.has(link.target_path)) {
      failures.push(
        `symlink target is not a selected packaged entry: ${link.internal_path} -> ${link.target_path}`,
      );
    }
  }
  fail(failures);
  return document;
}

function validateLayerRequirements(document, failures) {
  for (const entry of document.approved_late_stage_native) {
    if (!entry.approval_basis)
      failures.push(`late-stage approval has no approval_basis: ${entry.entry_id}`);
  }
  for (const entry of document.materialized_native_entries) {
    if (entry.disposition === 'EXTERNAL_PREREQUISITE') {
      failures.push(`external prerequisite was materialized: ${entry.entry_id}`);
    }
    if (!entry.selected_entry_id || !entry.transformation) {
      failures.push(`materialized entry lacks selected trace/transformation: ${entry.entry_id}`);
    } else if (entry.transformation.kind === 'DERIVED') {
      if (
        !entry.transformation.tool_id ||
        !entry.transformation.tool_sha256 ||
        !entry.transformation.configuration_sha256
      ) {
        failures.push(`derived native lacks tool/config provenance: ${entry.entry_id}`);
      }
    }
  }
  for (const entry of document.final_native_entries) {
    if (entry.disposition === 'EXTERNAL_PREREQUISITE') {
      failures.push(`external prerequisite appears in final CArchive: ${entry.entry_id}`);
    }
    if (!entry.materialized_entry_id || entry.carchive_typecode !== 'b') {
      failures.push(
        `final native lacks materialized provenance or native typecode: ${entry.entry_id}`,
      );
    }
  }
}

export function reconcilePackagingNativeEvidence(selectionDocument, reconciliationDocument) {
  validatePackagingSelectionEvidence(selectionDocument);
  if (!validateReconciliationSchema(reconciliationDocument)) {
    throw new Error(
      `native reconciliation schema invalid: ${schemaErrors(validateReconciliationSchema)}`,
    );
  }
  const failures = [];
  const context = selectionDocument.build_context.build_context_id;
  if (reconciliationDocument.build_context_id !== context) {
    failures.push('reconciliation build_context_id differs from selection evidence');
  }
  if (reconciliationDocument.selection_evidence.evidence_id !== selectionDocument.evidence_id) {
    failures.push('selection evidence_id binding mismatch');
  }
  if (reconciliationDocument.selection_evidence.sha256 !== sha256Canonical(selectionDocument)) {
    failures.push('selection evidence canonical hash binding mismatch');
  }

  const approved = reconciliationDocument.approved_native_universe;
  const late = reconciliationDocument.approved_late_stage_native;
  const selected = selectionDocument.selected_native_entries;
  const materialized = reconciliationDocument.materialized_native_entries;
  const final = reconciliationDocument.final_native_entries;
  for (const [label, entries] of [
    ['approved native universe', approved],
    ['approved late-stage native', late],
    ['materialized native', materialized],
    ['final native', final],
  ]) {
    assertUniqueEntryIds(entries, label, failures);
    assertBuildContext(entries, context, label, failures);
  }
  validateLayerRequirements(reconciliationDocument, failures);

  const approvalsByProvenance = new Map();
  for (const entry of [...approved, ...late]) {
    const key = provenanceIdentity(entry);
    const candidates = approvalsByProvenance.get(key) ?? [];
    candidates.push(entry);
    approvalsByProvenance.set(key, candidates);
  }
  for (const entry of selected) {
    if (entry.disposition === 'EXTERNAL_PREREQUISITE') continue;
    const candidates = approvalsByProvenance.get(provenanceIdentity(entry)) ?? [];
    if (candidates.length === 0)
      failures.push(`selected native has no approved provenance: ${entry.entry_id}`);
    if (candidates.length > 1)
      failures.push(`selected native owner is ambiguous: ${entry.entry_id}`);
  }

  const selectedById = new Map(selected.map((entry) => [entry.entry_id, entry]));
  const materializedBySelected = new Map();
  for (const entry of materialized) {
    const source = selectedById.get(entry.selected_entry_id);
    if (!source) {
      failures.push(`materialized native has no selected provenance: ${entry.entry_id}`);
      continue;
    }
    if (source.disposition === 'EXTERNAL_PREREQUISITE') {
      failures.push(`external prerequisite was materialized: ${source.entry_id}`);
      continue;
    }
    const existing = materializedBySelected.get(source.entry_id);
    if (existing)
      failures.push(`selected native maps to multiple materialized entries: ${source.entry_id}`);
    materializedBySelected.set(source.entry_id, entry);
    if (entry.payload_sha256 !== source.payload_sha256) {
      failures.push(`selected-to-materialized payload hash mismatch: ${source.entry_id}`);
    }
    if (provenanceIdentity(entry) !== provenanceIdentity(source)) {
      failures.push(`selected-to-materialized provenance mismatch: ${source.entry_id}`);
    }
    if (entry.transformation?.kind === 'NONE' && entry.internal_path !== source.internal_path) {
      failures.push(`unrecorded selected-to-materialized relocation: ${source.entry_id}`);
    }
  }
  for (const entry of selected) {
    if (entry.disposition === 'EXTERNAL_PREREQUISITE') {
      if (materializedBySelected.has(entry.entry_id)) {
        failures.push(`external prerequisite was materialized: ${entry.entry_id}`);
      }
      continue;
    }
    if (!materializedBySelected.has(entry.entry_id)) {
      failures.push(`selected native was not materialized: ${entry.entry_id}`);
    }
  }

  const materializedById = new Map(materialized.map((entry) => [entry.entry_id, entry]));
  const finalByMaterialized = new Map();
  for (const entry of final) {
    const source = materializedById.get(entry.materialized_entry_id);
    if (!source) {
      failures.push(`final native has no selected/materialized provenance: ${entry.entry_id}`);
      continue;
    }
    const existing = finalByMaterialized.get(source.entry_id);
    if (existing)
      failures.push(`materialized native maps to multiple final entries: ${source.entry_id}`);
    finalByMaterialized.set(source.entry_id, entry);
    if (entry.payload_sha256 !== source.payload_sha256) {
      failures.push(`materialized-to-final payload hash mismatch: ${source.entry_id}`);
    }
    if (provenanceIdentity(entry) !== provenanceIdentity(source)) {
      failures.push(`materialized-to-final provenance mismatch: ${source.entry_id}`);
    }
    if (entry.internal_path !== source.internal_path) {
      failures.push(`final native path differs from materialized manifest: ${source.entry_id}`);
    }
  }
  for (const entry of selected.filter((candidate) => candidate.required_in_final)) {
    const staged = materializedBySelected.get(entry.entry_id);
    if (!staged || !finalByMaterialized.has(staged.entry_id)) {
      failures.push(`selected required native is missing from final CArchive: ${entry.entry_id}`);
    }
  }

  const selectedIds = new Set(selected.map((entry) => entry.entry_id));
  const approvedIds = new Set(approved.map((entry) => entry.entry_id));
  const legacy = reconciliationDocument.legacy_missing_domain.entries;
  for (const entry of legacy) {
    if (entry.classification === 'APPROVED_NOT_SELECTED') {
      if (!approvedIds.has(entry.entry_id) || selectedIds.has(entry.entry_id)) {
        failures.push(
          `legacy approved-not-selected classification is inconsistent: ${entry.entry_id}`,
        );
      }
    }
    if (entry.classification === 'SELECTED_BUT_MISSING') {
      const staged = materializedBySelected.get(entry.entry_id);
      if (
        !selectedIds.has(entry.entry_id) ||
        (staged && finalByMaterialized.has(staged.entry_id))
      ) {
        failures.push(
          `legacy selected-but-missing classification is inconsistent: ${entry.entry_id}`,
        );
      }
    }
  }
  fail(failures);

  const internalSelected = selected.filter(
    (entry) => entry.disposition !== 'EXTERNAL_PREREQUISITE',
  );
  const selectedApprovalIds = new Set(
    internalSelected
      .flatMap((entry) => approvalsByProvenance.get(provenanceIdentity(entry)) ?? [])
      .map((entry) => entry.entry_id),
  );
  return {
    schema_version: nativeReconciliationSchemaVersion,
    status: 'PASS',
    build_context_id: context,
    identity_model: 'ENTRY_MANIFEST_MULTISET',
    counts: {
      approved_manifest: approved.length,
      selected_manifest: selected.length,
      materialized_manifest: materialized.length,
      final_manifest: final.length,
      approved_intersect_selected: selected.filter((entry) =>
        approvedIds.has((approvalsByProvenance.get(provenanceIdentity(entry)) ?? [])[0]?.entry_id),
      ).length,
      approved_not_selected: approved.filter((entry) => !selectedApprovalIds.has(entry.entry_id))
        .length,
      selected_not_approved_universe: selected.filter(
        (entry) =>
          !approved.some(
            (candidate) => provenanceIdentity(candidate) === provenanceIdentity(entry),
          ),
      ).length,
      selected_without_any_approval: internalSelected.filter(
        (entry) => (approvalsByProvenance.get(provenanceIdentity(entry)) ?? []).length === 0,
      ).length,
      selected_intersect_materialized: materializedBySelected.size,
      selected_not_materialized: selected.filter(
        (entry) =>
          entry.disposition !== 'EXTERNAL_PREREQUISITE' &&
          !materializedBySelected.has(entry.entry_id),
      ).length,
      external_selected: selected.filter((entry) => entry.disposition === 'EXTERNAL_PREREQUISITE')
        .length,
      external_selected_not_materialized: selected.filter(
        (entry) =>
          entry.disposition === 'EXTERNAL_PREREQUISITE' &&
          !materializedBySelected.has(entry.entry_id),
      ).length,
      materialized_not_selected: materialized.filter(
        (entry) => !selectedById.has(entry.selected_entry_id),
      ).length,
      materialized_intersect_final: finalByMaterialized.size,
      materialized_not_final: materialized.filter(
        (entry) => !finalByMaterialized.has(entry.entry_id),
      ).length,
      final_not_materialized: final.filter(
        (entry) => !materializedById.has(entry.materialized_entry_id),
      ).length,
      legacy_expected_domain: legacy.length,
      legacy_missing: legacy.length,
      legacy_approved_not_selected: legacy.filter(
        (entry) => entry.classification === 'APPROVED_NOT_SELECTED',
      ).length,
      symlink_metadata: selectionDocument.symlink_metadata.length,
    },
  };
}

export function adaptV2NativeEvidence(v2Document, selectionDocument, reconciliationDocument) {
  if (v2Document.schema_version !== '2')
    throw new Error('adapter requires native inventory schema v2');
  if (!selectionDocument || !reconciliationDocument) {
    throw new Error(
      'v2 expected-native evidence cannot be reinterpreted as selected evidence without authoritative TOC and v3 manifests',
    );
  }
  validatePackagedInventory(v2Document);
  return reconcilePackagingNativeEvidence(selectionDocument, reconciliationDocument);
}

export function packagingSelectionEvidenceSha256(document) {
  validatePackagingSelectionEvidence(document);
  return sha256Canonical(document);
}
