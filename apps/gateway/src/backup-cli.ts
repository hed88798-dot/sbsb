import { resolve } from 'node:path';
import { openGatewayDatabase } from './database.js';

const dbPath = process.env.GATEWAY_DB_PATH;
const destination = process.env.GATEWAY_BACKUP_PATH;
if (!dbPath || !destination) {
  throw new Error('GATEWAY_DB_PATH and GATEWAY_BACKUP_PATH are required');
}
const database = openGatewayDatabase({
  dbPath: resolve(dbPath),
  migrationsDirectory: resolve(process.env.GATEWAY_MIGRATIONS_PATH ?? 'migrations/gateway-sqlite'),
});
await database.backup(resolve(destination));
database.close();
console.log(JSON.stringify({ event: 'gateway_backup_complete' }));
