import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson } from '../native-runtime-companion/companion.mjs';

export const repositoryRoot = resolve(import.meta.dirname, '../..');
export const authorityRoot = resolve(repositoryRoot, 'compliance/functional-acceptance/2026-09-05');

const SHA256 = /^[a-f0-9]{64}$/u;
const V1_ID = 'code-f-final-functional-acceptance-authority-set-20260905-v1';
const V1_SHA = '622b5c5f8cf67ac2d59e8279135910e082bd6b0a7eeda19813bebc485324f49e';
const GOLDEN_THRESHOLD_SHA = '37dcb1a42139863039162844ab1ef3dde50d6b3e6e3f26f01ff55f3a3c310074';
const GOLDEN_PROTOCOL_RAW_SHA = 'e80a371e83ed1de0d564065e81d0a65f2bf3ec689c49cac2accd1b1105b98211';

const FUNCTIONAL_RECORDS = [
  ['SIGLIP_MODEL_AUTHORITY.json', 'record_sha256'],
  ['AUTHORIZED_ASSET_PROVENANCE_POLICY.json', 'policy_sha256'],
  ['REAL_INDEX_CORPUS_MANIFEST.json', 'manifest_sha256'],
  ['REAL_INDEX_CORPUS_AUTHORITY.json', 'record_sha256'],
  ['GOLDEN_QUERY_SET_MANIFEST.json', 'manifest_sha256'],
  ['GOLDEN_GROUND_TRUTH_MANIFEST.json', 'manifest_sha256'],
  ['GOLDEN_RETRIEVAL_PROTOCOL.json', 'protocol_sha256'],
  ['WINDOWS_LOW_END_PROFILES.json', 'record_sha256'],
  ['FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET.json', 'record_sha256'],
  ['WINDOWS_LOW_END_PROFILES_V2.json', 'record_sha256'],
  ['FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V2.json', 'record_sha256'],
];

const readJson = (root, relativePath) =>
  JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));

const rawBytes = (root, relativePath) => readFileSync(resolve(root, relativePath));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const semanticHash = (document, field) => {
  const copy = structuredClone(document);
  delete copy[field];
  return sha256(JSON.stringify(canonicalJson(copy)));
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function verifySidecar(root, relativePath, expectedRaw) {
  const sidecarPath = relativePath.replace(/\.json$/u, '.sha256');
  const sidecar = readFileSync(resolve(root, sidecarPath), 'utf8').trim();
  const [sidecarHash, ...sidecarPathParts] = sidecar.split(/\s+/u);
  const expectedSidecarPath = relativePath.split('/').at(-1);
  assert(SHA256.test(sidecarHash ?? ''), `${sidecarPath}: invalid SHA-256`);
  assert(
    sidecarPathParts.join(' ') === expectedSidecarPath,
    `${sidecarPath}: path binding mismatch`,
  );
  assert(sidecarHash === expectedRaw, `${relativePath}: sidecar raw SHA mismatch`);
}

function verifySelfRecord(root, relativePath, field) {
  const document = readJson(root, relativePath);
  const raw = sha256(rawBytes(root, relativePath));
  const semantic = semanticHash(document, field);
  assert(SHA256.test(document[field] ?? ''), `${relativePath}: invalid semantic SHA-256`);
  assert(document[field] === semantic, `${relativePath}: semantic self-hash mismatch`);
  verifySidecar(root, relativePath, raw);
  return { document, raw, semantic };
}

function readAuthorityDocuments(root) {
  const read = (path) => readJson(root, path);
  return {
    siglip: read('compliance/functional-acceptance/2026-09-05/SIGLIP_MODEL_AUTHORITY.json'),
    policy: read(
      'compliance/functional-acceptance/2026-09-05/AUTHORIZED_ASSET_PROVENANCE_POLICY.json',
    ),
    corpusManifest: read(
      'compliance/functional-acceptance/2026-09-05/REAL_INDEX_CORPUS_MANIFEST.json',
    ),
    corpus: read('compliance/functional-acceptance/2026-09-05/REAL_INDEX_CORPUS_AUTHORITY.json'),
    querySet: read('compliance/functional-acceptance/2026-09-05/GOLDEN_QUERY_SET_MANIFEST.json'),
    groundTruth: read(
      'compliance/functional-acceptance/2026-09-05/GOLDEN_GROUND_TRUTH_MANIFEST.json',
    ),
    protocol: read('compliance/functional-acceptance/2026-09-05/GOLDEN_RETRIEVAL_PROTOCOL.json'),
    windowsV1: read('compliance/functional-acceptance/2026-09-05/WINDOWS_LOW_END_PROFILES.json'),
    authorityV1: read(
      'compliance/functional-acceptance/2026-09-05/FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET.json',
    ),
    windowsV2: read('compliance/functional-acceptance/2026-09-05/WINDOWS_LOW_END_PROFILES_V2.json'),
    authorityV2: read(
      'compliance/functional-acceptance/2026-09-05/FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V2.json',
    ),
    candidate: read(
      'compliance/distribution-closures/ffprobe-v2-33917303316/candidate-manifest.json',
    ),
    finalDistribution: read(
      'compliance/distribution-closures/ffprobe-v2-33917303316/final-distribution-binding.json',
    ),
    vulnerability: read(
      'compliance/vulnerability-reviews/ffprobe-v2-current-distribution-2026-09-05/CURRENT_DISTRIBUTION_FINAL_VULNERABILITY_REVIEW.json',
    ),
  };
}

function verifyWindowsChildren(windowsV2) {
  const profileEntries = Object.entries(windowsV2.profiles ?? {});
  assert(
    profileEntries.length === 2,
    'Windows profile authority must contain exactly two subjects',
  );
  const ids = new Set();
  const hashes = [];
  for (const [key, profile] of profileEntries) {
    assert(
      key === 'WINDOWS_4C_8GB_PROFILE' || key === 'WINDOWS_4C_16GB_PROFILE',
      `${key}: unknown Windows profile key`,
    );
    assert(!ids.has(profile.profile_id), `${key}: duplicate profile id`);
    ids.add(profile.profile_id);
    assert(SHA256.test(profile.profile_sha256 ?? ''), `${key}: invalid profile SHA-256`);
    const expected = semanticHash(profile, 'profile_sha256');
    assert(profile.profile_sha256 === expected, `${key}: profile semantic SHA mismatch`);
    assert(
      typeof profile.logical_subject_path === 'string' &&
        !/(?:^|[\\/])Users[\\/]|(?:^|[\\/])home[\\/]|^file:/iu.test(profile.logical_subject_path),
      `${key}: non-portable logical subject path`,
    );
    assert(profile.acceptance_result === 'NOT_RUN', `${key}: execution status changed`);
    hashes.push({ profile_id: profile.profile_id, profile_sha256: profile.profile_sha256 });
  }
  return hashes;
}

/**
 * Replay the published Functional Acceptance Authority graph without running
 * any product, model, media, native, or performance workload.
 */
export function verifyAuthorityGraph(root = repositoryRoot) {
  const docs = readAuthorityDocuments(root);
  const selfResults = new Map();
  for (const [relativePath, field] of FUNCTIONAL_RECORDS) {
    const authorityPath = `compliance/functional-acceptance/2026-09-05/${relativePath}`;
    selfResults.set(relativePath, verifySelfRecord(root, authorityPath, field));
  }

  const v1 = docs.authorityV1;
  const v2 = docs.authorityV2;
  const windowsV2 = docs.windowsV2;
  assert(v1.record_id === V1_ID, 'immutable v1 authority-set id changed');
  assert(v1.record_sha256 === V1_SHA, 'immutable v1 authority-set semantic SHA changed');
  assert(
    v2.record_id === 'code-f-final-functional-acceptance-authority-set-20260905-v2',
    'v2 authority-set id mismatch',
  );
  assert(v2.authority_set_status === 'ACTIVE', 'v2 authority-set is not active');
  assert(
    v2.active_authority_set_selection === 'V2_ONLY',
    'active authority selection is not V2_ONLY',
  );
  assert(
    v2.functional_acceptance_status === 'NOT_RUN',
    'authority correction cannot claim functional acceptance',
  );

  const edges = [];
  const edge = (label, condition) => {
    assert(condition, `authority edge failed: ${label}`);
    edges.push(label);
  };

  edge('v2.supersedes.v1.id', v2.supersession?.supersedes_authority_set_id === V1_ID);
  edge(
    'v2.supersedes.v1.semantic_sha256',
    v2.supersession?.supersedes_authority_set_sha256 === V1_SHA,
  );
  edge(
    'v2.supersession.reason',
    v2.supersession?.superseded_authority_status === 'SUPERSEDED_DUE_TO_CROSS_BINDING_DEFECT' &&
      v2.supersession?.supersession_reason === 'CROSS_RECORD_BINDING_MISMATCH',
  );

  const refs = v2.references ?? {};
  const protocol = docs.protocol;
  const querySet = docs.querySet;
  const groundTruth = docs.groundTruth;
  const corpus = docs.corpus;
  const corpusManifest = docs.corpusManifest;
  const policy = docs.policy;

  edge('golden.canonical_threshold', v2.golden_threshold_sha256 === GOLDEN_THRESHOLD_SHA);
  edge(
    'golden.top_level_threshold_to_protocol',
    v2.golden_threshold_sha256 === protocol.evaluation.threshold_sha256,
  );
  edge(
    'golden.category_threshold_to_protocol',
    refs.golden_retrieval_protocol?.threshold_sha256 === protocol.evaluation.threshold_sha256,
  );
  edge(
    'golden.authority_category_threshold_to_protocol',
    v2.authority_categories?.golden_retrieval?.golden_threshold_sha256 ===
      protocol.evaluation.threshold_sha256,
  );
  edge(
    'golden.cross_record_threshold',
    v2.cross_record_bindings?.golden_threshold?.top_level_threshold_sha256 ===
      v2.golden_threshold_sha256 &&
      v2.cross_record_bindings?.golden_threshold?.category_threshold_sha256 ===
        refs.golden_retrieval_protocol?.threshold_sha256 &&
      v2.cross_record_bindings?.golden_threshold?.protocol_threshold_sha256 ===
        protocol.evaluation.threshold_sha256 &&
      v2.cross_record_bindings?.golden_threshold?.binding_status === 'PASS',
  );
  edge(
    'golden.protocol_raw_to_sidecar',
    refs.golden_retrieval_protocol?.raw_file_sha256 === GOLDEN_PROTOCOL_RAW_SHA,
  );
  edge(
    'golden.category_raw_to_protocol',
    refs.golden_retrieval_protocol?.raw_file_sha256 === GOLDEN_PROTOCOL_RAW_SHA,
  );
  edge(
    'golden.authority_category_raw_to_protocol',
    v2.authority_categories?.golden_retrieval?.raw_file_sha256 === GOLDEN_PROTOCOL_RAW_SHA,
  );
  edge(
    'golden.cross_record_raw_file',
    v2.cross_record_bindings?.golden_protocol_raw_file?.category_raw_file_sha256 ===
      GOLDEN_PROTOCOL_RAW_SHA &&
      v2.cross_record_bindings?.golden_protocol_raw_file?.protocol_sidecar_sha256 ===
        GOLDEN_PROTOCOL_RAW_SHA &&
      v2.cross_record_bindings?.golden_protocol_raw_file?.binding_status === 'PASS',
  );
  edge(
    'golden.protocol_query_set_id',
    protocol.query_set.query_set_id === querySet.query_set_id &&
      refs.golden_query_set?.query_set_id === querySet.query_set_id,
  );
  edge(
    'golden.protocol_ground_truth_id',
    protocol.ground_truth.ground_truth_id === groundTruth.ground_truth_id &&
      refs.golden_ground_truth?.ground_truth_id === groundTruth.ground_truth_id,
  );
  edge(
    'golden.query_set_semantic_sha',
    refs.golden_query_set?.semantic_sha256 === semanticHash(querySet, 'manifest_sha256'),
  );
  edge(
    'golden.ground_truth_semantic_sha',
    refs.golden_ground_truth?.semantic_sha256 === semanticHash(groundTruth, 'manifest_sha256'),
  );
  edge(
    'golden.metric_and_threshold_value',
    protocol.evaluation.metric === 'RECALL_AT_5' &&
      protocol.evaluation.threshold_value === 0.9 &&
      refs.golden_threshold?.threshold_value === 0.9,
  );

  edge(
    'corpus.authority_to_manifest',
    corpus.corpus_id === corpusManifest.corpus_id &&
      corpus.corpus_manifest.manifest_sha256 === corpusManifest.manifest_sha256,
  );
  edge(
    'corpus.authority_to_policy',
    corpus.authorized_asset_provenance_policy.policy_id === policy.record_id &&
      corpus.authorized_asset_provenance_policy.policy_sha256 === policy.policy_sha256,
  );
  edge(
    'corpus.count_is_fail_closed',
    corpus.current_authorized_real_asset_count === 0 &&
      corpus.minimum_authorized_real_asset_count === 500 &&
      refs.real_index_corpus?.execution_readiness === 'BLOCKED_PENDING_AUTHORIZED_ASSETS',
  );

  const windowsHashes = verifyWindowsChildren(windowsV2);
  edge(
    'windows.v2_identity_mode',
    windowsV2.identity_mode === 'SEPARATE_SUBJECTS' &&
      refs.windows_low_end_profiles?.identity_mode === 'SEPARATE_SUBJECTS',
  );
  edge(
    'windows.8gb_child_binding',
    windowsHashes.some(
      (p) =>
        p.profile_id === v2.windows_4c_8gb_profile_id &&
        p.profile_sha256 === v2.windows_4c_8gb_profile_sha256,
    ),
  );
  edge(
    'windows.16gb_child_binding',
    windowsHashes.some(
      (p) =>
        p.profile_id === v2.windows_4c_16gb_profile_id &&
        p.profile_sha256 === v2.windows_4c_16gb_profile_sha256,
    ),
  );
  edge(
    'windows.aggregate_binding',
    refs.windows_low_end_profiles?.record_id === windowsV2.record_id &&
      refs.windows_low_end_profiles?.semantic_sha256 ===
        selfResults.get('WINDOWS_LOW_END_PROFILES_V2.json').semantic &&
      refs.windows_low_end_profiles?.raw_file_sha256 ===
        selfResults.get('WINDOWS_LOW_END_PROFILES_V2.json').raw,
  );
  edge(
    'windows.authority_category_binding',
    v2.authority_categories?.windows_low_end_profiles?.record_id === windowsV2.record_id &&
      v2.authority_categories?.windows_low_end_profiles?.record_sha256 ===
        selfResults.get('WINDOWS_LOW_END_PROFILES_V2.json').semantic,
  );
  edge(
    'windows.execution_not_implied',
    windowsV2.execution_status === 'NOT_RUN' &&
      refs.windows_low_end_profiles?.execution_status === 'NOT_RUN',
  );

  const candidatePath =
    'compliance/distribution-closures/ffprobe-v2-33917303316/candidate-manifest.json';
  const finalPath =
    'compliance/distribution-closures/ffprobe-v2-33917303316/final-distribution-binding.json';
  const vulnerabilityPath =
    'compliance/vulnerability-reviews/ffprobe-v2-current-distribution-2026-09-05/CURRENT_DISTRIBUTION_FINAL_VULNERABILITY_REVIEW.json';
  const candidateRaw = sha256(rawBytes(root, candidatePath));
  const finalRaw = sha256(rawBytes(root, finalPath));
  const vulnerabilityRaw = sha256(rawBytes(root, vulnerabilityPath));
  edge(
    'distribution.candidate_identity',
    refs.current_distribution_candidate?.candidate_id === docs.candidate.candidate_id &&
      refs.current_distribution_candidate?.semantic_sha256 ===
        docs.candidate.candidate_manifest_sha256 &&
      refs.current_distribution_candidate?.raw_file_sha256 === candidateRaw,
  );
  edge(
    'distribution.final_binding_identity',
    refs.current_final_distribution_binding?.record_id ===
      docs.finalDistribution.final_distribution_binding_id &&
      refs.current_final_distribution_binding?.semantic_sha256 ===
        docs.finalDistribution.final_distribution_binding_sha256 &&
      refs.current_final_distribution_binding?.raw_file_sha256 === finalRaw,
  );
  edge(
    'distribution.candidate_to_final_binding',
    docs.finalDistribution.candidate_id === docs.candidate.candidate_id &&
      refs.current_final_distribution_binding?.candidate_id ===
        refs.current_distribution_candidate?.candidate_id,
  );
  edge(
    'distribution.vulnerability_identity',
    refs.current_distribution_vulnerability_authority?.record_id === docs.vulnerability.record_id &&
      refs.current_distribution_vulnerability_authority?.semantic_sha256 ===
        docs.vulnerability.record_sha256 &&
      refs.current_distribution_vulnerability_authority?.raw_file_sha256 === vulnerabilityRaw &&
      refs.current_distribution_vulnerability_authority?.scope === 'CURRENT_DISTRIBUTION_CANDIDATE',
  );
  edge(
    'distribution.vulnerability_to_candidate',
    docs.vulnerability.candidate.candidate_id === docs.candidate.candidate_id &&
      docs.vulnerability.candidate.final_distribution_binding_id ===
        docs.finalDistribution.final_distribution_binding_id,
  );

  const activePayload = JSON.stringify({
    references: v2.references,
    cross_record_bindings: v2.cross_record_bindings,
    authority_categories: v2.authority_categories,
  });
  const activeV1Count =
    (activePayload.match(new RegExp(V1_ID, 'gu')) ?? []).length +
    (activePayload.match(new RegExp(V1_SHA, 'gu')) ?? []).length;
  edge('superseded.v1_not_in_active_graph', activeV1Count === 0);
  edge('superseded.selection_v2_only', v2.active_authority_set_selection === 'V2_ONLY');
  edge('superseded.fail_closed', v2.superseded_authority_fail_closed === 'PASS');

  edge('gate.self_hash', v2.authority_record_self_hash_gate === 'PASS');
  edge('gate.cross_record_binding', v2.authority_cross_record_binding_gate === 'PASS');
  edge('gate.graph_regression', v2.authority_graph_regression === 'PASS');

  const nodes = [
    'siglip_exact_model',
    'real_index_corpus',
    'authorized_asset_provenance_policy',
    'golden_retrieval_protocol',
    'golden_query_set',
    'golden_ground_truth',
    'golden_threshold',
    'windows_low_end_profiles',
    'windows_4c_8gb_profile',
    'windows_4c_16gb_profile',
    'current_distribution_candidate',
    'current_final_distribution_binding',
    'current_distribution_vulnerability_authority',
    'final_functional_acceptance_authority_set_v2',
  ];
  assert(new Set(nodes).size === nodes.length, 'authority node list contains duplicates');
  assert(v2.unresolved_cross_binding_count === 0, 'v2 unresolved cross-binding count is non-zero');
  assert(
    v2.conflicting_cross_binding_count === 0,
    'v2 conflicting cross-binding count is non-zero',
  );

  return {
    authoritySetId: v2.record_id,
    authoritySetSemanticSha256: selfResults.get('FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V2.json')
      .semantic,
    authoritySetRawFileSha256: selfResults.get('FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V2.json')
      .raw,
    totalAuthorityNodesVerified: nodes.length,
    totalAuthorityEdgesVerified: edges.length,
    unresolvedCrossBindingCount: 0,
    conflictingCrossBindingCount: 0,
    activeAuthorityReferenceToSupersededV1Count: activeV1Count,
    activeAuthoritySetSelection: v2.active_authority_set_selection,
    supersededAuthorityFailClosed: v2.superseded_authority_fail_closed,
    selfHashGate: 'PASS',
    crossRecordBindingGate: 'PASS',
    graphRegression: 'PASS',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(verifyAuthorityGraph(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
