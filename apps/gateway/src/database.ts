import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';

export const GATEWAY_MIGRATION_VERSION = 1;

export interface OpenGatewayDatabaseOptions {
  dbPath: string;
  migrationsDirectory: string;
}

export interface GatewayDatabase {
  db: Database.Database;
  migrationVersion: number;
  close(): void;
  backup(destinationPath: string): Promise<void>;
}

function applyMigrations(db: Database.Database, migrationsDirectory: string): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const files = readdirSync(migrationsDirectory)
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0] ?? '', 10);
    if (!Number.isSafeInteger(version)) throw new Error(`Invalid migration filename: ${file}`);
    const sql = readFileSync(join(migrationsDirectory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = db
      .prepare('SELECT checksum FROM schema_migrations WHERE version = ?')
      .get(version) as { checksum: string } | undefined;
    if (existing) {
      if (existing.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${file}`);
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(version, basename(file), checksum, new Date().toISOString());
    })();
  }
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as {
    version: number;
  };
  return row.version;
}

export function openGatewayDatabase(options: OpenGatewayDatabaseOptions): GatewayDatabase {
  const db = new Database(options.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  const migrationVersion = applyMigrations(db, options.migrationsDirectory);
  if (migrationVersion !== GATEWAY_MIGRATION_VERSION) {
    db.close();
    throw new Error(`Unsupported gateway schema version: ${migrationVersion}`);
  }
  return {
    db,
    migrationVersion,
    close: () => db.close(),
    backup: async (destinationPath: string) => {
      await db.backup(destinationPath);
    },
  };
}

export function seedLicense(
  db: Database.Database,
  input: {
    licenseId?: string;
    activationCodeHash: string;
    deviceLimit?: number;
    monthlyBudget?: number;
    currency?: 'CNY' | 'USD';
  },
): string {
  const licenseId = input.licenseId ?? `lic_${randomUUID()}`;
  db.prepare(
    `INSERT INTO licenses(
      license_id, activation_code_hash, status, device_limit, monthly_budget, currency, created_at
    ) VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?)`,
  ).run(
    licenseId,
    input.activationCodeHash,
    input.deviceLimit ?? 3,
    input.monthlyBudget ?? 100,
    input.currency ?? 'CNY',
    new Date().toISOString(),
  );
  return licenseId;
}
