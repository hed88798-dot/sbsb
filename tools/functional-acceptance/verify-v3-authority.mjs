import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson } from '../native-runtime-companion/companion.mjs';
import { verifyAuthorityGraph } from './verify-authority-graph.mjs';

export const repositoryRoot = resolve(import.meta.dirname, '../..');
export const acceptanceRoot = resolve(
  repositoryRoot,
  'compliance/functional-acceptance/2026-09-09',
);
export const v3Root = resolve(acceptanceRoot, 'v3');

const SHA256 = /^[a-f0-9]{64}$/u;
const V1_ID = 'code-f-final-functional-acceptance-authority-set-20260905-v1';
const V1_SHA = '622b5c5f8cf67ac2d59e8279135910e082bd6b0a7eeda19813bebc485324f49e';
const V2_ID = 'code-f-final-functional-acceptance-authority-set-20260905-v2';
const V2_SHA = 'f3f53e874a40b67991249ceecfa8267744e352f50a9c9a2e5fcbc3f4829928bc';
const WORKER_SHA = 'e56b32c1d547df0391e40a656230cdb2924b8ba6fb94f1b062632c5b1ca05d99';
const CACHE_SIGNATURE = 'fb20dae0be37cc347f975cdec9d630600f06696575f2f2677d412d1520731f6d';
const MODEL_ID = 'google/siglip2-base-patch32-256';
const MODEL_REVISION = '9e7ee68506177b546b2d5dc578f54afdc5e425f1';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const activeRoot = () => globalThis.__functionalAcceptanceRoot ?? repositoryRoot;
const readBytes = (relativePath) => readFileSync(resolve(activeRoot(), relativePath));
const rawSha = (relativePath) => createHash('sha256').update(readBytes(relativePath)).digest('hex');
const semanticSha = (document, field) => {
  const copy = structuredClone(document);
  delete copy[field];
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(copy)))
    .digest('hex');
};

function verifySelf(relativePath, field) {
  const document = JSON.parse(readBytes(relativePath));
  const semantic = semanticSha(document, field);
  const raw = rawSha(relativePath);
  assert(SHA256.test(document[field] ?? ''), `${relativePath}: invalid ${field}`);
  assert(document[field] === semantic, `${relativePath}: semantic self-hash mismatch`);
  const sidecarPath = relativePath.replace(/\.json$/u, '.sha256');
  const sidecar = readFileSync(resolve(activeRoot(), sidecarPath), 'utf8').trim();
  assert(
    sidecar === `${raw}  ${relativePath.split('/').at(-1)}`,
    `${sidecarPath}: raw binding mismatch`,
  );
  return { document, semantic, raw };
}

function verifyEvidence(relativePath, expectedSha) {
  assert(existsSync(resolve(activeRoot(), relativePath)), `${relativePath}: evidence file missing`);
  const actual = rawSha(relativePath);
  assert(actual === expectedSha, `${relativePath}: evidence SHA-256 mismatch`);
  return actual;
}

function linesWithBytes(relativePath) {
  const bytes = readBytes(relativePath);
  const text = bytes.toString('utf8');
  const lines = text.match(/[^\n]*(?:\n|$)/gu)?.filter((line) => line.length > 0) ?? [];
  return lines.map((line) => Buffer.from(line, 'utf8'));
}

function selectedLineSha(relativePath, predicate) {
  const selected = linesWithBytes(relativePath).filter((line) => predicate(line.toString('utf8')));
  assert(selected.length > 0, `${relativePath}: selected evidence rows are missing`);
  return {
    count: selected.length,
    sha256: createHash('sha256').update(Buffer.concat(selected)).digest('hex'),
    text: selected.map((line) => line.toString('utf8')),
  };
}

function verifyCsvEvidence(benchmark) {
  const inputs = benchmark.input_authority;
  const outputs = benchmark.output_authority;
  verifyEvidence(inputs.query_set.logical_path, inputs.query_set.sha256);
  verifyEvidence(inputs.ground_truth.logical_path, inputs.ground_truth.sha256);
  verifyEvidence(benchmark.corpus.evidence_logical_path, benchmark.corpus.evidence_sha256);
  verifyEvidence(benchmark.benchmark_harness.logical_path, benchmark.benchmark_harness.sha256);
  verifyEvidence(outputs.run_manifest.logical_path, outputs.run_manifest.sha256);
  verifyEvidence(outputs.per_query_result.logical_path, outputs.per_query_result.raw_result_sha256);
  verifyEvidence(
    outputs.ranked_top5_result.logical_path,
    outputs.ranked_top5_result.raw_result_sha256,
  );
  verifyEvidence(
    outputs.aggregate_metrics.logical_path,
    outputs.aggregate_metrics.aggregate_result_sha256,
  );

  const queryRow = selectedLineSha(inputs.query_set.logical_path, (line) =>
    line.startsWith('GQ006_SHORT_ZH,'),
  );
  assert(queryRow.count === 1, 'GQ006 query identity must select exactly one row');
  const expectedQueryRowSha =
    benchmark.gq006_utf8_regression_anchor.query_csv_row_exact_bytes_sha256;
  assert(queryRow.sha256 === expectedQueryRowSha, 'GQ006 query row hash mismatch');

  const queryText = benchmark.gq006_utf8_regression_anchor.query_text;
  const queryTextSha = createHash('sha256').update(Buffer.from(queryText, 'utf8')).digest('hex');
  assert(
    queryTextSha === benchmark.gq006_utf8_regression_anchor.query_text_utf8_bytes_sha256,
    'GQ006 UTF-8 query bytes hash mismatch',
  );

  const outputRows = selectedLineSha(outputs.ranked_top5_result.logical_path, (line) =>
    line.startsWith('"GQ006_SHORT_ZH"'),
  );
  const anchor = benchmark.gq006_utf8_regression_anchor;
  assert(
    outputRows.count === anchor.automated_path.selected_output_row_count,
    'GQ006 output row count mismatch',
  );
  assert(
    outputRows.sha256 === anchor.automated_path.selected_output_rows_sha256,
    'GQ006 output rows hash mismatch',
  );
  const firstFour = outputRows.text
    .map((line) => line.split(',')[5]?.replaceAll('"', ''))
    .slice(0, 4);
  assert(
    JSON.stringify(firstFour) === JSON.stringify(anchor.expected_first_four_asset_ids),
    'GQ006 automated first-four mismatch',
  );
  assert(
    JSON.stringify(firstFour) === JSON.stringify(anchor.automated_path.first_four_asset_ids),
    'GQ006 automated anchor mismatch',
  );
  assert(
    JSON.stringify(firstFour) ===
      JSON.stringify(anchor.manual_exact_search_path.first_four_asset_ids),
    'GQ006 manual comparison mismatch',
  );
  assert(anchor.automated_path.status === 'PASS', 'GQ006 automated path is not PASS');
  assert(anchor.manual_exact_search_path.status === 'PASS', 'GQ006 manual path is not PASS');
  assert(anchor.automated_vs_manual_path === 'MATCH', 'GQ006 automated/manual paths do not match');

  const summaryRows = linesWithBytes(outputs.per_query_result.logical_path)
    .slice(1)
    .filter((line) => line.length > 1);
  assert(summaryRows.length === 120, 'V3 per-query result must contain 120 rows');
  const errorRows = summaryRows.filter((line) => /,"[^"]*",\s*"[^"]+"\r?\n$/u.test(line));
  assert(
    outputs.per_query_result.search_errors === 0 && errorRows.length === 0,
    'V3 per-query result contains errors',
  );
  assert(
    outputs.run_manifest.searches_completed === 120,
    'V3 run manifest searches_completed mismatch',
  );
  assert(outputs.run_manifest.search_errors === 0, 'V3 run manifest search_errors mismatch');
  assert(
    outputs.run_manifest.gq006_utf8_transport_self_check === 'PASS',
    'V3 run manifest GQ006 self-check mismatch',
  );
}

export function verifyV3Authority(root = repositoryRoot) {
  // The verifier is intentionally rooted at the checkout under review. Tests use
  // the default root; a caller may pass a temporary checkout for mutation tests.
  const previousRoot = globalThis.__functionalAcceptanceRoot;
  globalThis.__functionalAcceptanceRoot = root;
  try {
    const legacyGraph = verifyAuthorityGraph(root);
    assert(legacyGraph.selfHashGate === 'PASS', 'immutable V2 authority graph no longer verifies');
    assert(
      legacyGraph.activeAuthoritySetSelection === 'V2_ONLY',
      'immutable V2 authority graph selection changed',
    );
    const benchmarkResult = verifySelf(
      'compliance/functional-acceptance/2026-09-09/v3/GOLDEN_BENCHMARK_V3_AUTHORITY.json',
      'record_sha256',
    );
    const reconciliationResult = verifySelf(
      'compliance/functional-acceptance/2026-09-09/V1_FUNCTIONAL_ACCEPTANCE_GOVERNANCE_RECONCILIATION.json',
      'record_sha256',
    );
    const authorityResult = verifySelf(
      'compliance/functional-acceptance/2026-09-09/FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V3.json',
      'record_sha256',
    );
    const benchmark = benchmarkResult.document;
    const reconciliation = reconciliationResult.document;
    const authority = authorityResult.document;

    assert(benchmark.benchmark_version === 'v3', 'V3 benchmark version mismatch');
    assert(
      benchmark.authority_status === 'PASS_IDENTITY_BINDING',
      'V3 benchmark is not authoritative',
    );
    assert(
      benchmark.functional_validation_worker.sha256 === WORKER_SHA,
      'functional validation Worker binding mismatch',
    );
    assert(
      benchmark.functional_validation_worker.python_version === '3.13.15',
      'Python version binding mismatch',
    );
    assert(
      benchmark.cache.signature_sha256 === CACHE_SIGNATURE,
      'cache signature binding mismatch',
    );
    assert(benchmark.corpus.authorized_real_asset_count === 100, 'authorized asset count mismatch');
    assert(
      benchmark.corpus.indexed_asset_count === 100 && benchmark.corpus.index_completion === 'PASS',
      'index completion mismatch',
    );
    assert(benchmark.corpus.shot_count === 103, 'shot count mismatch');
    assert(
      benchmark.input_authority.query_set.canonical_query_count === 40,
      'canonical query count mismatch',
    );
    assert(
      benchmark.input_authority.query_set.query_variant_count === 3,
      'query variant count mismatch',
    );
    assert(benchmark.input_authority.query_set.query_count === 120, 'query count mismatch');
    assert(
      benchmark.input_authority.ground_truth.strict_positive_count === 119,
      'strict positive count mismatch',
    );
    assert(
      benchmark.input_authority.ground_truth.explicit_negative_count === 2,
      'explicit negative count mismatch',
    );
    assert(
      benchmark.evaluation_semantics.metric_view === 'UNIQUE_ASSET_TOP5',
      'evaluation view mismatch',
    );
    assert(benchmark.evaluation_semantics.underlying_index_unit === 'SHOT', 'index unit mismatch');
    assert(
      benchmark.model_authority.model_id === MODEL_ID &&
        benchmark.model_authority.model_revision === MODEL_REVISION,
      'SigLIP model identity mismatch',
    );
    assert(
      benchmark.supersession.baseline_immutability === 'IMMUTABLE',
      'V3 baseline is not immutable',
    );
    assert(
      benchmark.supersession.supersedes.every(
        (item) => item.status === 'INVALIDATED_AND_NON_AUTHORITATIVE',
      ),
      'V1/V2 invalidation is not fail-closed',
    );
    verifyCsvEvidence(benchmark);

    assert(
      reconciliation.reconciliation_status === 'PASS_GOVERNANCE_ONLY',
      'governance reconciliation status mismatch',
    );
    assert(
      reconciliation.benchmark_authority.semantic_sha256 === benchmarkResult.semantic,
      'reconciliation benchmark binding mismatch',
    );
    assert(
      reconciliation.owner_scope_decision.v1_real_world_functional_acceptance_scope.includes(
        '100_DIVERSE_AUTHORIZED_REAL_ASSETS',
      ),
      'V1 scope decision missing',
    );
    assert(
      reconciliation.owner_scope_decision.legacy_500_asset_gate ===
        'SUPERSEDED_FOR_V1_CODE_C_FUNCTIONAL_ACCEPTANCE',
      'legacy 500 gate not superseded',
    );
    assert(
      reconciliation.owner_scope_decision.legacy_100_canonical_query_gate === 'SUPERSEDED_FOR_V1',
      'legacy 100-query gate not superseded',
    );
    assert(
      reconciliation.owner_scope_decision.legacy_universal_recall_at_5_0_90_gate ===
        'SUPERSEDED_FOR_V1',
      'legacy Recall gate not superseded',
    );
    assert(
      reconciliation.worker_binding.sha256 === WORKER_SHA &&
        reconciliation.worker_binding.role === 'FUNCTIONAL_VALIDATION_WORKER',
      'reconciliation Worker binding mismatch',
    );

    assert(
      authority.active_authority_set_selection === 'V3_ONLY',
      'active authority selection is not V3_ONLY',
    );
    assert(
      authority.supersession.supersedes.some(
        (item) =>
          item.record_id === V1_ID && item.record_sha256 === V1_SHA && item.status === 'SUPERSEDED',
      ),
      'v1 supersession binding mismatch',
    );
    assert(
      authority.supersession.supersedes.some(
        (item) =>
          item.record_id === V2_ID && item.record_sha256 === V2_SHA && item.status === 'SUPERSEDED',
      ),
      'v2 supersession binding mismatch',
    );
    assert(
      authority.benchmark_authority.semantic_sha256 === benchmarkResult.semantic,
      'authority benchmark binding mismatch',
    );
    assert(
      authority.governance_reconciliation.semantic_sha256 === reconciliationResult.semantic,
      'authority reconciliation binding mismatch',
    );
    assert(
      authority.real_world_v1_scope.authorized_real_assets === 100 &&
        authority.real_world_v1_scope.indexed_real_assets === 100,
      'authority V1 corpus counts mismatch',
    );
    assert(
      authority.real_world_v1_scope.canonical_golden_queries === 40 &&
        authority.real_world_v1_scope.query_variants === 3 &&
        authority.real_world_v1_scope.total_searches === 120,
      'authority V1 query counts mismatch',
    );
    assert(
      authority.authority_gates.self_hash === 'PASS' &&
        authority.authority_gates.raw_file_binding === 'PASS' &&
        authority.authority_gates.cross_record_binding === 'PASS',
      'authority identity gates not PASS',
    );
    assert(
      authority.authority_gates.v3_input_output_binding === 'PASS' &&
        authority.authority_gates.unresolved_v3_input_binding_count === 0 &&
        authority.authority_gates.unresolved_v3_output_binding_count === 0,
      'V3 input/output gate not PASS',
    );
    assert(
      authority.functional_validation_worker.sha256 === WORKER_SHA,
      'authority Worker binding mismatch',
    );
    assert(
      authority.code_c_acceptance.final_commit === '4df253f9b181043ab10a1d97a888f7980f1b9dde',
      'Code C closeout commit binding mismatch',
    );
    assert(
      authority.code_c_acceptance.release_candidate_promotion === undefined,
      'release promotion field must not be inferred',
    );
    assert(
      authority.release_boundaries.stable_release_license_gate ===
        'BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION',
      'stable release blocker changed',
    );

    const portabilityStrings = JSON.stringify({ benchmark, reconciliation, authority });
    assert(
      !/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\|file:)/u.test(portabilityStrings),
      'authority record contains a developer-specific path',
    );
    return {
      benchmarkAuthorityId: benchmark.record_id,
      benchmarkSemanticSha256: benchmarkResult.semantic,
      benchmarkRawFileSha256: benchmarkResult.raw,
      reconciliationId: reconciliation.record_id,
      reconciliationSemanticSha256: reconciliationResult.semantic,
      authoritySetId: authority.record_id,
      authoritySetSemanticSha256: authorityResult.semantic,
      authoritySetRawFileSha256: authorityResult.raw,
      activeAuthoritySetSelection: authority.active_authority_set_selection,
      selfHashGate: 'PASS',
      rawFileBindingGate: 'PASS',
      crossRecordBindingGate: 'PASS',
      v3InputOutputBindingGate: 'PASS',
      supersessionGate: 'PASS',
      unresolvedCrossBindingCount: 0,
      conflictingCrossBindingCount: 0,
      unresolvedV3InputBindingCount: 0,
      unresolvedV3OutputBindingCount: 0,
      codeCCloseoutEvidenceRemote: reconciliation.code_c_closeout.closeout_evidence_remote,
      codeCVersionAcceptance: authority.code_c_acceptance.version_acceptance,
      codeDEntryGate: authority.code_d_entry.status,
      immutableV2Graph: 'PASS',
    };
  } finally {
    globalThis.__functionalAcceptanceRoot = previousRoot;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(verifyV3Authority(), null, 2));
  } catch (error) {
    console.error(
      `functional-acceptance-v3: FAIL\n${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
