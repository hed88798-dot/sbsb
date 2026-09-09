import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetRevisionManifestV1 } from '@app/contracts';
import {
  createEmbeddingGenerationKey,
  createIndexGenerationSignature,
  createIndexSignature,
  encodeNormalizedVector,
} from '../../packages/domain-media-index/src/index.js';
import {
  JobRepository,
  MediaIndexRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
let directory: string;
let database: Database;
let repository: MediaIndexRepository;

function hash(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function makeManifest(
  revision: number,
  fileHash: string,
  assetId = 'asset_test',
): AssetRevisionManifestV1 {
  const artifactRoot = join(directory, `job-${assetId}-${revision}`);
  mkdirSync(join(artifactRoot, 'keyframes'), { recursive: true });
  mkdirSync(join(artifactRoot, 'embeddings'), { recursive: true });
  const vector = encodeNormalizedVector(revision === 1 ? [1, 0, 0, 0] : [0, 1, 0, 0]);
  const keyframe = Buffer.from(`synthetic-keyframe-${revision}`);
  writeFileSync(join(artifactRoot, 'keyframes', 'frame.jpg'), keyframe);
  writeFileSync(join(artifactRoot, 'embeddings', 'shot.f16'), vector);
  const signature = createIndexSignature({
    index_schema_version: '1.0',
    index_signature_version: '1.0',
    embedding_model: 'google/siglip2-base-patch32-256',
    embedding_model_version: 'official-revision',
    embedding_preprocess_version: 'preprocess-v1',
    vlm_model: null,
    vlm_model_version: null,
    vlm_prompt_version: null,
    shot_detector: 'PySceneDetect.AdaptiveDetector',
    shot_detector_version: '0.7.1',
    shot_detector_params_hash: '1'.repeat(64),
    keyframe_policy_version: 'safe-mid-best-v1',
    file_hash: fileHash,
  });
  const shotId = assetId === 'asset_test' ? `shot_${revision}` : `shot_${assetId}_${revision}`;
  const embeddingId = `embedding_${assetId}_${revision}`;
  const quality = { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 };
  return {
    schema_version: '1.0',
    asset_id: assetId,
    revision,
    source_path: join(directory, `${assetId}.mp4`),
    file_hash: fileHash,
    size_bytes: 100,
    mtime_ns: String(revision),
    duration_ms: 1000,
    width: 1920,
    height: 1080,
    rotation: 0,
    fps: 30,
    index_signature: signature.input,
    index_signature_hash: signature.hash,
    generation_key_hash: createEmbeddingGenerationKey(signature.input),
    artifact_root: artifactRoot,
    shots: [
      {
        shot_id: shotId,
        start_ms: 0,
        end_ms: 1000,
        keyframes: [
          {
            keyframe_id: `keyframe_${assetId}_${revision}`,
            role: 'MIDPOINT',
            timestamp_ms: 500,
            relative_path: 'keyframes/frame.jpg',
            sha256: hash(keyframe),
            quality,
          },
        ],
        quality,
        descriptor: {
          schema_version: '1.0',
          shot_id: shotId,
          species: 'unknown',
          scene: 'unknown',
          action: 'unknown',
          health_state: 'unknown',
          people_present: null,
          product_present: null,
          shot_type: 'unknown',
          description: '',
          quality,
          embedding_ref: embeddingId,
          industry_metadata: { veterinary: {} },
          confidence: {},
          provenance: { vlm: 'OFF' },
          evidence: {
            motion_sensitive_guard: {
              value: null,
              confidence: 0,
              provenance: 'static-keyframes-only',
              temporal_evidence: 'INSUFFICIENT',
            },
          },
        },
        embedding: {
          embedding_id: embeddingId,
          model_id: 'google/siglip2-base-patch32-256',
          model_version: 'official-revision',
          preprocess_version: 'preprocess-v1',
          dimension: 4,
          dtype: 'float16',
          normalized: true,
          relative_path: 'embeddings/shot.f16',
          sha256: hash(vector),
        },
      },
    ],
    worker_version: '0.3.0',
    created_at: '2026-08-27T00:00:00.000Z',
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'media-index-repository-'));
  writeFileSync(join(directory, 'source.mp4'), 'source');
  const opened = await openDatabase({ dbPath: join(directory, 'app.db'), migrationsDirectory });
  database = opened.db;
  repository = new MediaIndexRepository(database);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('Main-owned media index commit', () => {
  it('atomically switches a complete revision and keeps the old revision on artifact failure', () => {
    const first = makeManifest(1, 'a'.repeat(64));
    repository.commitAssetRevision({ manifest: first, manifestSha256: 'c'.repeat(64) });
    expect(() =>
      repository.commitAssetRevision({ manifest: first, manifestSha256: 'c'.repeat(64) }),
    ).not.toThrow();
    expect(repository.listActiveEmbeddingTruth(first.generation_key_hash)).toMatchObject([
      { assetId: 'asset_test', shotId: 'shot_1', revision: 1, startMs: 0, endMs: 1000 },
    ]);
    expect(
      repository.listSearchableShots(first.generation_key_hash, { species: ['pig'] }),
    ).toHaveLength(1);
    const knownConflict = {
      ...first.shots[0]!.descriptor,
      species: ['chicken'],
    };
    database
      .prepare('UPDATE visual_descriptors SET descriptor_json = ? WHERE shot_id = ?')
      .run(JSON.stringify(knownConflict), 'shot_1');
    expect(
      repository.listSearchableShots(first.generation_key_hash, { species: ['pig'] }),
    ).toHaveLength(0);

    const second = makeManifest(2, 'b'.repeat(64));
    writeFileSync(join(second.artifact_root, 'embeddings', 'shot.f16'), Buffer.alloc(2));
    expect(() =>
      repository.commitAssetRevision({ manifest: second, manifestSha256: 'd'.repeat(64) }),
    ).toThrow('EMBEDDING_HASH_MISMATCH');
    expect(
      database
        .prepare('SELECT active_revision FROM media_assets WHERE asset_id = ?')
        .pluck()
        .get('asset_test'),
    ).toBe(1);
    expect(database.prepare('SELECT count(*) FROM shots WHERE revision = 2').pluck().get()).toBe(0);
  });

  it('publishes a new index generation in one transaction', () => {
    const manifest = makeManifest(1, 'a'.repeat(64));
    repository.commitAssetRevision({ manifest, manifestSha256: 'c'.repeat(64) });
    const generationSignature = createIndexGenerationSignature({
      generationKeyHash: manifest.generation_key_hash,
      assets: [
        {
          assetId: manifest.asset_id,
          revision: manifest.revision,
          fileHash: manifest.file_hash,
          indexSignatureHash: manifest.index_signature_hash,
        },
      ],
    });
    repository.publishIndexGeneration({
      generationId: 'generation_old',
      indexSignatureHash: generationSignature,
      cacheManifestSha256: 'd'.repeat(64),
      assets: [{ assetId: 'asset_test', revision: 1 }],
    });
    repository.publishIndexGeneration({
      generationId: 'generation_new',
      indexSignatureHash: generationSignature,
      cacheManifestSha256: 'e'.repeat(64),
      assets: [{ assetId: 'asset_test', revision: 1 }],
    });
    expect(
      database
        .prepare('SELECT generation_id FROM index_generations WHERE active = 1')
        .pluck()
        .get(),
    ).toBe('generation_new');
    expect(database.prepare('SELECT count(*) FROM index_generations').pluck().get()).toBe(2);
  });

  it('uses a shared generation key without dropping Assets that have different file hashes', () => {
    const first = makeManifest(1, 'a'.repeat(64));
    const second = makeManifest(1, 'b'.repeat(64), 'asset_two');
    repository.commitAssetRevision({ manifest: first, manifestSha256: 'c'.repeat(64) });
    repository.commitAssetRevision({ manifest: second, manifestSha256: 'd'.repeat(64) });
    expect(first.generation_key_hash).toBe(second.generation_key_hash);
    expect(repository.listActiveEmbeddingTruth(first.generation_key_hash)).toMatchObject([
      { assetId: 'asset_test', revision: 1 },
      { assetId: 'asset_two', revision: 1 },
    ]);
  });

  it('records a same-hash move without creating a new revision or embedding', () => {
    const manifest = makeManifest(1, 'a'.repeat(64));
    repository.commitAssetRevision({ manifest, manifestSha256: 'c'.repeat(64) });
    repository.recordAssetLocation({
      assetId: manifest.asset_id,
      sourcePath: join(directory, '移动 后.mp4'),
      normalizedPath: join(directory, '移动 后.mp4'),
      sizeBytes: manifest.size_bytes,
      mtimeNs: manifest.mtime_ns,
    });
    repository.markAssetLocationMissing(resolve(manifest.source_path));
    expect(database.prepare('SELECT active_revision FROM media_assets').pluck().get()).toBe(1);
    expect(database.prepare('SELECT count(*) FROM embeddings').pluck().get()).toBe(1);
    expect(
      database
        .prepare("SELECT count(*) FROM media_asset_locations WHERE location_status = 'PRESENT'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  it('records resumable per-Asset stage checkpoints under the public Job', () => {
    const job = new JobRepository(database).create('MEDIA_INDEX', 'a'.repeat(64));
    repository.createIndexJob({ jobId: job.job_id, profile: 'BALANCED' });
    const step = repository.recordIndexJobStep({
      job_id: job.job_id,
      asset_id: 'asset_test',
      revision: 1,
      stage: 'EMBEDDING',
      state: 'INTERRUPTED',
      checkpoint: { completed_shots: 3 },
      error_code: 'APP_INTERRUPTED',
    });
    expect(step.checkpoint).toEqual({ completed_shots: 3 });
    expect(
      database
        .prepare('SELECT checkpoint_json FROM media_index_job_steps WHERE job_id = ?')
        .pluck()
        .get(job.job_id),
    ).toBe('{"completed_shots":3}');
  });
});
