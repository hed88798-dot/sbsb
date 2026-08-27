import { createHash } from 'node:crypto';
import { indexSignatureInputV1Schema, type IndexSignatureInputV1 } from '@app/contracts';

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

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createIndexSignature(input: IndexSignatureInputV1): {
  input: IndexSignatureInputV1;
  hash: string;
} {
  const parsed = indexSignatureInputV1Schema.parse(input);
  return { input: parsed, hash: sha256(canonicalJson(parsed)) };
}

export function createEmbeddingGenerationKey(input: IndexSignatureInputV1): string {
  const parsed = indexSignatureInputV1Schema.parse(input);
  const generationInput = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== 'file_hash'),
  );
  return sha256(canonicalJson(generationInput));
}

export function createIndexGenerationSignature(input: {
  generationKeyHash: string;
  assets: Array<{
    assetId: string;
    revision: number;
    fileHash: string;
    indexSignatureHash: string;
  }>;
}): string {
  const assets = [...input.assets].sort(
    (left, right) => left.assetId.localeCompare(right.assetId) || left.revision - right.revision,
  );
  return sha256(canonicalJson({ generation_key_hash: input.generationKeyHash, assets }));
}
