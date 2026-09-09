import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { canonicalJson, sha256 } from './signature.js';

export interface EmbeddingTruthRow {
  shotId: string;
  assetId: string;
  revision: number;
  startMs: number;
  endMs: number;
  vectorF16: Uint8Array;
}

export interface SearchCacheManifestV1 {
  schema_version: '1.0';
  generation_id: string;
  signature_hash: string;
  dimension: number;
  row_count: number;
  matrix_file: string;
  matrix_sha256: string;
  row_map_file: string;
  row_map_sha256: string;
  created_at: string;
}

export interface SearchCacheRowV1 {
  shot_id: string;
  asset_id: string;
  revision: number;
  start_ms: number;
  end_ms: number;
}

interface SearchRowMapV1 {
  schema_version: '1.0';
  generation_id: string;
  signature_hash: string;
  dimension: number;
  rows: SearchCacheRowV1[];
}

async function hashPath(path: string): Promise<string> {
  const digest = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      digest.update(chunk);
    });
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return digest.digest('hex');
}

export async function buildSearchCache(options: {
  cacheRoot: string;
  generationId: string;
  signatureHash: string;
  dimension: number;
  rows: EmbeddingTruthRow[];
}): Promise<SearchCacheManifestV1> {
  if (options.dimension <= 0 || !Number.isInteger(options.dimension))
    throw new Error('INVALID_DIMENSION');
  if (basename(options.generationId) !== options.generationId) {
    throw new Error('CACHE_GENERATION_INVALID');
  }
  if (!/^[a-f0-9]{64}$/u.test(options.signatureHash)) throw new Error('CACHE_SIGNATURE_INVALID');
  const bytesPerRow = options.dimension * 2;
  const shotIds = new Set<string>();
  for (const row of options.rows) {
    if (row.vectorF16.byteLength !== bytesPerRow) throw new Error('VECTOR_DIMENSION_MISMATCH');
    if (!(row.startMs >= 0 && row.endMs > row.startMs && row.revision > 0)) {
      throw new Error('INVALID_ROW_MAPPING');
    }
    if (shotIds.has(row.shotId)) throw new Error('DUPLICATE_SHOT_ROW');
    shotIds.add(row.shotId);
  }
  await mkdir(options.cacheRoot, { recursive: true });
  const temporaryDirectory = join(
    options.cacheRoot,
    `.building-${options.generationId}-${process.pid}-${Date.now()}`,
  );
  const generationDirectory = join(options.cacheRoot, options.generationId);
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const matrixPath = join(temporaryDirectory, 'matrix.f16');
    const handle = await open(matrixPath, 'w');
    try {
      for (const row of options.rows) await handle.write(row.vectorF16);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const rowMap: SearchRowMapV1 = {
      schema_version: '1.0',
      generation_id: options.generationId,
      signature_hash: options.signatureHash,
      dimension: options.dimension,
      rows: options.rows.map((row) => ({
        shot_id: row.shotId,
        asset_id: row.assetId,
        revision: row.revision,
        start_ms: row.startMs,
        end_ms: row.endMs,
      })),
    };
    const rowMapText = canonicalJson(rowMap);
    const rowMapPath = join(temporaryDirectory, 'rows.json');
    await writeFile(rowMapPath, rowMapText, 'utf8');
    const manifest: SearchCacheManifestV1 = {
      schema_version: '1.0',
      generation_id: options.generationId,
      signature_hash: options.signatureHash,
      dimension: options.dimension,
      row_count: options.rows.length,
      matrix_file: 'matrix.f16',
      matrix_sha256: await hashPath(matrixPath),
      row_map_file: 'rows.json',
      row_map_sha256: sha256(rowMapText),
      created_at: new Date().toISOString(),
    };
    await writeFile(join(temporaryDirectory, 'manifest.json'), canonicalJson(manifest), 'utf8');
    await rename(temporaryDirectory, generationDirectory);
    const activeTemporary = join(options.cacheRoot, `.active-${process.pid}-${Date.now()}.tmp`);
    await writeFile(
      activeTemporary,
      canonicalJson({ generation_id: options.generationId, signature_hash: options.signatureHash }),
      'utf8',
    );
    await rename(activeTemporary, join(options.cacheRoot, 'active.json'));
    return manifest;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function safeCacheFile(directory: string, name: string): string {
  if (basename(name) !== name) throw new Error('CACHE_PATH_INVALID');
  return resolve(directory, name);
}

export async function verifySearchCache(options: {
  cacheRoot: string;
  expectedSignatureHash: string;
}): Promise<{ manifest: SearchCacheManifestV1; rows: SearchRowMapV1['rows']; directory: string }> {
  const active = JSON.parse(await readFile(join(options.cacheRoot, 'active.json'), 'utf8')) as {
    generation_id?: string;
    signature_hash?: string;
  };
  if (active.signature_hash !== options.expectedSignatureHash)
    throw new Error('CACHE_SIGNATURE_MISMATCH');
  if (!active.generation_id || basename(active.generation_id) !== active.generation_id) {
    throw new Error('CACHE_GENERATION_INVALID');
  }
  const directory = join(options.cacheRoot, active.generation_id);
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8'),
  ) as SearchCacheManifestV1;
  if (
    manifest.signature_hash !== options.expectedSignatureHash ||
    manifest.generation_id !== active.generation_id
  ) {
    throw new Error('CACHE_SIGNATURE_MISMATCH');
  }
  const matrixPath = safeCacheFile(directory, manifest.matrix_file);
  const rowMapPath = safeCacheFile(directory, manifest.row_map_file);
  if ((await hashPath(matrixPath)) !== manifest.matrix_sha256)
    throw new Error('CACHE_MATRIX_HASH_MISMATCH');
  const rowMapText = await readFile(rowMapPath, 'utf8');
  if (sha256(rowMapText) !== manifest.row_map_sha256)
    throw new Error('CACHE_ROW_MAP_HASH_MISMATCH');
  const rowMap = JSON.parse(rowMapText) as SearchRowMapV1;
  if (
    rowMap.generation_id !== manifest.generation_id ||
    rowMap.signature_hash !== manifest.signature_hash ||
    rowMap.dimension !== manifest.dimension ||
    rowMap.rows.length !== manifest.row_count
  ) {
    throw new Error('CACHE_ROW_MAPPING_MISMATCH');
  }
  const matrix = await readFile(matrixPath);
  if (matrix.byteLength !== manifest.row_count * manifest.dimension * 2) {
    throw new Error('CACHE_ROW_MAPPING_MISMATCH');
  }
  return { manifest, rows: rowMap.rows, directory };
}

export function float32ToFloat16(value: number): number {
  const float = new Float32Array(1);
  const integer = new Uint32Array(float.buffer);
  float[0] = value;
  const bits = integer[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    return sign | ((mantissa | 0x800000) >>> (1 - exponent + 13));
  }
  if (exponent >= 31) return sign | 0x7c00;
  return sign | (exponent << 10) | (mantissa >>> 13);
}

export function float16ToFloat32(bits: number): number {
  const sign = (bits & 0x8000) !== 0 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export function encodeNormalizedVector(vector: readonly number[]): Uint8Array {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('INVALID_ZERO_VECTOR');
  const output = new Uint8Array(vector.length * 2);
  const view = new DataView(output.buffer);
  vector.forEach((value, index) => view.setUint16(index * 2, float32ToFloat16(value / norm), true));
  return output;
}
