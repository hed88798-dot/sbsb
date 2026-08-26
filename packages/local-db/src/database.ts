import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import BetterSqlite3, { type Database } from 'better-sqlite3';

interface MigrationFile {
  version: number;
  path: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  currentVersion: number;
  appliedVersions: number[];
  backupPath: string | null;
}

function loadMigrations(directory: string): MigrationFile[] {
  return readdirSync(directory)
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      const sql = readFileSync(path, 'utf8');
      return {
        version: Number.parseInt(name.split('_')[0] ?? '', 10),
        path,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

function migrationTableExists(db: Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name: string } | undefined;
  return row?.name === 'schema_migrations';
}

function appliedMigrations(db: Database): Map<number, string> {
  if (!migrationTableExists(db)) return new Map();
  const rows = db
    .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all() as {
    version: number;
    checksum: string;
  }[];
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

export async function migrateDatabase(
  db: Database,
  options: { dbPath: string; migrationsDirectory: string },
): Promise<MigrationResult> {
  const migrations = loadMigrations(options.migrationsDirectory);
  if (migrations.length === 0) throw new Error('No SQLite migrations found');
  const applied = appliedMigrations(db);
  for (const migration of migrations) {
    const recordedChecksum = applied.get(migration.version);
    if (recordedChecksum && recordedChecksum !== migration.checksum) {
      throw new Error(`Migration checksum mismatch: ${basename(migration.path)}`);
    }
  }
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  let backupPath: string | null = null;
  const existingDatabase = existsSync(options.dbPath) && statSync(options.dbPath).size > 0;
  if (existingDatabase && pending.length > 0) {
    backupPath = `${options.dbPath}.backup-${Date.now()}`;
    await db.backup(backupPath);
  }

  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const appliedVersions: number[] = [];
  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.checksum, new Date().toISOString());
    });
    apply.immediate();
    appliedVersions.push(migration.version);
  }
  const currentVersion = migrations.at(-1)?.version ?? 0;
  return { currentVersion, appliedVersions, backupPath };
}

export async function openDatabase(options: {
  dbPath: string;
  migrationsDirectory: string;
}): Promise<{ db: Database; migration: MigrationResult }> {
  const db = new BetterSqlite3(options.dbPath);
  try {
    const migration = await migrateDatabase(db, options);
    return { db, migration };
  } catch (error) {
    db.close();
    throw error;
  }
}
