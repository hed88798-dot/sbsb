import { lstatSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { canonicalJson, hashFile, sha256 } from '@app/domain-media-index';
import {
  narrationAudioExecutionRefV1Schema,
  parseNarrationAudioArtifactV1,
  type NarrationAudioArtifactV1,
  type NarrationAudioExecutionRefV1,
} from '@app/render';

interface NarrationArtifactRow {
  narration_audio_id: string;
  artifact_id: string;
  artifact_sha256: string;
  duration_ms: number;
  codec: string;
  container: string;
  sample_rate_hz: number;
  channels: number;
  channel_layout: string;
  size_bytes: number;
  artifact_hash: string;
  artifact_json: string;
  registered_at: string;
}

interface NarrationLocationRow {
  location_id: string;
  narration_audio_id: string;
  normalized_path: string;
  location_status: 'PRESENT' | 'MISSING';
  last_seen_at: string;
}

async function verifyLocalFile(path: string, expectedHash: string, expectedSize: number) {
  const requested = resolve(path);
  if (lstatSync(requested).isSymbolicLink()) throw new Error('NARRATION_LOCATION_INVALID');
  const real = realpathSync(requested);
  const stats = statSync(real);
  if (!stats.isFile() || stats.size !== expectedSize) {
    throw new Error('NARRATION_ARTIFACT_NOT_EXECUTABLE');
  }
  if ((await hashFile(real)) !== expectedHash) {
    throw new Error('NARRATION_ARTIFACT_HASH_MISMATCH');
  }
  return real;
}

export class NarrationAudioRepository {
  readonly #db: Database;
  readonly #clock: () => string;

  constructor(db: Database, options: { clock?: () => string } = {}) {
    this.#db = db;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async register(input: {
    artifact: NarrationAudioArtifactV1;
    trusted_local_path: string;
  }): Promise<NarrationAudioArtifactV1> {
    const artifact = parseNarrationAudioArtifactV1(input.artifact);
    const resolvedPath = await verifyLocalFile(
      input.trusted_local_path,
      artifact.artifact_sha256,
      artifact.size_bytes,
    );
    const bytes = canonicalJson(artifact);
    const existing = this.#artifactRow(artifact.narration_audio_id);
    const operation = this.#db.transaction(() => {
      if (existing) {
        if (existing.artifact_hash !== artifact.artifact_hash || existing.artifact_json !== bytes) {
          throw new Error('NARRATION_AUDIO_IDENTITY_CONFLICT');
        }
      } else {
        this.#db
          .prepare(
            `INSERT INTO narration_audio_artifacts(
              narration_audio_id, artifact_id, artifact_sha256, duration_ms, codec, container,
              sample_rate_hz, channels, channel_layout, size_bytes, artifact_hash, artifact_json,
              registered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            artifact.narration_audio_id,
            artifact.artifact_id,
            artifact.artifact_sha256,
            artifact.duration_ms,
            artifact.codec,
            artifact.container,
            artifact.sample_rate_hz,
            artifact.channels,
            artifact.channel_layout,
            artifact.size_bytes,
            artifact.artifact_hash,
            bytes,
            this.#clock(),
          );
      }
      this.#upsertLocation(artifact.narration_audio_id, resolvedPath);
    });
    operation.immediate();
    return this.requireArtifact(artifact.narration_audio_id);
  }

  async addTrustedLocation(narrationAudioId: string, trustedLocalPath: string): Promise<void> {
    const artifact = this.requireArtifact(narrationAudioId);
    const resolvedPath = await verifyLocalFile(
      trustedLocalPath,
      artifact.artifact_sha256,
      artifact.size_bytes,
    );
    this.#upsertLocation(artifact.narration_audio_id, resolvedPath);
  }

  requireArtifact(narrationAudioId: string): NarrationAudioArtifactV1 {
    const row = this.#artifactRow(narrationAudioId);
    if (!row) throw new Error('NARRATION_AUDIO_ARTIFACT_NOT_FOUND');
    const artifact = parseNarrationAudioArtifactV1(JSON.parse(row.artifact_json) as unknown);
    if (
      canonicalJson(artifact) !== row.artifact_json ||
      artifact.narration_audio_id !== row.narration_audio_id ||
      artifact.artifact_id !== row.artifact_id ||
      artifact.artifact_sha256 !== row.artifact_sha256 ||
      artifact.duration_ms !== row.duration_ms ||
      artifact.codec !== row.codec ||
      artifact.container !== row.container ||
      artifact.sample_rate_hz !== row.sample_rate_hz ||
      artifact.channels !== row.channels ||
      artifact.channel_layout !== row.channel_layout ||
      artifact.size_bytes !== row.size_bytes ||
      artifact.artifact_hash !== row.artifact_hash
    ) {
      throw new Error('NARRATION_AUDIO_STORED_INTEGRITY_MISMATCH');
    }
    return artifact;
  }

  async resolveExact(input: {
    narration_audio_id: string;
    expected_sha256: string;
  }): Promise<NarrationAudioExecutionRefV1> {
    const artifact = this.requireArtifact(input.narration_audio_id);
    if (artifact.artifact_sha256 !== input.expected_sha256) {
      throw new Error('NARRATION_AUDIO_TIMELINE_HASH_MISMATCH');
    }
    const locations = this.#db
      .prepare(
        `SELECT * FROM narration_audio_locations
         WHERE narration_audio_id = ? AND location_status = 'PRESENT'
         ORDER BY normalized_path`,
      )
      .all(artifact.narration_audio_id) as NarrationLocationRow[];
    for (const location of locations) {
      try {
        const resolvedPath = await verifyLocalFile(
          location.normalized_path,
          artifact.artifact_sha256,
          artifact.size_bytes,
        );
        return narrationAudioExecutionRefV1Schema.parse({
          schema_version: '1.0',
          narration_audio_id: artifact.narration_audio_id,
          artifact_id: artifact.artifact_id,
          artifact_sha256: artifact.artifact_sha256,
          duration_ms: artifact.duration_ms,
          duration_measurement: artifact.duration_measurement,
          sample_count: artifact.sample_count,
          codec: artifact.codec,
          container: artifact.container,
          sample_rate_hz: artifact.sample_rate_hz,
          channels: artifact.channels,
          channel_layout: artifact.channel_layout,
          size_bytes: artifact.size_bytes,
          producer_ref: artifact.producer_ref,
          provenance_ref: artifact.provenance_ref,
          resolved_source_path: resolvedPath,
          verified_file_sha256: artifact.artifact_sha256,
          resolved_at: this.#clock(),
        });
      } catch {
        continue;
      }
    }
    throw new Error('NARRATION_AUDIO_ARTIFACT_NOT_EXECUTABLE');
  }

  #artifactRow(narrationAudioId: string): NarrationArtifactRow | undefined {
    return this.#db
      .prepare('SELECT * FROM narration_audio_artifacts WHERE narration_audio_id = ?')
      .get(narrationAudioId) as NarrationArtifactRow | undefined;
  }

  #upsertLocation(narrationAudioId: string, normalizedPath: string): void {
    this.#db
      .prepare(
        `INSERT INTO narration_audio_locations(
          location_id, narration_audio_id, normalized_path, location_status, last_seen_at
        ) VALUES (?, ?, ?, 'PRESENT', ?)
        ON CONFLICT(normalized_path) DO UPDATE SET
          narration_audio_id = excluded.narration_audio_id,
          location_status = 'PRESENT',
          last_seen_at = excluded.last_seen_at`,
      )
      .run(
        `narration_location_${sha256(normalizedPath).slice(0, 32)}`,
        narrationAudioId,
        normalizedPath,
        this.#clock(),
      );
  }
}
