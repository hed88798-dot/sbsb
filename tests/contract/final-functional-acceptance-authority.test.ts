import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../tools/native-runtime-companion/companion.mjs';

type JsonObject = Record<string, unknown>;

const authorityRoot = resolve(
  dirname(import.meta.filename),
  '../../compliance/functional-acceptance/2026-09-05',
);

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function load(file: string): JsonObject {
  return JSON.parse(readFileSync(resolve(authorityRoot, file), 'utf8')) as JsonObject;
}

function rawHash(file: string): string {
  return sha256(readFileSync(resolve(authorityRoot, file)));
}

function semanticHash(document: JsonObject, field: string): string {
  const copy = { ...document };
  delete copy[field];
  return sha256(JSON.stringify(canonicalJson(copy)));
}

function verifySelfHash(file: string, field: string): JsonObject {
  const document = load(file);
  expect(document[field]).toBe(semanticHash(document, field));
  const sidecar = readFileSync(
    resolve(authorityRoot, `${file.replace('.json', '')}.sha256`),
    'utf8',
  );
  expect(sidecar.trim()).toBe(`${rawHash(file)}  ${file}`);
  return document;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

describe('final functional acceptance authority inventory', () => {
  it('keeps every authority record self-hashed and portable', () => {
    const records: Array<[string, string]> = [
      ['SIGLIP_MODEL_AUTHORITY.json', 'record_sha256'],
      ['AUTHORIZED_ASSET_PROVENANCE_POLICY.json', 'policy_sha256'],
      ['REAL_INDEX_CORPUS_MANIFEST.json', 'manifest_sha256'],
      ['REAL_INDEX_CORPUS_AUTHORITY.json', 'record_sha256'],
      ['GOLDEN_QUERY_SET_MANIFEST.json', 'manifest_sha256'],
      ['GOLDEN_GROUND_TRUTH_MANIFEST.json', 'manifest_sha256'],
      ['GOLDEN_RETRIEVAL_PROTOCOL.json', 'protocol_sha256'],
      ['WINDOWS_LOW_END_PROFILES.json', 'record_sha256'],
      ['FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET.json', 'record_sha256'],
    ];
    for (const [file, field] of records) {
      const document = verifySelfHash(file, field);
      const nonPortable = collectStrings(document).filter((value) =>
        /(?:^|[\\/])Users[\\/]|(?:^|[\\/])home[\\/]|^file:/iu.test(value),
      );
      expect(nonPortable, `${file} contains a developer-specific path`).toEqual([]);
    }
  });

  it('rebinds the exact historical SigLIP identity without claiming a rerun', () => {
    const model = load('SIGLIP_MODEL_AUTHORITY.json');
    expect(model).toMatchObject({
      classification: 'EXISTING_BUT_NOT_PUBLISHED',
      authority_status: 'PASS_IDENTITY_BINDING',
      execution_status: 'NOT_RUN_THIS_ROUND',
      model: {
        model_id: 'google/siglip2-base-patch32-256',
        model_revision: '9e7ee68506177b546b2d5dc578f54afdc5e425f1',
        license: 'Apache-2.0',
        onnx_opset: 18,
        onnxruntime_version: '1.29.0',
        preprocess_version: 'siglip2-processor-256-bicubic-mean0.5-official-text-v2',
        image_encoder: {
          sha256: 'ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059',
          size_bytes: 378435041,
        },
        text_encoder: {
          sha256: '12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30',
          size_bytes: 1129415247,
        },
      },
      source_authority: {
        source_lock_declared_sha256:
          '3f628585475283c2b50bd8040acb2f47767b3cebc4b07cdf9ae08bde47e4b82d',
        model_pack_tag: 'model-pack-siglip2-9e7ee685-opset18-fp32',
        model_pack_tag_commit: '96fc88b3a0139ea5d927fa183b381b314ac7057c',
      },
      historical_evidence: {
        source_commit: '53de6ec507e5d4cdc125012032f9b775276c94d7',
        evidence_status: 'EXISTING_ACCEPTED_EVIDENCE_REBOUND; NOT_PREVIOUSLY_ON_MAIN',
      },
    });
  });

  it('defines real-index and Golden authorities as fail-closed, not as test results', () => {
    const policy = load('AUTHORIZED_ASSET_PROVENANCE_POLICY.json');
    const corpusManifest = load('REAL_INDEX_CORPUS_MANIFEST.json');
    const corpus = load('REAL_INDEX_CORPUS_AUTHORITY.json');
    const queries = load('GOLDEN_QUERY_SET_MANIFEST.json');
    const groundTruth = load('GOLDEN_GROUND_TRUTH_MANIFEST.json');
    const protocol = load('GOLDEN_RETRIEVAL_PROTOCOL.json');

    expect(policy.policy_status).toBe('APPROVED_GOVERNANCE_DEFINITION');
    expect(corpusManifest).toMatchObject({
      manifest_status: 'NOT_YET_POPULATED',
      execution_status: 'NOT_RUN',
      minimum_authorized_real_asset_count: 500,
      assets: [],
    });
    expect(corpus).toMatchObject({
      authority_status: 'READY_FOR_EXECUTION',
      acceptance_status: 'NOT_YET_CLOSED',
      current_authorized_real_asset_count: 0,
      asset_count_gate: 'NOT_RUN',
      provenance_gate: 'NOT_RUN',
    });
    expect(queries).toMatchObject({
      manifest_status: 'NOT_YET_POPULATED',
      execution_status: 'NOT_RUN',
      minimum_query_count: 100,
      queries: [],
    });
    expect(groundTruth).toMatchObject({
      manifest_status: 'NOT_YET_POPULATED',
      execution_status: 'NOT_RUN',
      entries: [],
    });
    expect(protocol).toMatchObject({
      protocol_status: 'APPROVED_GOVERNANCE_DEFINITION',
      execution_status: 'NOT_RUN',
      evaluation: {
        metric: 'RECALL_AT_5',
        top_k: 5,
        threshold_authority: 'OWNER_GOVERNANCE_DECISION',
        threshold_value: 0.9,
      },
      result_semantics: { metrics_result: 'NOT_RUN', acceptance_result: 'NOT_RUN' },
    });
  });

  it('defines both Windows low-end profiles and binds all four categories', () => {
    const profiles = load('WINDOWS_LOW_END_PROFILES.json');
    const aggregate = load('FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET.json');
    expect(profiles).toMatchObject({
      authority_status: 'READY_FOR_EXECUTION',
      execution_status: 'NOT_RUN',
      profiles: {
        WINDOWS_4C_8GB_PROFILE: {
          cpu_logical_cores: 4,
          memory_bytes: 8589934592,
          acceptance_result: 'NOT_RUN',
        },
        WINDOWS_4C_16GB_PROFILE: {
          cpu_logical_cores: 4,
          memory_bytes: 17179869184,
          acceptance_result: 'NOT_RUN',
        },
      },
    });
    expect(aggregate).toMatchObject({
      authority_set_status: 'PASS_AUTHORITY_CLOSURE_ONLY',
      functional_acceptance_status: 'NOT_RUN',
      siglip_model_id: 'google/siglip2-base-patch32-256',
      siglip_model_revision: '9e7ee68506177b546b2d5dc578f54afdc5e425f1',
      siglip_image_onnx_sha256: 'ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059',
      siglip_text_onnx_sha256: '12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30',
      real_index_corpus_id: 'code-f-real-index-corpus-20260905-v1',
      real_index_corpus_manifest_sha256:
        'a007c7c6829cef003282b136e46199fdf601926d819169850ccc9ea6fe02f06f',
      golden_retrieval_protocol_id: 'code-f-golden-retrieval-protocol-20260905-v1',
      golden_retrieval_protocol_sha256:
        '4bf87d766915af959f7c192e0dec632318ca4c31d6b4a9af4be7806fd650c552',
      golden_query_set_id: 'code-f-golden-retrieval-query-set-20260905-v1',
      golden_ground_truth_sha256:
        'd5196727b5f5b7d53cfee0f941809266069dfc240c833dbbd604f7fabe5443ee',
      golden_metric: 'RECALL_AT_5',
      golden_threshold_authority: 'OWNER_GOVERNANCE_DECISION',
      golden_threshold_sha256: '37dcb1a42139863039162844ab1ef3dde50d6b3e6e3f26f01ff55f3a3c310074',
      current_distribution_candidate: {
        candidate_id: 'code-c-distribution-ffprobe-v2-33917303316',
        final_distribution_binding_sha256:
          '2ff105489777ffee0ae12bcab6f864097f7e34513ee1d523185415fd7047a2d6',
      },
      vulnerability_authority: {
        record_sha256: '57483e55f9f444f630dea5cf579a891cfe0a093c6912b0e63423f55cad2d7e41',
        status: 'PASS',
      },
      closure_semantics: {
        authority_records_complete: true,
        real_index_acceptance: 'READY_NOT_RUN',
        golden_retrieval_acceptance: 'READY_NOT_RUN',
        windows_low_end_acceptance: 'READY_NOT_RUN',
        code_c_version_acceptance: 'NOT_RUN',
      },
    });
    const categories = aggregate.authority_categories as JsonObject;
    expect(Object.keys(categories).sort()).toEqual([
      'golden_retrieval',
      'real_index_corpus',
      'siglip_exact_model',
      'windows_low_end_profiles',
    ]);
    expect((categories.real_index_corpus as JsonObject).minimum_authorized_real_asset_count).toBe(
      500,
    );
    expect((categories.windows_low_end_profiles as JsonObject).required_profiles).toEqual([
      'WINDOWS_4C_8GB_PROFILE',
      'WINDOWS_4C_16GB_PROFILE',
    ]);
  });
});
