import { z } from 'zod';

export const SOURCE_DOCUMENT_HASH_SCHEME_V1 = 'SHA256_UTF8_EXACT_V1' as const;
export const SOURCE_DOCUMENT_OFFSET_UNIT_V1 = 'UNICODE_CODE_POINT' as const;
export const SOURCE_DOCUMENT_KIND_V1 = 'SCRIPT_VERSION' as const;

const sourceDocumentIdentityV1Schema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value, 'source document identity must not have padding');

export const canonicalSourceDocumentV1Schema = z
  .object({
    schema_version: z.literal('1.0'),
    source_document_id: sourceDocumentIdentityV1Schema,
    source_document_version: z.number().int().positive(),
    source_document_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    source_hash_scheme: z.literal(SOURCE_DOCUMENT_HASH_SCHEME_V1),
    source_offset_unit: z.literal(SOURCE_DOCUMENT_OFFSET_UNIT_V1),
    source_kind: z.literal(SOURCE_DOCUMENT_KIND_V1),
    text: z.string(),
    created_at: z.string().datetime(),
  })
  .strict();

export type CanonicalSourceDocumentV1 = z.infer<typeof canonicalSourceDocumentV1Schema>;
