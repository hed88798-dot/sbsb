import {
  productAssetAddRequestV1Schema,
  productCreateRequestV1Schema,
  productUpdateRequestV1Schema,
  type ProductAssetAddRequestV1,
  type ProductCreateRequestV1,
  type ProductUpdateRequestV1,
} from '@app/contracts';

export const EXTERNAL_COLLECTION_MAX_ITEMS_V1 = 1024;

type ProductDataCollectionField =
  | 'aliases'
  | 'contraindications'
  | 'selling_points'
  | 'forbidden_claims';

type Parser<T> = (input: unknown) => T;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function assertCollectionLength(value: unknown): void {
  if (Array.isArray(value) && value.length > EXTERNAL_COLLECTION_MAX_ITEMS_V1) {
    throw new Error('INVALID_IPC_REQUEST');
  }
}

function assertProductDataCollectionBounds(input: unknown): void {
  const data = record(record(input)?.data);
  if (!data) return;
  const fields: readonly ProductDataCollectionField[] = [
    'aliases',
    'contraindications',
    'selling_points',
    'forbidden_claims',
  ];
  for (const field of fields) assertCollectionLength(data[field]);
}

export function parseProductCreateIpcRequestV1(
  input: unknown,
  parse: Parser<ProductCreateRequestV1> = (value) => productCreateRequestV1Schema.parse(value),
): ProductCreateRequestV1 {
  assertProductDataCollectionBounds(input);
  return parse(input);
}

export function parseProductUpdateIpcRequestV1(
  input: unknown,
  parse: Parser<ProductUpdateRequestV1> = (value) => productUpdateRequestV1Schema.parse(value),
): ProductUpdateRequestV1 {
  assertProductDataCollectionBounds(input);
  return parse(input);
}

export function parseProductAssetAddIpcRequestV1(
  input: unknown,
  parse: Parser<ProductAssetAddRequestV1> = (value) => productAssetAddRequestV1Schema.parse(value),
): ProductAssetAddRequestV1 {
  assertCollectionLength(record(input)?.paths);
  return parse(input);
}
