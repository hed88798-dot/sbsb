import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { GATEWAY_MIGRATION_VERSION, openGatewayDatabase } from '../../apps/gateway/src/database.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/gateway-sqlite');

describe('Gateway SQLite migrations and online backup', () => {
  it('applies versioned migrations idempotently and creates a verified online backup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gateway-migration-'));
    const dbPath = join(directory, 'gateway.db');
    const backupPath = join(directory, 'gateway.backup.db');
    const first = openGatewayDatabase({ dbPath, migrationsDirectory });
    expect(first.migrationVersion).toBe(GATEWAY_MIGRATION_VERSION);
    first.db
      .prepare(
        `INSERT INTO licenses(
          license_id, activation_code_hash, status, device_limit, monthly_budget, currency, created_at
        ) VALUES ('lic_backup', 'hash', 'ACTIVE', 1, 1, 'CNY', ?)`,
      )
      .run(new Date().toISOString());
    await first.backup(backupPath);
    expect(existsSync(backupPath)).toBe(true);
    first.close();

    const backup = new Database(backupPath, { readonly: true });
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(backup.prepare('SELECT license_id FROM licenses').get()).toMatchObject({
      license_id: 'lic_backup',
    });
    backup.close();

    const reopened = openGatewayDatabase({ dbPath, migrationsDirectory });
    expect(
      (
        reopened.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    reopened.close();
  });
});
