import type { Database } from 'better-sqlite3';

export class SettingsRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  get(key: string): string | null {
    const row = this.#db
      .prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?')
      .get(key) as { setting_value: string } | undefined;
    return row?.setting_value ?? null;
  }

  set(key: string, value: string): void {
    this.#db
      .prepare(
        `INSERT INTO app_settings(setting_key, setting_value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value,
         updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }
}
