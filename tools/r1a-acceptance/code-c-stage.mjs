import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  assetRevisionManifestV1Schema,
  mediaArtifactResultV1Schema,
  shotSearchFiltersV1Schema,
} from '../../packages/contracts/dist/index.js';
import {
  buildSearchCache,
  canonicalJson,
  createIndexGenerationSignature,
  hashFile,
  hydrateSearchCandidates,
  sha256,
} from '../../packages/domain-media-index/dist/index.js';
import { callSidecar } from '../../apps/desktop/dist-electron/main/sidecar-client.js';

function request(config, requestId, method, payload) {
  return callSidecar({
    executablePath: config.worker.executable_path,
    args: config.worker.arguments,
    ...(config.worker.working_directory ? { cwd: config.worker.working_directory } : {}),
    timeoutMs: config.worker.timeout_ms,
    request: {
      type: 'request',
      protocol_version: '1.0',
      request_id: requestId,
      method,
      payload,
    },
  });
}

function resultPayload(events, errorCode) {
  const failure = events.find((event) => event.type === 'error');
  if (failure) throw new Error(`${errorCode}: ${failure.error?.code ?? 'WORKER_ERROR'}`);
  const result = events.find((event) => event.type === 'result');
  if (!result?.payload) throw new Error(errorCode);
  return result.payload;
}

export async function runCodeCStage({ config, acceptanceRoot, repository, ffprobePath }) {
  const detector = JSON.parse(await readFile(config.shot_detector_config_path, 'utf8'));
  if (detector === null || typeof detector !== 'object' || Array.isArray(detector)) {
    throw new Error('CODE_C_INDEX_FAILED');
  }
  if (
    detector.parameters === null ||
    typeof detector.parameters !== 'object' ||
    Array.isArray(detector.parameters)
  ) {
    throw new Error('CODE_C_INDEX_FAILED');
  }
  const manifests = [];
  for (const [index, media] of config.media.entries()) {
    let payload;
    try {
      const events = await request(
        config,
        `${config.acceptance_id}_index_${index}`,
        'media.index.asset.v1',
        {
          input_path: media.source_path,
          output_dir: join(acceptanceRoot, 'code-c', 'index', media.asset_id),
          asset_id: media.asset_id,
          revision: media.revision,
          ffprobe_path: ffprobePath,
          shot_detector_parameters: detector.parameters,
          embedding_model_version: config.embedding_model_version,
          embedding_preprocess_version: config.embedding_preprocess_version,
          model_root: config.model_root,
          dimension: config.embedding_dimension,
        },
      );
      payload = mediaArtifactResultV1Schema.parse(resultPayload(events, 'CODE_C_INDEX_FAILED'));
      const manifest = assetRevisionManifestV1Schema.parse(
        JSON.parse(await readFile(payload.manifest_path, 'utf8')),
      );
      if (
        (await hashFile(payload.manifest_path)) !== payload.manifest_sha256 ||
        (await hashFile(media.source_path)) !== manifest.file_hash ||
        manifest.asset_id !== media.asset_id ||
        manifest.revision !== media.revision ||
        resolve(manifest.source_path) !== resolve(media.source_path) ||
        manifest.index_signature_hash !== payload.index_signature_hash
      ) {
        throw new Error('CODE_C_INDEX_FAILED');
      }
      repository.commitAssetRevision({
        manifest,
        manifestSha256: payload.manifest_sha256,
      });
      manifests.push(manifest);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CODE_C_INDEX_FAILED')) throw error;
      throw new Error('CODE_C_INDEX_FAILED', { cause: error });
    }
  }
  const generationKeys = new Set(manifests.map((manifest) => manifest.generation_key_hash));
  if (generationKeys.size !== 1) throw new Error('CODE_C_INDEX_FAILED');
  const generationKeyHash = manifests[0]?.generation_key_hash;
  if (!generationKeyHash) throw new Error('CODE_C_INDEX_FAILED');
  const assets = manifests.map((manifest) => ({
    assetId: manifest.asset_id,
    revision: manifest.revision,
    fileHash: manifest.file_hash,
    indexSignatureHash: manifest.index_signature_hash,
  }));
  const signatureHash = createIndexGenerationSignature({ generationKeyHash, assets });
  const generationId = `r1a_${sha256(canonicalJson({ acceptance: config.acceptance_id, signatureHash })).slice(0, 32)}`;
  const cacheRoot = join(acceptanceRoot, 'code-c', 'search-cache');
  await buildSearchCache({
    cacheRoot,
    generationId,
    signatureHash,
    dimension: config.embedding_dimension,
    rows: repository.listActiveEmbeddingTruth(generationKeyHash),
  });
  const cacheManifestPath = join(cacheRoot, generationId, 'manifest.json');
  repository.publishIndexGeneration({
    generationId,
    indexSignatureHash: signatureHash,
    cacheManifestSha256: await hashFile(cacheManifestPath),
    assets: assets.map(({ assetId, revision }) => ({ assetId, revision })),
  });

  const selections = [];
  for (const [index, search] of config.searches.entries()) {
    try {
      const filters = shotSearchFiltersV1Schema.parse(search.filters);
      const descriptors = repository.listSearchableShots(generationKeyHash, filters);
      const allowedShotIds = descriptors.map((row) => row.shotId);
      const events = await request(
        config,
        `${config.acceptance_id}_search_${index}`,
        'media.search.exact.v1',
        {
          cache_root: cacheRoot,
          signature_hash: signatureHash,
          model_root: config.model_root,
          dimension: config.embedding_dimension,
          query_text: search.query_text,
          top_k: search.top_k,
          allowed_shot_ids: allowedShotIds,
        },
      );
      const raw = resultPayload(events, 'CODE_C_RETRIEVAL_FAILED').candidates;
      if (!Array.isArray(raw)) throw new Error('CODE_C_RETRIEVAL_FAILED');
      selections.push({
        intent: {
          schema_version: '1.0',
          selection_request_id: search.selection_request_id,
          batch_id: search.batch_id,
          video_id: search.video_id,
          slot_id: search.slot_id,
          material_family: search.material_family,
          candidate_set_id: search.candidate_set_id,
          candidate_set_contract_version: 'code-c-shot-search-v1',
        },
        eligibleCandidates: hydrateSearchCandidates(raw, descriptors),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CODE_C_RETRIEVAL_FAILED')) {
        throw error;
      }
      throw new Error('CODE_C_RETRIEVAL_FAILED', { cause: error });
    }
  }
  return selections;
}
