import { describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_COLLECTION_MAX_ITEMS_V1,
  parseProductAssetAddIpcRequestV1,
  parseProductCreateIpcRequestV1,
  parseProductUpdateIpcRequestV1,
} from '../../apps/desktop/src/main/ipc-resource-safety.js';

const productFields = [
  'aliases',
  'contraindications',
  'selling_points',
  'forbidden_claims',
] as const;

function values(length: number): string[] {
  return Array.from({ length }, (_, index) => `value-${index}`);
}

function productRequest(field: (typeof productFields)[number], length: number) {
  return {
    schema_version: '1.0' as const,
    data: { name: '测试产品', [field]: values(length) },
  };
}

describe('Desktop IPC pre-Zod resource safety', () => {
  it.each(productFields)('allows %s at the 1024-item boundary', (field) => {
    const request = productRequest(field, EXTERNAL_COLLECTION_MAX_ITEMS_V1);
    expect(parseProductCreateIpcRequestV1(request).data[field]).toHaveLength(1024);
  });

  it('allows products:update at the 1024-item boundary', () => {
    const request = parseProductUpdateIpcRequestV1({
      ...productRequest('aliases', EXTERNAL_COLLECTION_MAX_ITEMS_V1),
      product_id: 'product-1',
    });
    expect(request.data.aliases).toHaveLength(1024);
  });

  it.each(productFields)(
    'rejects oversized products:create %s before full schema parsing',
    (field) => {
      const fullSchemaParse = vi.fn(() => {
        throw new Error('FULL_SCHEMA_PARSE_REACHED');
      });
      expect(() =>
        parseProductCreateIpcRequestV1(
          productRequest(field, EXTERNAL_COLLECTION_MAX_ITEMS_V1 + 1),
          fullSchemaParse,
        ),
      ).toThrow('INVALID_IPC_REQUEST');
      expect(fullSchemaParse).not.toHaveBeenCalled();
    },
  );

  it.each(productFields)(
    'rejects oversized products:update %s before full schema parsing',
    (field) => {
      const fullSchemaParse = vi.fn(() => {
        throw new Error('FULL_SCHEMA_PARSE_REACHED');
      });
      expect(() =>
        parseProductUpdateIpcRequestV1(
          {
            ...productRequest(field, EXTERNAL_COLLECTION_MAX_ITEMS_V1 + 1),
            product_id: 'product-1',
          },
          fullSchemaParse,
        ),
      ).toThrow('INVALID_IPC_REQUEST');
      expect(fullSchemaParse).not.toHaveBeenCalled();
    },
  );

  it('allows products:add-assets paths at the 1024-item boundary', () => {
    const request = parseProductAssetAddIpcRequestV1({
      schema_version: '1.0',
      product_id: 'product-1',
      paths: values(EXTERNAL_COLLECTION_MAX_ITEMS_V1),
      role: 'OTHER',
    });
    expect(request.paths).toHaveLength(1024);
  });

  it('rejects oversized products:add-assets paths before full schema parsing', () => {
    const fullSchemaParse = vi.fn(() => {
      throw new Error('FULL_SCHEMA_PARSE_REACHED');
    });
    expect(() =>
      parseProductAssetAddIpcRequestV1(
        {
          schema_version: '1.0',
          product_id: 'product-1',
          paths: values(EXTERNAL_COLLECTION_MAX_ITEMS_V1 + 1),
          role: 'OTHER',
        },
        fullSchemaParse,
      ),
    ).toThrow('INVALID_IPC_REQUEST');
    expect(fullSchemaParse).not.toHaveBeenCalled();
  });

  it('leaves non-array type rejection to the normal Zod parser', () => {
    let thrown: unknown;
    try {
      parseProductCreateIpcRequestV1({
        schema_version: '1.0',
        data: { name: '测试产品', aliases: 'not-an-array' },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: 'ZodError' });
  });
});
