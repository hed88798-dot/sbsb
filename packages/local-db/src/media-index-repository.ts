import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Database } from 'better-sqlite3';
import {
  assetRevisionManifestV1Schema,
  visualDescriptorV1Schema,
  type AssetRevisionManifestV1,
  type MediaIndexJobStepV1,
  type MediaIndexJobV1,
  type ShotSearchFiltersV1,
  type VisualDescriptorV1,
} from '@app/contracts';

export interface ActiveEmbeddingTruthRow {
  embeddingId: string;
  shotId: string;
  assetId: string;
  revision: number;
  startMs: number;
  endMs: number;
  dimension: number;
  vectorF16: Buffer;
  vectorSha256: string;
}

export interface SearchableShotRow {
  assetId: string;
  shotId: string;
  revision: number;
  startMs: number;
  endMs: number;
  descriptor: VisualDescriptorV1;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function artifactPath(root: string, path: string): string {
  if (isAbsolute(path) || basename(path) === '') throw new Error('MEDIA_ARTIFACT_PATH_INVALID');
  const resolvedRoot = realpathSync(root);
  const requested = resolve(resolvedRoot, path);
  if (lstatSync(requested).isSymbolicLink()) throw new Error('MEDIA_ARTIFACT_PATH_INVALID');
  const resolved = realpathSync(requested);
  const fromRoot = relative(resolvedRoot, resolved);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('MEDIA_ARTIFACT_PATH_ESCAPE');
  }
  return resolved;
}

export class MediaIndexRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  commitAssetRevision(input: {
    manifest: AssetRevisionManifestV1;
    manifestSha256: string;
    fileIdentity?: string | null;
  }): void {
    const manifest = assetRevisionManifestV1Schema.parse(input.manifest);
    const signatureHash = sha256(JSON.stringify(canonicalize(manifest.index_signature)));
    if (signatureHash !== manifest.index_signature_hash) throw new Error('INDEX_SIGNATURE_INVALID');
    const generationKeyInput = Object.fromEntries(
      Object.entries(manifest.index_signature).filter(([key]) => key !== 'file_hash'),
    );
    const generationKeyHash = sha256(JSON.stringify(canonicalize(generationKeyInput)));
    if (generationKeyHash !== manifest.generation_key_hash) {
      throw new Error('GENERATION_KEY_INVALID');
    }
    if (!/^[a-f0-9]{64}$/u.test(input.manifestSha256)) throw new Error('MANIFEST_HASH_INVALID');
    const existing = this.#db
      .prepare(
        `SELECT r.manifest_sha256, a.active_revision
         FROM asset_revisions r JOIN media_assets a ON a.asset_id = r.asset_id
         WHERE r.asset_id = ? AND r.revision = ?`,
      )
      .get(manifest.asset_id, manifest.revision) as
      | { manifest_sha256: string; active_revision: number | null }
      | undefined;
    if (existing) {
      if (
        existing.manifest_sha256 === input.manifestSha256 &&
        existing.active_revision === manifest.revision
      ) {
        return;
      }
      throw new Error('ASSET_REVISION_CONFLICT');
    }
    const vectors = manifest.shots.map((shot) => {
      const path = artifactPath(manifest.artifact_root, shot.embedding.relative_path);
      const vector = readFileSync(path);
      if (sha256(vector) !== shot.embedding.sha256) throw new Error('EMBEDDING_HASH_MISMATCH');
      if (vector.byteLength !== shot.embedding.dimension * 2) {
        throw new Error('EMBEDDING_DIMENSION_MISMATCH');
      }
      for (const keyframe of shot.keyframes) {
        const keyframeFile = artifactPath(manifest.artifact_root, keyframe.relative_path);
        if (sha256(readFileSync(keyframeFile)) !== keyframe.sha256) {
          throw new Error('KEYFRAME_HASH_MISMATCH');
        }
      }
      return vector;
    });
    const now = new Date().toISOString();
    const commit = this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO media_assets(asset_id, file_hash, media_type, status, active_revision, created_at, updated_at)
           VALUES (?, ?, 'video', 'ACTIVE', NULL, ?, ?)
           ON CONFLICT(asset_id) DO UPDATE SET file_hash = excluded.file_hash, status = 'ACTIVE', updated_at = excluded.updated_at`,
        )
        .run(manifest.asset_id, manifest.file_hash, now, now);
      this.#db
        .prepare(
          `INSERT INTO media_asset_locations(
             location_id, asset_id, source_path, normalized_path, size_bytes, mtime_ns,
             file_identity, location_status, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PRESENT', ?)
           ON CONFLICT(normalized_path) DO UPDATE SET
             asset_id = excluded.asset_id, size_bytes = excluded.size_bytes, mtime_ns = excluded.mtime_ns,
             file_identity = excluded.file_identity, location_status = 'PRESENT', last_seen_at = excluded.last_seen_at`,
        )
        .run(
          `location_${sha256(manifest.source_path).slice(0, 32)}`,
          manifest.asset_id,
          manifest.source_path,
          resolve(manifest.source_path),
          manifest.size_bytes,
          manifest.mtime_ns,
          input.fileIdentity ?? null,
          now,
        );
      this.#db
        .prepare(
          `INSERT INTO asset_revisions(
             asset_id, revision, file_hash, duration_ms, width, height, rotation, fps,
             index_signature_hash, generation_key_hash, index_signature_json, manifest_sha256,
             worker_version, state, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?)`,
        )
        .run(
          manifest.asset_id,
          manifest.revision,
          manifest.file_hash,
          manifest.duration_ms,
          manifest.width,
          manifest.height,
          manifest.rotation,
          manifest.fps,
          manifest.index_signature_hash,
          manifest.generation_key_hash,
          JSON.stringify(canonicalize(manifest.index_signature)),
          input.manifestSha256,
          manifest.worker_version,
          manifest.created_at,
        );
      const insertShot = this.#db.prepare(
        `INSERT INTO shots(shot_id, asset_id, revision, start_ms, end_ms, quality_score, analysis_status)
         VALUES (?, ?, ?, ?, ?, ?, 'READY')`,
      );
      const insertKeyframe = this.#db.prepare(
        `INSERT INTO keyframes(
           keyframe_id, shot_id, role, timestamp_ms, artifact_path, artifact_sha256, quality_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertDescriptor = this.#db.prepare(
        `INSERT INTO visual_descriptors(shot_id, schema_version, descriptor_json) VALUES (?, ?, ?)`,
      );
      const insertEmbedding = this.#db.prepare(
        `INSERT INTO embeddings(
           embedding_id, shot_id, model_id, model_version, preprocess_version, dimension,
           dtype, normalized, vector_f16, vector_sha256, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'float16', 1, ?, ?, ?)`,
      );
      manifest.shots.forEach((shot, index) => {
        insertShot.run(
          shot.shot_id,
          manifest.asset_id,
          manifest.revision,
          shot.start_ms,
          shot.end_ms,
          shot.quality.score,
        );
        for (const keyframe of shot.keyframes) {
          insertKeyframe.run(
            keyframe.keyframe_id,
            shot.shot_id,
            keyframe.role,
            keyframe.timestamp_ms,
            resolve(manifest.artifact_root, keyframe.relative_path),
            keyframe.sha256,
            JSON.stringify(keyframe.quality),
          );
        }
        insertDescriptor.run(
          shot.shot_id,
          shot.descriptor.schema_version,
          JSON.stringify(shot.descriptor),
        );
        insertEmbedding.run(
          shot.embedding.embedding_id,
          shot.shot_id,
          shot.embedding.model_id,
          shot.embedding.model_version,
          shot.embedding.preprocess_version,
          shot.embedding.dimension,
          vectors[index],
          shot.embedding.sha256,
          now,
        );
      });
      this.#db
        .prepare('UPDATE media_assets SET active_revision = ?, updated_at = ? WHERE asset_id = ?')
        .run(manifest.revision, now, manifest.asset_id);
    });
    commit.immediate();
  }

  listActiveEmbeddingTruth(generationKeyHash: string): ActiveEmbeddingTruthRow[] {
    const rows = this.#db
      .prepare(
        `SELECT e.embedding_id, s.shot_id, s.asset_id, s.revision, s.start_ms, s.end_ms,
                e.dimension, e.vector_f16, e.vector_sha256
         FROM media_assets a
         JOIN asset_revisions r ON r.asset_id = a.asset_id AND r.revision = a.active_revision
         JOIN shots s ON s.asset_id = r.asset_id AND s.revision = r.revision
         JOIN embeddings e ON e.shot_id = s.shot_id
         WHERE a.status = 'ACTIVE' AND r.state = 'READY' AND r.generation_key_hash = ?
         ORDER BY s.asset_id, s.revision, s.start_ms, s.shot_id`,
      )
      .all(generationKeyHash) as Array<{
      embedding_id: string;
      shot_id: string;
      asset_id: string;
      revision: number;
      start_ms: number;
      end_ms: number;
      dimension: number;
      vector_f16: Buffer;
      vector_sha256: string;
    }>;
    return rows.map((row) => ({
      embeddingId: row.embedding_id,
      shotId: row.shot_id,
      assetId: row.asset_id,
      revision: row.revision,
      startMs: row.start_ms,
      endMs: row.end_ms,
      dimension: row.dimension,
      vectorF16: row.vector_f16,
      vectorSha256: row.vector_sha256,
    }));
  }

  listSearchableShots(
    generationKeyHash: string,
    filters: ShotSearchFiltersV1,
  ): SearchableShotRow[] {
    const rows = this.#db
      .prepare(
        `SELECT s.asset_id, s.shot_id, s.revision, s.start_ms, s.end_ms, d.descriptor_json
         FROM media_assets a
         JOIN asset_revisions r ON r.asset_id = a.asset_id AND r.revision = a.active_revision
         JOIN shots s ON s.asset_id = r.asset_id AND s.revision = r.revision
         JOIN visual_descriptors d ON d.shot_id = s.shot_id
         WHERE a.status = 'ACTIVE' AND r.state = 'READY' AND r.generation_key_hash = ?
         ORDER BY s.asset_id, s.start_ms, s.shot_id`,
      )
      .all(generationKeyHash) as Array<{
      asset_id: string;
      shot_id: string;
      revision: number;
      start_ms: number;
      end_ms: number;
      descriptor_json: string;
    }>;
    return rows
      .map((row) => ({
        assetId: row.asset_id,
        shotId: row.shot_id,
        revision: row.revision,
        startMs: row.start_ms,
        endMs: row.end_ms,
        descriptor: visualDescriptorV1Schema.parse(JSON.parse(row.descriptor_json) as unknown),
      }))
      .filter((row) => {
        const descriptor = row.descriptor;
        const duration = row.endMs - row.startMs;
        if (
          filters.minimum_quality !== undefined &&
          descriptor.quality.score < filters.minimum_quality
        ) {
          return false;
        }
        if (filters.minimum_duration_ms !== undefined && duration < filters.minimum_duration_ms) {
          return false;
        }
        if (filters.maximum_duration_ms !== undefined && duration > filters.maximum_duration_ms) {
          return false;
        }
        if (
          filters.species &&
          descriptor.species !== 'unknown' &&
          !descriptor.species.some((value) => filters.species?.includes(value))
        ) {
          return false;
        }
        if (
          filters.scene &&
          descriptor.scene !== 'unknown' &&
          !filters.scene.includes(descriptor.scene)
        ) {
          return false;
        }
        if (
          filters.people_present !== undefined &&
          descriptor.people_present !== null &&
          descriptor.people_present !== filters.people_present
        ) {
          return false;
        }
        if (
          filters.product_present !== undefined &&
          descriptor.product_present !== null &&
          descriptor.product_present !== filters.product_present
        ) {
          return false;
        }
        return true;
      });
  }

  publishIndexGeneration(input: {
    generationId: string;
    indexSignatureHash: string;
    cacheManifestSha256: string;
    assets: Array<{ assetId: string; revision: number }>;
  }): void {
    const revisionRows = input.assets.map((asset) => {
      const row = this.#db
        .prepare(
          `SELECT file_hash, index_signature_hash, generation_key_hash, state
           FROM asset_revisions WHERE asset_id = ? AND revision = ?`,
        )
        .get(asset.assetId, asset.revision) as
        | {
            file_hash: string;
            index_signature_hash: string;
            generation_key_hash: string;
            state: string;
          }
        | undefined;
      if (!row || row.state !== 'READY') throw new Error('INDEX_GENERATION_ASSET_NOT_READY');
      return { asset, row };
    });
    const generationKeys = new Set(revisionRows.map(({ row }) => row.generation_key_hash));
    if (generationKeys.size !== 1) throw new Error('INDEX_GENERATION_KEY_MISMATCH');
    const generationKeyHash = revisionRows[0]?.row.generation_key_hash;
    if (!generationKeyHash) throw new Error('INDEX_GENERATION_EMPTY');
    const generationSignature = sha256(
      JSON.stringify(
        canonicalize({
          generation_key_hash: generationKeyHash,
          assets: revisionRows
            .map(({ asset, row }) => ({
              assetId: asset.assetId,
              revision: asset.revision,
              fileHash: row.file_hash,
              indexSignatureHash: row.index_signature_hash,
            }))
            .sort(
              (left, right) =>
                left.assetId.localeCompare(right.assetId) || left.revision - right.revision,
            ),
        }),
      ),
    );
    if (generationSignature !== input.indexSignatureHash) {
      throw new Error('INDEX_GENERATION_SIGNATURE_INVALID');
    }
    const now = new Date().toISOString();
    const publish = this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO index_generations(
             generation_id, index_signature_hash, state, active, cache_manifest_sha256, created_at, completed_at
           ) VALUES (?, ?, 'READY', 0, ?, ?, ?)`,
        )
        .run(input.generationId, input.indexSignatureHash, input.cacheManifestSha256, now, now);
      const insertAsset = this.#db.prepare(
        'INSERT INTO index_generation_assets(generation_id, asset_id, revision) VALUES (?, ?, ?)',
      );
      for (const asset of input.assets)
        insertAsset.run(input.generationId, asset.assetId, asset.revision);
      this.#db.prepare('UPDATE index_generations SET active = 0 WHERE active = 1').run();
      this.#db
        .prepare('UPDATE index_generations SET active = 1 WHERE generation_id = ?')
        .run(input.generationId);
    });
    publish.immediate();
  }

  markMissing(assetId: string): void {
    const now = new Date().toISOString();
    this.#db
      .prepare("UPDATE media_assets SET status = 'MISSING', updated_at = ? WHERE asset_id = ?")
      .run(now, assetId);
    this.#db
      .prepare(
        "UPDATE media_asset_locations SET location_status = 'MISSING', last_seen_at = ? WHERE asset_id = ?",
      )
      .run(now, assetId);
  }

  recordAssetLocation(input: {
    assetId: string;
    sourcePath: string;
    normalizedPath: string;
    sizeBytes: number;
    mtimeNs: string;
    fileIdentity?: string | null;
  }): void {
    const now = new Date().toISOString();
    const update = this.#db.transaction(() => {
      const asset = this.#db
        .prepare('SELECT asset_id FROM media_assets WHERE asset_id = ?')
        .get(input.assetId);
      if (!asset) throw new Error('MEDIA_ASSET_NOT_FOUND');
      this.#db
        .prepare(
          `INSERT INTO media_asset_locations(
             location_id, asset_id, source_path, normalized_path, size_bytes, mtime_ns,
             file_identity, location_status, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PRESENT', ?)
           ON CONFLICT(normalized_path) DO UPDATE SET
             asset_id = excluded.asset_id, source_path = excluded.source_path,
             size_bytes = excluded.size_bytes, mtime_ns = excluded.mtime_ns,
             file_identity = excluded.file_identity, location_status = 'PRESENT',
             last_seen_at = excluded.last_seen_at`,
        )
        .run(
          `location_${sha256(input.normalizedPath).slice(0, 32)}`,
          input.assetId,
          input.sourcePath,
          input.normalizedPath,
          input.sizeBytes,
          input.mtimeNs,
          input.fileIdentity ?? null,
          now,
        );
      this.#db
        .prepare("UPDATE media_assets SET status = 'ACTIVE', updated_at = ? WHERE asset_id = ?")
        .run(now, input.assetId);
    });
    update.immediate();
  }

  markAssetLocationMissing(normalizedPath: string): void {
    const now = new Date().toISOString();
    const update = this.#db.transaction(() => {
      const location = this.#db
        .prepare('SELECT asset_id FROM media_asset_locations WHERE normalized_path = ?')
        .get(normalizedPath) as { asset_id: string } | undefined;
      if (!location) return;
      this.#db
        .prepare(
          "UPDATE media_asset_locations SET location_status = 'MISSING', last_seen_at = ? WHERE normalized_path = ?",
        )
        .run(now, normalizedPath);
      const present = this.#db
        .prepare(
          "SELECT count(*) FROM media_asset_locations WHERE asset_id = ? AND location_status = 'PRESENT'",
        )
        .pluck()
        .get(location.asset_id) as number;
      if (present === 0) {
        this.#db
          .prepare("UPDATE media_assets SET status = 'MISSING', updated_at = ? WHERE asset_id = ?")
          .run(now, location.asset_id);
      }
    });
    update.immediate();
  }

  createIndexJob(input: {
    jobId: string;
    sourceFolderId?: string | null;
    profile: MediaIndexJobV1['profile'];
  }): MediaIndexJobV1 {
    const now = new Date().toISOString();
    this.#db
      .prepare(
        `INSERT INTO media_index_jobs(job_id, source_folder_id, profile, checkpoint_json, created_at)
         VALUES (?, ?, ?, '{}', ?)`,
      )
      .run(input.jobId, input.sourceFolderId ?? null, input.profile, now);
    return {
      schema_version: '1.0',
      job_id: input.jobId,
      source_folder_id: input.sourceFolderId ?? null,
      profile: input.profile,
      checkpoint: {},
      created_at: now,
    };
  }

  recordIndexJobStep(
    input: Omit<MediaIndexJobStepV1, 'schema_version' | 'updated_at'>,
  ): MediaIndexJobStepV1 {
    const now = new Date().toISOString();
    this.#db
      .prepare(
        `INSERT INTO media_index_job_steps(
           job_id, asset_id, revision, stage, state, checkpoint_json, error_code, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id, asset_id, revision, stage) DO UPDATE SET
           state = excluded.state, checkpoint_json = excluded.checkpoint_json,
           error_code = excluded.error_code, updated_at = excluded.updated_at`,
      )
      .run(
        input.job_id,
        input.asset_id,
        input.revision,
        input.stage,
        input.state,
        JSON.stringify(input.checkpoint),
        input.error_code,
        now,
      );
    return { schema_version: '1.0', ...input, updated_at: now };
  }
}
