import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { assetRevisionManifestV1Schema, mediaArtifactResultV1Schema } from '@app/contracts';
import {
  buildSearchCache,
  createIndexGenerationSignature,
  hashFile,
  verifySearchCache,
} from '@app/domain-media-index';
import type { MediaIndexRepository } from '@app/local-db';
import { callSidecar } from './sidecar-client.js';
import { commitDemoWorkerManifest } from './demo-local-media.js';

const path = z.string().refine(isAbsolute, 'absolute path required');
const configSchema = z
  .object({
    runtime_activation_verified: z.literal(true),
    worker: z
      .object({ executablePath: path, args: z.array(z.string()).optional(), cwd: path.optional() })
      .strict(),
    ffprobe_path: path,
    model_root: path,
    output_root: path,
    cache_root: path,
    embedding_model_version: z.string().min(1),
    embedding_preprocess_version: z.string().min(1),
    dimension: z.number().int().positive(),
    shot_detector_parameters: z.record(z.string(), z.unknown()),
    media: z
      .array(
        z
          .object({
            source_path: path,
            asset_id: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
            revision: z.number().int().positive(),
          })
          .strict(),
      )
      .min(3)
      .max(20),
  })
  .strict();

// Developer-only composition, using paths already activated by the runtime trust chain.
// The assertion is an operator prerequisite, never a runtime approval mechanism.
export async function indexDemoMedia(value: unknown, repository: MediaIndexRepository) {
  const config = configSchema.parse(value);
  if (new Set(config.media.map((item) => item.asset_id)).size !== config.media.length)
    throw new Error('DEMO_DUPLICATE_ASSET');
  const manifests = [];
  const run = randomUUID();
  for (const item of config.media) {
    const output = join(config.output_root, run, item.asset_id);
    const events = await callSidecar({
      executablePath: config.worker.executablePath,
      ...(config.worker.args ? { args: config.worker.args } : {}),
      ...(config.worker.cwd ? { cwd: config.worker.cwd } : {}),
      timeoutMs: 120000,
      request: {
        type: 'request',
        protocol_version: '1.0',
        request_id: `demo_index_${randomUUID()}`,
        method: 'media.index.asset.v1',
        payload: {
          input_path: item.source_path,
          output_dir: output,
          asset_id: item.asset_id,
          revision: item.revision,
          ffprobe_path: config.ffprobe_path,
          model_root: config.model_root,
          embedding_model_version: config.embedding_model_version,
          embedding_preprocess_version: config.embedding_preprocess_version,
          dimension: config.dimension,
          shot_detector_parameters: config.shot_detector_parameters,
        },
      },
    });
    const result = events.at(-1);
    if (result?.type !== 'result')
      throw new Error(`DEMO_INDEX_FAILED:${result?.error?.code ?? 'NO_RESULT'}`);
    const artifact = mediaArtifactResultV1Schema.parse(result.payload);
    const manifest = assetRevisionManifestV1Schema.parse(
      JSON.parse(await readFile(artifact.manifest_path, 'utf8')),
    );
    if (
      manifest.asset_id !== item.asset_id ||
      manifest.revision !== item.revision ||
      manifest.index_signature_hash !== artifact.index_signature_hash
    )
      throw new Error('DEMO_INDEX_IDENTITY_MISMATCH');
    await commitDemoWorkerManifest({
      output_root: output,
      manifest_path: artifact.manifest_path,
      expected_manifest_sha256: artifact.manifest_sha256,
      source_path: item.source_path,
      repository,
    });
    manifests.push(manifest);
  }
  const keys = new Set(manifests.map((manifest) => manifest.generation_key_hash));
  if (keys.size !== 1) throw new Error('DEMO_INDEX_GENERATION_MISMATCH');
  const generationKey = manifests[0]!.generation_key_hash;
  const rows = repository.listActiveEmbeddingTruth(generationKey);
  const assets = manifests.map((manifest) => ({
    assetId: manifest.asset_id,
    revision: manifest.revision,
    fileHash: manifest.file_hash,
    indexSignatureHash: manifest.index_signature_hash,
  }));
  if (
    !rows.length ||
    rows.some(
      (row) =>
        row.dimension !== config.dimension ||
        !assets.some((asset) => asset.assetId === row.assetId && asset.revision === row.revision),
    )
  )
    throw new Error('DEMO_CACHE_REQUIRES_EXACT_IMPORTED_ASSETS');
  const signature = createIndexGenerationSignature({ generationKeyHash: generationKey, assets });
  const generationId = `demo_${run}`;
  // A unique cache root isolates interrupted publication from any previous active cache.
  const cacheRoot = join(config.cache_root, generationId);
  const cache = await buildSearchCache({
    cacheRoot,
    generationId,
    signatureHash: signature,
    dimension: config.dimension,
    rows,
  });
  await verifySearchCache({ cacheRoot, expectedSignatureHash: signature });
  repository.publishIndexGeneration({
    generationId,
    indexSignatureHash: signature,
    cacheManifestSha256: await hashFile(join(cacheRoot, generationId, 'manifest.json')),
    assets,
  });
  return {
    generation_key_hash: generationKey,
    signature_hash: signature,
    cache_root: cacheRoot,
    generation_id: generationId,
    real_video_count: manifests.length,
    row_count: cache.row_count,
  };
}
