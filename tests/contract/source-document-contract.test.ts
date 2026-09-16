import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  SOURCE_DOCUMENT_HASH_SCHEME_V1,
  canonicalSourceDocumentV1Schema,
} from '../../packages/contracts/src/index.js';

const valid = {
  schema_version: '1.0',
  source_document_id: 'script_1',
  source_document_version: 1,
  source_document_hash: 'a'.repeat(64),
  source_hash_scheme: SOURCE_DOCUMENT_HASH_SCHEME_V1,
  source_offset_unit: 'UNICODE_CODE_POINT',
  source_kind: 'SCRIPT_VERSION',
  text: '',
  created_at: '2026-09-17T00:00:00.000Z',
} as const;

const jsonSchema = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../schemas/source-document/v1/canonical-source-document.schema.json',
    ),
    'utf8',
  ),
) as object;

describe('CanonicalSourceDocumentV1 contract', () => {
  it('accepts the strict frozen SCRIPT_VERSION authority', () => {
    expect(canonicalSourceDocumentV1Schema.parse(valid)).toEqual(valid);
  });

  it('ships an equivalent strict JSON Schema 2020-12 contract', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(jsonSchema);
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, extra: true })).toBe(false);
    expect(validate({ ...valid, source_hash_scheme: 'SHA256_NORMALIZED_V1' })).toBe(false);
  });

  it('allows exact empty content because persisted Script Version text permits it', () => {
    expect(canonicalSourceDocumentV1Schema.parse({ ...valid, text: '' }).text).toBe('');
  });

  it.each([
    ['source_hash_scheme', 'SHA256_NORMALIZED_V1'],
    ['source_offset_unit', 'UTF16_CODE_UNIT'],
    ['source_kind', 'JOB_RESULT'],
  ])('rejects a non-frozen %s', (field, value) => {
    expect(() => canonicalSourceDocumentV1Schema.parse({ ...valid, [field]: value })).toThrow();
  });

  it('rejects unknown fields and non-lowercase hashes', () => {
    expect(() => canonicalSourceDocumentV1Schema.parse({ ...valid, extra: true })).toThrow();
    expect(() =>
      canonicalSourceDocumentV1Schema.parse({ ...valid, source_document_hash: 'A'.repeat(64) }),
    ).toThrow();
  });
});
