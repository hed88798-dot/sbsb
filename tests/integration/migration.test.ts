import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../packages/local-db/src/index.js';

const cleanupDirectories: string[] = [];
const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirectories.push(directory);
  return directory;
}

afterEach(() => {
  cleanupDirectories.length = 0;
});

describe('desktop SQLite migrations', () => {
  it('migrates an empty database to version 9 with WAL and foreign keys', async () => {
    const dbPath = join(temporaryDirectory('desktop-empty-'), 'app.db');
    const { db, migration } = await openDatabase({ dbPath, migrationsDirectory });
    expect(migration.currentVersion).toBe(9);
    expect(migration.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(migration.backupPath).toBeNull();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'products',
        'product_aliases',
        'product_assets',
        'scripts',
        'script_versions',
        'jobs',
        'copywriting_jobs',
        'provider_call_summaries',
        'app_settings',
        'media_assets',
        'asset_revisions',
        'shots',
        'embeddings',
        'index_generations',
        'material_selection_decisions',
        'timeline_plan_versions',
        'render_policy_versions',
        'narration_audio_artifacts',
        'narration_audio_locations',
        'render_jobs',
        'render_execution_snapshots',
        'render_artifacts',
        'render_receipts',
        'render_execution_attempts',
        'render_output_recoverability_observations',
        'source_document_versions',
        'shot_plan_candidates',
        'shot_plan_lineages',
        'confirmed_shot_plan_versions',
      ]),
    );
    db.close();
  });

  it('backs up and upgrades a legacy fixture', async () => {
    const directory = temporaryDirectory('desktop-legacy-');
    const dbPath = join(directory, 'app.db');
    const legacy = new BetterSqlite3(dbPath);
    legacy.exec(
      "CREATE TABLE legacy_fixture(value TEXT); INSERT INTO legacy_fixture VALUES ('kept')",
    );
    legacy.close();
    const { db, migration } = await openDatabase({ dbPath, migrationsDirectory });
    expect(migration.backupPath).not.toBeNull();
    expect(existsSync(migration.backupPath!)).toBe(true);
    expect(db.prepare('SELECT value FROM legacy_fixture').pluck().get()).toBe('kept');
    db.close();
  });

  it('upgrades the Code C version-2 schema to Code D version 3 without rewriting history', async () => {
    const directory = temporaryDirectory('desktop-v2-upgrade-');
    const dbPath = join(directory, 'app.db');
    const v2Migrations = join(directory, 'v2-migrations');
    mkdirSync(v2Migrations);
    for (const filename of ['001_initial.sql', '002_media_index_v1.sql']) {
      copyFileSync(join(migrationsDirectory, filename), join(v2Migrations, filename));
    }
    const v2 = await openDatabase({ dbPath, migrationsDirectory: v2Migrations });
    expect(v2.migration.currentVersion).toBe(2);
    v2.db.close();

    const upgraded = await openDatabase({ dbPath, migrationsDirectory });
    expect(upgraded.migration.currentVersion).toBe(9);
    expect(upgraded.migration.appliedVersions).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(upgraded.migration.backupPath).not.toBeNull();
    expect(
      upgraded.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'material_selection_decisions'",
        )
        .pluck()
        .get(),
    ).toBe('material_selection_decisions');
    expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    upgraded.db.close();

    const replay = await openDatabase({ dbPath, migrationsDirectory });
    expect(replay.migration.currentVersion).toBe(9);
    expect(replay.migration.appliedVersions).toEqual([]);
    replay.db.close();
  });

  it('upgrades the Code D version-3 schema to Code E version 4 without rewriting history', async () => {
    const directory = temporaryDirectory('desktop-v3-upgrade-');
    const dbPath = join(directory, 'app.db');
    const v3Migrations = join(directory, 'v3-migrations');
    mkdirSync(v3Migrations);
    for (const filename of [
      '001_initial.sql',
      '002_media_index_v1.sql',
      '003_material_selection_v1.sql',
    ]) {
      copyFileSync(join(migrationsDirectory, filename), join(v3Migrations, filename));
    }
    const v3 = await openDatabase({ dbPath, migrationsDirectory: v3Migrations });
    expect(v3.migration.currentVersion).toBe(3);
    const insertSql =
      'INSERT INTO material_selection_decisions(' +
      'selection_request_id, batch_id, video_id, slot_id, material_family, status, ' +
      'degradation_level, reason_codes_json, candidate_set_id, candidate_set_contract_version, ' +
      'candidate_set_hash, history_snapshot_hash, policy_id, policy_version, ' +
      'policy_snapshot_hash, decision_receipt_hash, request_json, decision_receipt_json, ' +
      'result_json, committed_at' +
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    v3.db
      .prepare(insertSql)
      .run(
        'selection_kept',
        'batch_1',
        'video_1',
        'slot_1',
        'ANIMAL',
        'NO_MATCH',
        0,
        '[]',
        'set_1',
        'code-c-shot-search-v1',
        '1'.repeat(64),
        '2'.repeat(64),
        'material-selection-policy-v1',
        '1.0.0',
        '3'.repeat(64),
        '4'.repeat(64),
        '{}',
        '{}',
        '{}',
        '2026-09-10T00:00:00.000Z',
      );
    v3.db.close();

    const upgraded = await openDatabase({ dbPath, migrationsDirectory });
    expect(upgraded.migration.currentVersion).toBe(9);
    expect(upgraded.migration.appliedVersions).toEqual([4, 5, 6, 7, 8, 9]);
    expect(upgraded.migration.backupPath).not.toBeNull();
    expect(
      upgraded.db
        .prepare(
          'SELECT selection_request_id FROM material_selection_decisions WHERE selection_request_id = ?',
        )
        .pluck()
        .get('selection_kept'),
    ).toBe('selection_kept');
    expect(
      upgraded.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'timeline_plan_versions'",
        )
        .pluck()
        .get(),
    ).toBe('timeline_plan_versions');
    upgraded.db.close();
  });

  it('upgrades the accepted Render foundation from version 5 without changing 005', async () => {
    const directory = temporaryDirectory('desktop-v5-render-upgrade-');
    const dbPath = join(directory, 'app.db');
    const v5Migrations = join(directory, 'v5-migrations');
    mkdirSync(v5Migrations);
    for (const filename of [
      '001_initial.sql',
      '002_media_index_v1.sql',
      '003_material_selection_v1.sql',
      '004_timeline_plan_v1.sql',
      '005_render_foundation_v1.sql',
    ]) {
      copyFileSync(join(migrationsDirectory, filename), join(v5Migrations, filename));
    }
    const v5 = await openDatabase({ dbPath, migrationsDirectory: v5Migrations });
    expect(v5.migration.currentVersion).toBe(5);
    v5.db
      .prepare(
        "INSERT INTO app_settings(setting_key, setting_value, updated_at) VALUES ('kept', 'yes', ?)",
      )
      .run('2026-09-12T00:00:00.000Z');
    v5.db.close();

    const upgraded = await openDatabase({ dbPath, migrationsDirectory });
    expect(upgraded.migration.currentVersion).toBe(9);
    expect(upgraded.migration.appliedVersions).toEqual([6, 7, 8, 9]);
    expect(upgraded.migration.backupPath).not.toBeNull();
    expect(
      upgraded.db
        .prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'kept'")
        .pluck()
        .get(),
    ).toBe('yes');
    expect(
      upgraded.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'render_execution_attempts'",
        )
        .pluck()
        .get(),
    ).toBe('render_execution_attempts');
    expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    upgraded.db.close();
  });

  it('upgrades R1B version 6 to cancellation and recoverability version 7', async () => {
    const directory = temporaryDirectory('desktop-v6-r1b-upgrade-');
    const dbPath = join(directory, 'app.db');
    const v6Migrations = join(directory, 'v6-migrations');
    mkdirSync(v6Migrations);
    for (const filename of readdirSync(migrationsDirectory).filter((name) =>
      /^(?:001|002|003|004|005|006)_/u.test(name),
    )) {
      copyFileSync(join(migrationsDirectory, filename), join(v6Migrations, filename));
    }
    const v6 = await openDatabase({ dbPath, migrationsDirectory: v6Migrations });
    expect(v6.migration.currentVersion).toBe(6);
    v6.db
      .prepare(
        "INSERT INTO app_settings(setting_key, setting_value, updated_at) VALUES ('v6-kept', 'yes', ?)",
      )
      .run('2026-09-12T00:00:00.000Z');
    v6.db.close();

    const upgraded = await openDatabase({ dbPath, migrationsDirectory });
    expect(upgraded.migration.currentVersion).toBe(9);
    expect(upgraded.migration.appliedVersions).toEqual([7, 8, 9]);
    expect(
      upgraded.db
        .prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'v6-kept'")
        .pluck()
        .get(),
    ).toBe('yes');
    expect(upgraded.db.prepare('PRAGMA table_info(render_execution_attempts)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'cancellation_requested_at' })]),
    );
    expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    upgraded.db.close();
  });

  it('upgrades exact version 7 to immutable Source Document authority version 8', async () => {
    const directory = temporaryDirectory('desktop-v7-source-document-upgrade-');
    const dbPath = join(directory, 'app.db');
    const v7Migrations = join(directory, 'v7-migrations');
    mkdirSync(v7Migrations);
    for (const filename of readdirSync(migrationsDirectory).filter((name) =>
      /^(?:001|002|003|004|005|006|007)_/u.test(name),
    )) {
      copyFileSync(join(migrationsDirectory, filename), join(v7Migrations, filename));
    }
    const v7 = await openDatabase({ dbPath, migrationsDirectory: v7Migrations });
    expect(v7.migration.currentVersion).toBe(7);
    const timestamp = '2026-09-17T00:00:00.000Z';
    v7.db
      .prepare(
        `INSERT INTO products(product_id, name, created_at, updated_at)
         VALUES ('product_kept', '保留产品', ?, ?)`,
      )
      .run(timestamp, timestamp);
    v7.db
      .prepare(
        `INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at)
         VALUES ('script_kept', 'product_kept', 1, ?, ?)`,
      )
      .run(timestamp, timestamp);
    v7.db
      .prepare(
        `INSERT INTO script_versions(
          script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
          fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
          provider_model, request_snapshot_hash, created_at
        ) VALUES ('script_kept', 1, '精确原文', '精确原文', 'SUCCEEDED', NULL,
          '[]', 'test', '1', 'mock', 'mock', ?, ?)`,
      )
      .run('a'.repeat(64), timestamp);
    v7.db.close();

    const upgraded = await openDatabase({ dbPath, migrationsDirectory });
    expect(upgraded.migration.currentVersion).toBe(9);
    expect(upgraded.migration.appliedVersions).toEqual([8, 9]);
    expect(upgraded.migration.backupPath).not.toBeNull();
    expect(
      upgraded.db
        .prepare("SELECT name FROM products WHERE product_id = 'product_kept'")
        .pluck()
        .get(),
    ).toBe('保留产品');
    expect(
      upgraded.db
        .prepare("SELECT text FROM script_versions WHERE script_id = 'script_kept' AND version = 1")
        .pluck()
        .get(),
    ).toBe('精确原文');
    expect(upgraded.db.prepare('SELECT COUNT(*) FROM source_document_versions').pluck().get()).toBe(
      0,
    );
    for (const table of [
      'timeline_plan_versions',
      'render_jobs',
      'render_execution_attempts',
      'source_document_versions',
    ]) {
      expect(
        upgraded.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .pluck()
          .get(table),
      ).toBe(table);
    }
    for (const trigger of [
      'source_document_versions_reject_update',
      'source_document_versions_reject_delete',
    ]) {
      expect(
        upgraded.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .pluck()
          .get(trigger),
      ).toBe(trigger);
    }
    expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    upgraded.db.close();
  });

  it('upgrades exact version 8 to Shot Plan authority version 9 without backfill or history loss', async () => {
    const directory = temporaryDirectory('desktop-v8-shot-plan-upgrade-');
    const dbPath = join(directory, 'app.db');
    const v8Migrations = join(directory, 'v8-migrations');
    mkdirSync(v8Migrations);
    for (const filename of readdirSync(migrationsDirectory).filter((name) =>
      /^(?:001|002|003|004|005|006|007|008)_/u.test(name),
    )) {
      copyFileSync(join(migrationsDirectory, filename), join(v8Migrations, filename));
    }
    const v8 = await openDatabase({ dbPath, migrationsDirectory: v8Migrations });
    expect(v8.migration.currentVersion).toBe(8);
    const timestamp = '2026-09-17T00:00:00.000Z';
    v8.db
      .prepare(
        `INSERT INTO products(product_id, name, created_at, updated_at)
         VALUES ('product_v8_kept', 'V8 保留产品', ?, ?)`,
      )
      .run(timestamp, timestamp);
    v8.db
      .prepare(
        `INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at)
         VALUES ('source_v8_kept', 'product_v8_kept', 1, ?, ?)`,
      )
      .run(timestamp, timestamp);
    v8.db
      .prepare(
        `INSERT INTO script_versions(
          script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
          fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
          provider_model, request_snapshot_hash, created_at
        ) VALUES ('source_v8_kept', 1, '精确原文', '精确原文', 'SUCCEEDED', NULL,
          '[]', 'test', '1', 'mock', 'mock', ?, ?)`,
      )
      .run('a'.repeat(64), timestamp);
    v8.db
      .prepare(
        `INSERT INTO source_document_versions(
          source_document_id, version, source_document_hash, source_hash_scheme,
          source_offset_unit, source_kind, text, source_script_id, source_script_version, created_at
        ) VALUES ('source_v8_kept', 1, ?, 'SHA256_UTF8_EXACT_V1',
          'UNICODE_CODE_POINT', 'SCRIPT_VERSION', '精确原文', 'source_v8_kept', 1, ?)`,
      )
      .run('b'.repeat(64), timestamp);
    v8.db
      .prepare(
        `INSERT INTO media_assets(
          asset_id, file_hash, status, active_revision, created_at, updated_at
        ) VALUES ('media_v8_kept', ?, 'ACTIVE', NULL, ?, ?)`,
      )
      .run('c'.repeat(64), timestamp, timestamp);
    v8.db
      .prepare(
        `INSERT INTO material_selection_decisions(
          selection_request_id, batch_id, video_id, slot_id, material_family, status,
          degradation_level, reason_codes_json, candidate_set_id, candidate_set_contract_version,
          candidate_set_hash, history_snapshot_hash, policy_id, policy_version,
          policy_snapshot_hash, decision_receipt_hash, request_json, decision_receipt_json,
          result_json, committed_at
        ) VALUES (
          'selection_v8_kept', 'batch_v8', 'video_v8', 'slot_v8', 'ANIMAL', 'NO_MATCH',
          0, '[]', 'set_v8', 'code-c-shot-search-v1', ?, ?, 'policy_v8', '1.0.0',
          ?, ?, '{}', '{}', '{}', ?
        )`,
      )
      .run('d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), '1'.repeat(64), timestamp);
    v8.db
      .prepare(
        `INSERT INTO timeline_plan_versions(
          timeline_id, version, parent_version, planning_request_id, timeline_request_hash,
          shot_plan_id, shot_plan_hash, timing_snapshot_id, timing_snapshot_hash,
          planning_facts_hash, policy_id, policy_version, policy_snapshot_hash,
          duration_plan_hash, planning_request_json, planning_facts_json, duration_policy_json,
          duration_plan_json, commit_receipt_hash, commit_receipt_json, committed_at
        ) VALUES (
          'timeline_v8_kept', 1, NULL, 'planning_v8_kept', ?, 'legacy_plan_v8', ?,
          'timing_v8', ?, ?, 'timeline-policy-v1', '1.0.0', ?, ?, '{}', '{}', '{}',
          '{}', ?, '{}', ?
        )`,
      )
      .run(
        '2'.repeat(64),
        '3'.repeat(64),
        '4'.repeat(64),
        '5'.repeat(64),
        '6'.repeat(64),
        '7'.repeat(64),
        '8'.repeat(64),
        timestamp,
      );
    v8.db
      .prepare(
        `INSERT INTO jobs(
          job_id, job_type, state, progress, created_at, started_at, finished_at,
          error_code, error_message, request_snapshot_hash
        ) VALUES ('render_v8_kept', 'RENDER', 'FAILED', 1, ?, ?, ?,
          'LEGACY_FAILURE', 'retained history', ?)`,
      )
      .run(timestamp, timestamp, timestamp, '9'.repeat(64));
    v8.db
      .prepare(
        `INSERT INTO render_jobs(
          job_id, request_hash, request_json, timeline_id, timeline_version,
          timeline_commit_receipt_hash, render_policy_id, render_policy_version,
          render_policy_hash, state, attempt_number, created_at, updated_at,
          error_code, error_message
        ) VALUES (
          'render_v8_kept', ?, '{}', 'timeline_v8_kept', 1, ?, 'render-policy-v1', 1,
          ?, 'FAILED', 1, ?, ?, 'LEGACY_FAILURE', 'retained history'
        )`,
      )
      .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), timestamp, timestamp);
    v8.db.close();

    const upgraded = await openDatabase({ dbPath, migrationsDirectory });
    expect(upgraded.migration.currentVersion).toBe(9);
    expect(upgraded.migration.appliedVersions).toEqual([9]);
    expect(upgraded.migration.backupPath).not.toBeNull();
    expect(existsSync(upgraded.migration.backupPath!)).toBe(true);
    expect(
      upgraded.db
        .prepare("SELECT name FROM products WHERE product_id = 'product_v8_kept'")
        .pluck()
        .get(),
    ).toBe('V8 保留产品');
    expect(
      upgraded.db
        .prepare(
          "SELECT text FROM source_document_versions WHERE source_document_id = 'source_v8_kept' AND version = 1",
        )
        .pluck()
        .get(),
    ).toBe('精确原文');
    expect(upgraded.db.prepare('SELECT asset_id FROM media_assets').pluck().get()).toBe(
      'media_v8_kept',
    );
    expect(
      upgraded.db
        .prepare('SELECT selection_request_id FROM material_selection_decisions')
        .pluck()
        .get(),
    ).toBe('selection_v8_kept');
    expect(
      upgraded.db.prepare('SELECT timeline_id FROM timeline_plan_versions').pluck().get(),
    ).toBe('timeline_v8_kept');
    expect(upgraded.db.prepare('SELECT job_id FROM render_jobs').pluck().get()).toBe(
      'render_v8_kept',
    );
    for (const table of [
      'media_assets',
      'material_selection_decisions',
      'timeline_plan_versions',
      'render_jobs',
      'source_document_versions',
      'shot_plan_candidates',
      'shot_plan_lineages',
      'confirmed_shot_plan_versions',
    ]) {
      expect(
        upgraded.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .pluck()
          .get(table),
      ).toBe(table);
    }
    expect(upgraded.db.prepare('SELECT COUNT(*) FROM shot_plan_candidates').pluck().get()).toBe(0);
    expect(upgraded.db.prepare('SELECT COUNT(*) FROM shot_plan_lineages').pluck().get()).toBe(0);
    expect(
      upgraded.db.prepare('SELECT COUNT(*) FROM confirmed_shot_plan_versions').pluck().get(),
    ).toBe(0);
    for (const trigger of [
      'shot_plan_lineages_reject_update',
      'shot_plan_lineages_reject_delete',
      'confirmed_shot_plan_versions_reject_update',
      'confirmed_shot_plan_versions_reject_delete',
    ]) {
      expect(
        upgraded.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .pluck()
          .get(trigger),
      ).toBe(trigger);
    }
    expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    upgraded.db.close();

    const replay = await openDatabase({ dbPath, migrationsDirectory });
    expect(replay.migration.currentVersion).toBe(9);
    expect(replay.migration.appliedVersions).toEqual([]);
    replay.db.close();
  });

  it('rolls back an interrupted migration and keeps a recoverable backup', async () => {
    const directory = temporaryDirectory('desktop-failure-');
    const dbPath = join(directory, 'app.db');
    const brokenDirectory = join(directory, 'broken-migrations');
    const legacy = new BetterSqlite3(dbPath);
    legacy.exec(
      "CREATE TABLE legacy_fixture(value TEXT); INSERT INTO legacy_fixture VALUES ('safe')",
    );
    legacy.close();
    mkdirSync(brokenDirectory);
    writeFileSync(
      join(brokenDirectory, '001_broken.sql'),
      'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT, applied_at TEXT); CREATE TABLE partial(id INTEGER); INSERT INTO missing_table VALUES (1);',
    );
    await expect(openDatabase({ dbPath, migrationsDirectory: brokenDirectory })).rejects.toThrow();
    const backups = readdirSync(directory).filter((name) => name.startsWith('app.db.backup-'));
    expect(backups).toHaveLength(1);
    const backup = new BetterSqlite3(join(directory, backups[0]!));
    expect(backup.prepare('SELECT value FROM legacy_fixture').pluck().get()).toBe('safe');
    backup.close();
    const original = new BetterSqlite3(dbPath);
    expect(
      original
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial'")
        .get(),
    ).toBeUndefined();
    original.close();
    const recovered = await openDatabase({ dbPath, migrationsDirectory });
    expect(recovered.migration.currentVersion).toBe(9);
    recovered.db.close();
  });
});
