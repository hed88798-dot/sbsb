import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleTextAdapter } from '@app/provider-adapters';
import {
  approveProvider,
  buildGatewayApp,
  FakeObjectStoreSigner,
  hashCredential,
  openGatewayDatabase,
  seedLicense,
  sha256,
  signingMessage,
} from '../../apps/gateway/src/index.js';
import {
  HttpTextCapabilityClient,
  type GatewayRequestSigner,
} from '../../packages/provider-client/src/index.js';

const enabled = process.env.REAL_TEXT_PROVIDER_CANARY === '1';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing canary variable: ${name}`);
  return value;
}

describe.skipIf(!enabled)('real Text Provider vertical canary', () => {
  it('runs client -> authenticated Gateway -> real Provider with a hard cost ceiling', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'real-text-canary-'));
    const database = openGatewayDatabase({
      dbPath: join(directory, 'gateway.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/gateway-sqlite'),
    });
    const pepper = randomBytes(32).toString('hex');
    const tokenSecret = randomBytes(32).toString('hex');
    const activationCode = randomBytes(16).toString('hex');
    const licenseId = seedLicense(database.db, {
      activationCodeHash: hashCredential(activationCode, pepper),
      monthlyBudget: 1,
      currency: 'CNY',
    });
    const adapter = new OpenAiCompatibleTextAdapter({
      alias: required('REAL_TEXT_PROVIDER_ALIAS'),
      providerModel: required('REAL_TEXT_PROVIDER_MODEL'),
      endpoint: required('REAL_TEXT_PROVIDER_ENDPOINT'),
      apiKey: required('REAL_TEXT_PROVIDER_KEY'),
      webhookSecret: required('REAL_TEXT_PROVIDER_WEBHOOK_SECRET'),
      inputUnitCost: Number(required('REAL_TEXT_PROVIDER_INPUT_UNIT_COST')),
      outputUnitCost: Number(required('REAL_TEXT_PROVIDER_OUTPUT_UNIT_COST')),
      currency: 'CNY',
    });
    approveProvider(database.db, {
      provider: adapter.alias,
      providerModel: adapter.providerModel,
      capability: 'text.generate.v1',
      apiTermsVersion: required('REAL_TEXT_PROVIDER_TERMS_VERSION'),
      modelCodeLicense: required('REAL_TEXT_PROVIDER_CODE_LICENSE'),
      modelWeightLicense: required('REAL_TEXT_PROVIDER_WEIGHT_LICENSE'),
      commercialUse: true,
      outputOwnership: required('REAL_TEXT_PROVIDER_OUTPUT_OWNERSHIP'),
      trainingOrRetentionPolicy: required('REAL_TEXT_PROVIDER_RETENTION_POLICY'),
      regionDataTransfer: required('REAL_TEXT_PROVIDER_REGION_POLICY'),
      prohibitedContent: required('REAL_TEXT_PROVIDER_CONTENT_POLICY'),
      attributionRequirement: required('REAL_TEXT_PROVIDER_ATTRIBUTION'),
      approvedBy: required('REAL_TEXT_PROVIDER_APPROVED_BY'),
      approvedAt: required('REAL_TEXT_PROVIDER_APPROVED_AT'),
      expiresAt: required('REAL_TEXT_PROVIDER_APPROVAL_EXPIRES_AT'),
    });
    const app = buildGatewayApp({
      db: database.db,
      tokenSecret,
      credentialPepper: pepper,
      objectStore: new FakeObjectStoreSigner(),
      adapters: [adapter],
      routes: [
        {
          capability: 'text.generate.v1',
          modelAlias: 'real-text-v1',
          qualityTier: 'standard',
          primary: adapter.alias,
        },
      ],
    });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const activation = await app.inject({
      method: 'POST',
      url: '/v1/activate',
      payload: {
        activation_code: activationCode,
        device_id: 'dev_real_text_canary',
        public_key_pem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      },
    });
    const accessToken = activation.json<{ access_token: string }>().access_token;
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Canary Gateway failed to bind');
    const signer: GatewayRequestSigner = {
      sign: async (input) => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const nonce = randomBytes(18).toString('base64url');
        const message = signingMessage({
          method: input.method,
          path: input.path,
          timestamp,
          nonce,
          body: input.body,
          requestId: input.requestId,
        });
        return {
          timestamp,
          nonce,
          bodySha256: sha256(input.body),
          signature: sign(null, Buffer.from(message), privateKey).toString('base64'),
        };
      },
    };
    try {
      const result = await new HttpTextCapabilityClient({
        backendUrl: `http://127.0.0.1:${address.port}`,
        accessToken,
        requestSigner: signer,
        timeoutMs: 30_000,
      }).generate({
        schema_version: '1.0',
        request_id: `real_text_canary_${Date.now()}`,
        capability: 'text.generate.v1',
        model_alias: 'real-text-v1',
        prompt: '请只回复：合成金丝雀测试通过。不要使用任何客户数据。',
        request_snapshot_hash: sha256('fixed-synthetic-real-text-canary-v1'),
      });
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.provider_alias).toBe(adapter.alias);
      const ledger = database.db
        .prepare(
          `SELECT provider, provider_model, final_cost, currency, latency_ms, state
           FROM usage_events WHERE license_id = ? AND event_type = 'SETTLEMENT'`,
        )
        .get(licenseId) as Record<string, unknown> | undefined;
      expect(ledger).toMatchObject({
        provider: adapter.alias,
        provider_model: adapter.providerModel,
        currency: 'CNY',
        state: 'SUCCEEDED',
      });
      expect(Number(ledger?.final_cost)).toBeLessThanOrEqual(1);
    } finally {
      await app.close();
      database.close();
    }
  });
});
