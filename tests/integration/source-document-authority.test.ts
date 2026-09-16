import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SourceDocumentAuthorityService } from '../../apps/desktop/src/main/source-document-authority-service.js';
import { computeSourceDocumentHashV1 } from '../../packages/domain-copywriting/src/index.js';
import {
  CopywritingRepository,
  SourceDocumentRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
const now = '2026-09-17T01:02:03.000Z';
let database: Database;
let sourceDocuments: SourceDocumentRepository;
let service: SourceDocumentAuthorityService;

function insertScript(input: {
  scriptId: string;
  version?: number;
  text: string;
  status?: 'SUCCEEDED' | 'REVIEW_REQUIRED';
}): void {
  const version = input.version ?? 1;
  database
    .prepare(
      `INSERT OR IGNORE INTO scripts(script_id, product_id, current_version, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?)`,
    )
    .run(input.scriptId, version, now, now);
  database
    .prepare(
      `INSERT INTO script_versions(
        script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
        fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
        provider_model, request_snapshot_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, '[]', 'test', '1', 'mock', 'mock', ?, ?)`,
    )
    .run(
      input.scriptId,
      version,
      input.text,
      input.text,
      input.status ?? 'SUCCEEDED',
      'a'.repeat(64),
      now,
    );
}

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'source-document-authority-'));
  const opened = await openDatabase({ dbPath: join(directory, 'app.db'), migrationsDirectory });
  database = opened.db;
  sourceDocuments = new SourceDocumentRepository(database);
  service = new SourceDocumentAuthorityService({
    scripts: new CopywritingRepository(database),
    sourceDocuments,
    clock: () => now,
  });
});

afterEach(() => {
  if (database.open) database.close();
});

describe('Canonical Source Document authority', () => {
  it('promotes an exact successful Script Version without normalizing its text', () => {
    const text = '  产品A\r\n每袋100g e\u0301  ';
    insertScript({ scriptId: 'script_exact', version: 3, text });

    const document = service.ensureFromScriptVersion({
      script_id: 'script_exact',
      script_version: 3,
    });

    expect(document).toMatchObject({
      source_document_id: 'script_exact',
      source_document_version: 3,
      source_document_hash: computeSourceDocumentHashV1(text),
      source_hash_scheme: 'SHA256_UTF8_EXACT_V1',
      source_offset_unit: 'UNICODE_CODE_POINT',
      source_kind: 'SCRIPT_VERSION',
      text,
      created_at: now,
    });
  });

  it('is idempotent and creates exactly one row', () => {
    insertScript({ scriptId: 'script_replay', text: '同一份内容' });
    const first = service.ensureFromScriptVersion({
      script_id: 'script_replay',
      script_version: 1,
    });
    const second = service.ensureFromScriptVersion({
      script_id: 'script_replay',
      script_version: 1,
    });
    expect(second).toEqual(first);
    expect(database.prepare('SELECT COUNT(*) FROM source_document_versions').pluck().get()).toBe(1);
  });

  it('requires and binds the requested exact version instead of scripts.current_version', () => {
    insertScript({ scriptId: 'script_versions', version: 1, text: '版本一' });
    insertScript({ scriptId: 'script_versions', version: 2, text: '版本二' });
    database
      .prepare("UPDATE scripts SET current_version = 2 WHERE script_id = 'script_versions'")
      .run();
    const document = service.ensureFromScriptVersion({
      script_id: 'script_versions',
      script_version: 1,
    });
    expect(document.source_document_version).toBe(1);
    expect(document.text).toBe('版本一');
  });

  it('rejects REVIEW_REQUIRED and missing exact versions', () => {
    insertScript({ scriptId: 'script_review', text: '待审核', status: 'REVIEW_REQUIRED' });
    expect(() =>
      service.ensureFromScriptVersion({ script_id: 'script_review', script_version: 1 }),
    ).toThrow('SOURCE_DOCUMENT_SOURCE_REVIEW_REQUIRED');
    expect(() =>
      service.ensureFromScriptVersion({ script_id: 'script_review', script_version: 2 }),
    ).toThrow('SOURCE_DOCUMENT_SOURCE_SCRIPT_VERSION_NOT_FOUND');
    expect(database.prepare('SELECT COUNT(*) FROM source_document_versions').pluck().get()).toBe(0);
  });

  it('rejects UPDATE and DELETE for committed authority rows', () => {
    insertScript({ scriptId: 'script_immutable', text: '冻结内容' });
    service.ensureFromScriptVersion({ script_id: 'script_immutable', script_version: 1 });
    expect(() =>
      database
        .prepare(
          "UPDATE source_document_versions SET text = 'changed' WHERE source_document_id = 'script_immutable'",
        )
        .run(),
    ).toThrow('SOURCE_DOCUMENT_VERSIONS_APPEND_ONLY');
    expect(() =>
      database
        .prepare(
          "DELETE FROM source_document_versions WHERE source_document_id = 'script_immutable'",
        )
        .run(),
    ).toThrow('SOURCE_DOCUMENT_VERSIONS_APPEND_ONLY');
  });

  it('rejects a stored row whose hash was tampered', () => {
    insertScript({ scriptId: 'script_hash', text: '原文' });
    service.ensureFromScriptVersion({ script_id: 'script_hash', script_version: 1 });
    database.exec('DROP TRIGGER source_document_versions_reject_update');
    database
      .prepare(
        "UPDATE source_document_versions SET source_document_hash = ? WHERE source_document_id = 'script_hash'",
      )
      .run('f'.repeat(64));
    expect(() => sourceDocuments.getVersion('script_hash', 1)).toThrow(
      'SOURCE_DOCUMENT_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('rejects a stored row whose hash scheme was tampered', () => {
    insertScript({ scriptId: 'script_scheme', text: '原文' });
    service.ensureFromScriptVersion({ script_id: 'script_scheme', script_version: 1 });
    database.exec(
      'DROP TRIGGER source_document_versions_reject_update; PRAGMA ignore_check_constraints = ON;',
    );
    database
      .prepare(
        "UPDATE source_document_versions SET source_hash_scheme = 'SECRET_V2' WHERE source_document_id = 'script_scheme'",
      )
      .run();
    database.pragma('ignore_check_constraints = OFF');
    expect(() => sourceDocuments.getVersion('script_scheme', 1)).toThrow(
      'SOURCE_DOCUMENT_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('rejects stored provenance that no longer maps identity and version', () => {
    insertScript({ scriptId: 'script_provenance', text: '原文' });
    service.ensureFromScriptVersion({ script_id: 'script_provenance', script_version: 1 });
    database.exec(
      'DROP TRIGGER source_document_versions_reject_update; PRAGMA ignore_check_constraints = ON;',
    );
    database
      .prepare(
        "UPDATE source_document_versions SET source_document_id = 'tampered_document' WHERE source_document_id = 'script_provenance'",
      )
      .run();
    database.pragma('ignore_check_constraints = OFF');
    expect(() => sourceDocuments.getVersion('tampered_document', 1)).toThrow(
      'SOURCE_DOCUMENT_STORED_INTEGRITY_MISMATCH',
    );
  });

  it('keeps the committed snapshot unchanged if the originating script row is later mutated', () => {
    insertScript({ scriptId: 'script_origin', text: '首次冻结' });
    const committed = service.ensureFromScriptVersion({
      script_id: 'script_origin',
      script_version: 1,
    });
    database
      .prepare("UPDATE script_versions SET text = '被外部修改' WHERE script_id = 'script_origin'")
      .run();
    expect(sourceDocuments.getVersion('script_origin', 1)).toEqual(committed);
    expect(sourceDocuments.getVersion('script_origin', 1)?.text).toBe('首次冻结');
  });

  it('supports the exact empty Script Version content already permitted by Copywriting', () => {
    insertScript({ scriptId: 'script_empty', text: '' });
    const document = service.ensureFromScriptVersion({
      script_id: 'script_empty',
      script_version: 1,
    });
    expect(document.text).toBe('');
    expect(document.source_document_hash).toBe(computeSourceDocumentHashV1(''));
  });
});
