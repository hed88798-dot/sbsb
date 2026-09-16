import {
  SOURCE_DOCUMENT_HASH_SCHEME_V1,
  SOURCE_DOCUMENT_KIND_V1,
  SOURCE_DOCUMENT_OFFSET_UNIT_V1,
  canonicalSourceDocumentV1Schema,
  type CanonicalSourceDocumentV1,
} from '@app/contracts';
import { computeSourceDocumentHashV1 } from '@app/domain-copywriting';
import type { CopywritingRepository, SourceDocumentRepository } from '@app/local-db';

export interface ExactScriptVersionSelectorV1 {
  script_id: string;
  script_version: number;
}

export class SourceDocumentAuthorityService {
  readonly #scripts: Pick<CopywritingRepository, 'getScriptVersion'>;
  readonly #sourceDocuments: Pick<
    SourceDocumentRepository,
    'getVersion' | 'commitFromScriptVersion'
  >;
  readonly #clock: () => string;

  constructor(options: {
    scripts: Pick<CopywritingRepository, 'getScriptVersion'>;
    sourceDocuments: Pick<SourceDocumentRepository, 'getVersion' | 'commitFromScriptVersion'>;
    clock?: () => string;
  }) {
    this.#scripts = options.scripts;
    this.#sourceDocuments = options.sourceDocuments;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  ensureFromScriptVersion(selector: ExactScriptVersionSelectorV1): CanonicalSourceDocumentV1 {
    if (
      typeof selector?.script_id !== 'string' ||
      selector.script_id.length === 0 ||
      selector.script_id.length > 256 ||
      selector.script_id.trim() !== selector.script_id ||
      typeof selector.script_version !== 'number' ||
      !Number.isSafeInteger(selector.script_version) ||
      selector.script_version < 1
    ) {
      throw new Error('SOURCE_DOCUMENT_SELECTOR_INVALID');
    }
    const source = this.#scripts.getScriptVersion(selector.script_id, selector.script_version);
    if (!source) throw new Error('SOURCE_DOCUMENT_SOURCE_SCRIPT_VERSION_NOT_FOUND');
    if (source.result_status !== 'SUCCEEDED') {
      throw new Error('SOURCE_DOCUMENT_SOURCE_REVIEW_REQUIRED');
    }

    const document = canonicalSourceDocumentV1Schema.parse({
      schema_version: '1.0',
      source_document_id: source.script_id,
      source_document_version: source.version,
      source_document_hash: computeSourceDocumentHashV1(source.text),
      source_hash_scheme: SOURCE_DOCUMENT_HASH_SCHEME_V1,
      source_offset_unit: SOURCE_DOCUMENT_OFFSET_UNIT_V1,
      source_kind: SOURCE_DOCUMENT_KIND_V1,
      text: source.text,
      created_at: this.#clock(),
    });
    return this.#sourceDocuments.commitFromScriptVersion({
      document,
      source_script_id: source.script_id,
      source_script_version: source.version,
    });
  }
}
