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
  it('migrates an empty database to version 3 with WAL and foreign keys', async () => {
    const dbPath = join(temporaryDirectory('desktop-empty-'), 'app.db');
    const { db, migration } = await openDatabase({ dbPath, migrationsDirectory });
    expect(migration.currentVersion).toBe(3);
    expect(migration.appliedVersions).toEqual([1, 2, 3]);
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
    expect(upgraded.migration.currentVersion).toBe(3);
    expect(upgraded.migration.appliedVersions).toEqual([3]);
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
    expect(recovered.migration.currentVersion).toBe(3);
    recovered.db.close();
  });
});
