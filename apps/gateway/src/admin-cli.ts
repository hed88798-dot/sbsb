import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openGatewayDatabase, seedLicense } from './database.js';
import { approveProvider, type LegalApprovalInput } from './routing.js';
import { hashCredential } from './security.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const database = openGatewayDatabase({
  dbPath: resolve(required('GATEWAY_DB_PATH')),
  migrationsDirectory: resolve(process.env.GATEWAY_MIGRATIONS_PATH ?? 'migrations/gateway-sqlite'),
});
const action = process.argv[2];
try {
  if (action === 'seed-license') {
    const licenseId = seedLicense(database.db, {
      activationCodeHash: hashCredential(
        required('GATEWAY_ACTIVATION_CODE'),
        required('GATEWAY_CREDENTIAL_PEPPER'),
      ),
      deviceLimit: Number(process.env.GATEWAY_LICENSE_DEVICE_LIMIT ?? 3),
      monthlyBudget: Number(process.env.GATEWAY_LICENSE_MONTHLY_BUDGET ?? 100),
      currency: process.env.GATEWAY_LICENSE_CURRENCY === 'USD' ? 'USD' : 'CNY',
    });
    console.log(JSON.stringify({ action, license_id: licenseId }));
  } else if (action === 'approve-provider') {
    const approval = JSON.parse(
      readFileSync(resolve(required('GATEWAY_LEGAL_APPROVAL_PATH')), 'utf8'),
    ) as LegalApprovalInput;
    approveProvider(database.db, approval);
    console.log(
      JSON.stringify({
        action,
        target: `${approval.provider}:${approval.providerModel}:${approval.capability}`,
      }),
    );
  } else if (action === 'revoke-license') {
    const licenseId = required('GATEWAY_LICENSE_ID');
    database.db
      .prepare("UPDATE licenses SET status = 'REVOKED', revoked_at = ? WHERE license_id = ?")
      .run(new Date().toISOString(), licenseId);
    console.log(JSON.stringify({ action, license_id: licenseId }));
  } else if (action === 'revoke-device') {
    const deviceId = required('GATEWAY_DEVICE_ID');
    database.db.transaction(() => {
      database.db
        .prepare("UPDATE devices SET status = 'REVOKED', revoked_at = ? WHERE device_id = ?")
        .run(new Date().toISOString(), deviceId);
      database.db
        .prepare(
          'UPDATE access_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL',
        )
        .run(new Date().toISOString(), deviceId);
      database.db
        .prepare(
          'UPDATE refresh_credentials SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL',
        )
        .run(new Date().toISOString(), deviceId);
    })();
    console.log(JSON.stringify({ action, device_id: deviceId }));
  } else if (action === 'revoke-token') {
    const tokenId = required('GATEWAY_TOKEN_ID');
    database.db
      .prepare('UPDATE access_tokens SET revoked_at = ? WHERE token_id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), tokenId);
    console.log(JSON.stringify({ action, token_id: tokenId }));
  } else if (action === 'revoke-refresh') {
    const credentialId = required('GATEWAY_REFRESH_CREDENTIAL_ID');
    database.db
      .prepare(
        'UPDATE refresh_credentials SET revoked_at = ? WHERE credential_id = ? AND revoked_at IS NULL',
      )
      .run(new Date().toISOString(), credentialId);
    console.log(JSON.stringify({ action, credential_id: credentialId }));
  } else {
    throw new Error(
      'Usage: admin-cli.js seed-license|approve-provider|revoke-license|revoke-device|revoke-token|revoke-refresh',
    );
  }
} finally {
  database.close();
}
