import type { Database } from 'better-sqlite3';
import {
  SOURCE_DOCUMENT_HASH_SCHEME_V1,
  SOURCE_DOCUMENT_KIND_V1,
  SOURCE_DOCUMENT_OFFSET_UNIT_V1,
  canonicalSourceDocumentV1Schema,
  type CanonicalSourceDocumentV1,
} from '@app/contracts';
import { computeSourceDocumentHashV1 } from '@app/domain-copywriting';

interface SourceDocumentRow {
  source_document_id: string;
  version: number;
  source_document_hash: string;
  source_hash_scheme: string;
  source_offset_unit: string;
  source_kind: string;
  text: string;
  source_script_id: string;
  source_script_version: number;
  created_at: string;
}

export interface SourceDocumentCommitV1 {
  document: CanonicalSourceDocumentV1;
  source_script_id: string;
  source_script_version: number;
}

function trustedDocumentFromRow(row: SourceDocumentRow): CanonicalSourceDocumentV1 {
  if (
    row.source_document_id !== row.source_script_id ||
    row.version !== row.source_script_version ||
    row.source_hash_scheme !== SOURCE_DOCUMENT_HASH_SCHEME_V1 ||
    row.source_offset_unit !== SOURCE_DOCUMENT_OFFSET_UNIT_V1 ||
    row.source_kind !== SOURCE_DOCUMENT_KIND_V1 ||
    computeSourceDocumentHashV1(row.text) !== row.source_document_hash
  ) {
    throw new Error('SOURCE_DOCUMENT_STORED_INTEGRITY_MISMATCH');
  }
  try {
    return canonicalSourceDocumentV1Schema.parse({
      schema_version: '1.0',
      source_document_id: row.source_document_id,
      source_document_version: row.version,
      source_document_hash: row.source_document_hash,
      source_hash_scheme: row.source_hash_scheme,
      source_offset_unit: row.source_offset_unit,
      source_kind: row.source_kind,
      text: row.text,
      created_at: row.created_at,
    });
  } catch {
    throw new Error('SOURCE_DOCUMENT_STORED_INTEGRITY_MISMATCH');
  }
}

function sameAuthority(row: SourceDocumentRow, input: SourceDocumentCommitV1): boolean {
  const document = input.document;
  return (
    row.source_document_id === document.source_document_id &&
    row.version === document.source_document_version &&
    row.source_document_hash === document.source_document_hash &&
    row.source_hash_scheme === document.source_hash_scheme &&
    row.source_offset_unit === document.source_offset_unit &&
    row.source_kind === document.source_kind &&
    row.text === document.text &&
    row.source_script_id === input.source_script_id &&
    row.source_script_version === input.source_script_version
  );
}

export class SourceDocumentRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  getVersion(sourceDocumentId: string, version: number): CanonicalSourceDocumentV1 | null {
    if (
      sourceDocumentId.length === 0 ||
      sourceDocumentId.length > 256 ||
      sourceDocumentId.trim() !== sourceDocumentId ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      throw new Error('SOURCE_DOCUMENT_SELECTOR_INVALID');
    }
    const row = this.#row(sourceDocumentId, version);
    return row ? trustedDocumentFromRow(row) : null;
  }

  commitFromScriptVersion(inputValue: SourceDocumentCommitV1): CanonicalSourceDocumentV1 {
    const document = canonicalSourceDocumentV1Schema.parse(inputValue.document);
    const input: SourceDocumentCommitV1 = { ...inputValue, document };
    if (
      document.source_document_id !== input.source_script_id ||
      document.source_document_version !== input.source_script_version ||
      computeSourceDocumentHashV1(document.text) !== document.source_document_hash
    ) {
      throw new Error('SOURCE_DOCUMENT_COMMIT_INTEGRITY_MISMATCH');
    }

    const operation = this.#db.transaction(() => {
      const existing = this.#row(document.source_document_id, document.source_document_version);
      if (existing) {
        if (!sameAuthority(existing, input)) {
          throw new Error('SOURCE_DOCUMENT_IDEMPOTENCY_CONFLICT');
        }
        return trustedDocumentFromRow(existing);
      }
      const provenance = this.#db
        .prepare(
          `SELECT * FROM source_document_versions
           WHERE source_script_id = ? AND source_script_version = ?`,
        )
        .get(input.source_script_id, input.source_script_version) as SourceDocumentRow | undefined;
      if (provenance) throw new Error('SOURCE_DOCUMENT_IDEMPOTENCY_CONFLICT');

      this.#db
        .prepare(
          `INSERT INTO source_document_versions(
            source_document_id, version, source_document_hash, source_hash_scheme,
            source_offset_unit, source_kind, text, source_script_id, source_script_version,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          document.source_document_id,
          document.source_document_version,
          document.source_document_hash,
          document.source_hash_scheme,
          document.source_offset_unit,
          document.source_kind,
          document.text,
          input.source_script_id,
          input.source_script_version,
          document.created_at,
        );
      const committed = this.#row(document.source_document_id, document.source_document_version);
      if (!committed) throw new Error('SOURCE_DOCUMENT_COMMIT_MISSING_AFTER_INSERT');
      return trustedDocumentFromRow(committed);
    });
    return operation.immediate();
  }

  #row(sourceDocumentId: string, version: number): SourceDocumentRow | undefined {
    return this.#db
      .prepare(
        `SELECT source_document_id, version, source_document_hash, source_hash_scheme,
          source_offset_unit, source_kind, text, source_script_id, source_script_version,
          created_at
         FROM source_document_versions
         WHERE source_document_id = ? AND version = ?`,
      )
      .get(sourceDocumentId, version) as SourceDocumentRow | undefined;
  }
}
