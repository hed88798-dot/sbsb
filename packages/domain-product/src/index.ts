import { createHash } from 'node:crypto';
import {
  productFactSnapshotV1Schema,
  type ProductDTOv1,
  type ProductFactSnapshotV1,
} from '@app/contracts';

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function createProductFactSnapshot(product: ProductDTOv1): ProductFactSnapshotV1 {
  const facts = {
    schema_version: '1.0' as const,
    product_id: product.product_id,
    name: product.name,
    aliases: product.aliases,
    ingredients: product.ingredients,
    specification: product.specification,
    target_object: product.target_object,
    approved_scope: product.approved_scope,
    usage: product.usage,
    contraindications: product.contraindications,
    forbidden_claims: product.forbidden_claims,
  };
  return productFactSnapshotV1Schema.parse({ ...facts, snapshot_hash: sha256(facts) });
}
