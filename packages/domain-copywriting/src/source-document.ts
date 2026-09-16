import { createHash } from 'node:crypto';
import { SOURCE_DOCUMENT_HASH_SCHEME_V1 } from '@app/contracts';

export { SOURCE_DOCUMENT_HASH_SCHEME_V1 };

/**
 * Frozen V1 source authority: SHA-256 over the exact UTF-8 bytes of the persisted string.
 * No normalization, trimming, newline conversion, serialization, or metadata participates.
 */
export function computeSourceDocumentHashV1(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
