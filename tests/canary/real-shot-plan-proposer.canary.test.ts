import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleTextAdapter } from '@app/provider-adapters';
import { ShotPlanAuthorityService } from '../../apps/desktop/src/main/shot-plan-authority-service.js';
import { ShotPlanProposerServiceV1 } from '../../apps/desktop/src/main/shot-plan-proposer-service.js';
import { SourceDocumentAuthorityService } from '../../apps/desktop/src/main/source-document-authority-service.js';
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
  CopywritingRepository,
  ShotPlanAuthorityRepository,
  SourceDocumentRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import {
  HttpTextCapabilityClient,
  type GatewayRequestSigner,
} from '../../packages/provider-client/src/index.js';

const enabled = process.env.REAL_SHOT_PLAN_PROPOSER_CANARY === '1';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing canary variable: ${name}`);
  return value;
}

describe.skipIf(!enabled)('real semantic Shot Plan proposer canary', () => {
  it('creates one review-only Candidate through the existing authenticated Text Gateway', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'real-shot-plan-proposer-'));
    const gatewayDatabase = openGatewayDatabase({
      dbPath: join(directory, 'gateway.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/gateway-sqlite'),
    });
    const desktopDatabase = (
      await openDatabase({
        dbPath: join(directory, 'desktop.db'),
        migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
      })
    ).db;
    const pepper = randomBytes(32).toString('hex');
    const tokenSecret = randomBytes(32).toString('hex');
    const activationCode = randomBytes(16).toString('hex');
    seedLicense(gatewayDatabase.db, {
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
    approveProvider(gatewayDatabase.db, {
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
    const gateway = buildGatewayApp({
      db: gatewayDatabase.db,
      tokenSecret,
      credentialPepper: pepper,
      objectStore: new FakeObjectStoreSigner(),
      adapters: [adapter],
      routes: [
        {
          capability: 'text.generate.v1',
          modelAlias: 'text.semantic-shot-planning',
          qualityTier: 'standard',
          primary: adapter.alias,
        },
      ],
    });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const activation = await gateway.inject({
      method: 'POST',
      url: '/v1/activate',
      payload: {
        activation_code: activationCode,
        device_id: 'dev_real_shot_plan_canary',
        public_key_pem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      },
    });
    const accessToken = activation.json<{ access_token: string }>().access_token;
    await gateway.listen({ host: '127.0.0.1', port: 0 });
    const address = gateway.server.address();
    if (!address || typeof address === 'string') throw new Error('Canary Gateway failed to bind');
    const signer: GatewayRequestSigner = {
      sign: async (input) => {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const nonce = randomBytes(18).toString('base64url');
        return {
          timestamp,
          nonce,
          bodySha256: sha256(input.body),
          signature: sign(
            null,
            Buffer.from(
              signingMessage({
                method: input.method,
                path: input.path,
                timestamp,
                nonce,
                body: input.body,
                requestId: input.requestId,
              }),
            ),
            privateKey,
          ).toString('base64'),
        };
      },
    };
    try {
      const sourceDocuments = new SourceDocumentRepository(desktopDatabase);
      const now = '2026-09-17T00:00:00.000Z';
      desktopDatabase
        .prepare(
          `INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at)
           VALUES ('script_real_canary', NULL, 1, ?, ?)`,
        )
        .run(now, now);
      const text = '使用康健100后，猪群采食状态逐步恢复。';
      desktopDatabase
        .prepare(
          `INSERT INTO script_versions(
            script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
            fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
            provider_model, request_snapshot_hash, created_at
          ) VALUES ('script_real_canary', 1, ?, ?, 'SUCCEEDED', NULL, '[]',
            'synthetic-canary', '1', 'synthetic', 'synthetic', ?, ?)`,
        )
        .run(text, text, sha256('synthetic-shot-plan-canary-source'), now);
      const source = new SourceDocumentAuthorityService({
        scripts: new CopywritingRepository(desktopDatabase),
        sourceDocuments,
        clock: () => now,
      }).ensureFromScriptVersion({ script_id: 'script_real_canary', script_version: 1 });
      const shotPlans = new ShotPlanAuthorityService({
        repository: new ShotPlanAuthorityRepository(desktopDatabase),
        sourceDocuments,
        clock: () => now,
      });
      const result = await new ShotPlanProposerServiceV1({
        sourceDocuments,
        shotPlans,
        client: new HttpTextCapabilityClient({
          backendUrl: `http://127.0.0.1:${address.port}`,
          accessToken,
          requestSigner: signer,
          timeoutMs: 30_000,
        }),
      }).propose({
        operation_id: `real_shot_plan_canary_${Date.now()}`,
        source_document_id: source.source_document_id,
        source_document_version: source.source_document_version,
        source_document_hash: source.source_document_hash,
      });
      expect(result.candidate).toMatchObject({
        candidate_revision: 1,
        candidate_status: 'ACTIVE',
        source_document_hash: source.source_document_hash,
      });
      expect(result.candidate).not.toHaveProperty('review_state');
    } finally {
      await gateway.close();
      gatewayDatabase.close();
      desktopDatabase.close();
    }
  });
});
