import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
const Database = load('better-sqlite3');

const [kind, binding, output] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
assert.equal(load('better-sqlite3/package.json').version, '13.0.3');
if (kind === 'node') assert.equal(process.version, 'v24.19.0');
else {
  assert.equal(kind, 'electron');
  assert.equal(process.versions.electron, '43.8.3');
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr90-sqlite-'));
const file = path.join(directory, 'fresh.db');
let db;
try {
  db = new Database(file, { nativeBinding: path.resolve(binding) });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => db.prepare('INSERT INTO probe VALUES (?, ?)').run(1, 'real-native-write'))();
  assert.throws(() =>
    db.transaction(() => {
      db.prepare('INSERT INTO probe VALUES (?, ?)').run(2, 'must-roll-back');
      throw new Error('ROLLBACK_PROBE');
    })(),
  );
  db.close();
  db = new Database(file, { nativeBinding: path.resolve(binding) });
  assert.deepEqual(db.prepare('SELECT * FROM probe').all(), [
    { id: 1, value: 'real-native-write' },
  ]);
  const report = {
    status: 'PASS',
    kind,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    electron: process.versions.electron ?? null,
    modules_abi: process.versions.modules,
    better_sqlite3: '13.0.3',
    native_sha256: crypto.createHash('sha256').update(fs.readFileSync(binding)).digest('hex'),
    sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
    persistence_reopen: 'PASS',
    transaction_rollback: 'PASS',
    paid_provider_requests: 0,
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
} finally {
  if (db?.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
