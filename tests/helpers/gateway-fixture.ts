import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ProviderCapabilityV1, ProviderRequestV1 } from '@app/contracts';
import { FakeProviderAdapter, type FakeProviderScenario } from '@app/provider-adapters';
import {
  approveProvider,
  buildGatewayApp,
  FakeObjectStoreSigner,
  hashCredential,
  openGatewayDatabase,
  seedLicense,
  signingMessage,
  type GatewayDatabase,
  type ProviderRouteConfig,
} from '../../apps/gateway/src/index.js';

export const TOKEN_SECRET = 'test-token-secret-which-is-longer-than-32-characters';
export const CREDENTIAL_PEPPER = 'test-credential-pepper-longer-than-32-characters';
export const ACTIVATION_CODE = 'ACTIVATION-CODE-TEST-001';

const capabilities: ProviderCapabilityV1[] = [
  'text.generate.v1',
  'image.generate.v1',
  'image.edit.v1',
  'video.generate.v1',
  'tts.synthesize.v1',
  'voice.clone.v1',
  'lipsync.generate.v1',
];

export interface GatewayFixture {
  app: FastifyInstance;
  database: GatewayDatabase;
  adapter: FakeProviderAdapter;
  fallback?: FakeProviderAdapter;
  licenseId: string;
  deviceId: string;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  publicKeyPem: string;
  accessToken: string;
  refreshToken: string;
  close(): Promise<void>;
}

export async function createGatewayFixture(
  options: {
    scenario?: FakeProviderScenario;
    fallbackScenario?: FakeProviderScenario;
    monthlyBudget?: number;
    accessTtlSeconds?: number;
    now?: () => Date;
  } = {},
): Promise<GatewayFixture> {
  const directory = mkdtempSync(join(tmpdir(), 'gateway-fixture-'));
  const database = openGatewayDatabase({
    dbPath: join(directory, 'gateway.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/gateway-sqlite'),
  });
  const licenseId = seedLicense(database.db, {
    licenseId: 'lic_test',
    activationCodeHash: hashCredential(ACTIVATION_CODE, CREDENTIAL_PEPPER),
    monthlyBudget: options.monthlyBudget ?? 100,
  });
  const adapter = new FakeProviderAdapter('mock-primary', 'mock-model-v1', options.scenario);
  const fallback = options.fallbackScenario
    ? new FakeProviderAdapter('mock-fallback', 'mock-model-v2', options.fallbackScenario)
    : undefined;
  const routes: ProviderRouteConfig[] = capabilities.map((capability) => ({
    capability,
    modelAlias: 'mock-v1',
    qualityTier: 'standard',
    primary: adapter.alias,
    ...(fallback ? { fallback: fallback.alias } : {}),
  }));
  const approvedAt = '2026-01-01T00:00:00.000Z';
  const expiresAt = '2030-01-01T00:00:00.000Z';
  for (const capability of capabilities) {
    for (const candidate of [adapter, ...(fallback ? [fallback] : [])]) {
      approveProvider(database.db, {
        provider: candidate.alias,
        providerModel: candidate.providerModel,
        capability,
        apiTermsVersion: 'test-terms-v1',
        modelCodeLicense: 'TEST-ONLY',
        modelWeightLicense: 'TEST-ONLY',
        commercialUse: true,
        outputOwnership: 'test fixture output',
        trainingOrRetentionPolicy: 'no retention in fake',
        regionDataTransfer: 'local fake',
        prohibitedContent: 'synthetic tests only',
        attributionRequirement: 'none',
        approvedBy: 'test-suite',
        approvedAt,
        expiresAt,
      });
    }
  }
  const app = buildGatewayApp({
    db: database.db,
    tokenSecret: TOKEN_SECRET,
    credentialPepper: CREDENTIAL_PEPPER,
    objectStore: new FakeObjectStoreSigner(),
    adapters: [adapter, ...(fallback ? [fallback] : [])],
    routes,
    ...(options.accessTtlSeconds === undefined
      ? {}
      : { accessTtlSeconds: options.accessTtlSeconds }),
    ...(options.now ? { now: options.now } : {}),
  });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const deviceId = 'dev_gateway_test_001';
  const activation = await app.inject({
    method: 'POST',
    url: '/v1/activate',
    payload: {
      activation_code: ACTIVATION_CODE,
      device_id: deviceId,
      public_key_pem: publicKeyPem,
    },
  });
  if (activation.statusCode !== 200) throw new Error(activation.body);
  const tokens = activation.json<{
    access_token: string;
    refresh_token: string;
  }>();
  return {
    app,
    database,
    adapter,
    ...(fallback ? { fallback } : {}),
    licenseId,
    deviceId,
    privateKey,
    publicKeyPem,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}

export async function signedInject(
  fixture: GatewayFixture,
  input: {
    method: 'GET' | 'POST';
    url: string;
    body?: unknown;
    requestId?: string;
    nonce?: string;
    timestamp?: string;
    accessToken?: string;
    signBody?: unknown;
  },
) {
  const requestId = input.requestId ?? `req_${randomUUID()}`;
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(18).toString('base64url');
  const body = input.body === undefined ? '' : JSON.stringify(input.body);
  const signedBody = input.signBody === undefined ? body : JSON.stringify(input.signBody);
  const message = signingMessage({
    method: input.method,
    path: input.url,
    timestamp,
    nonce,
    body: signedBody,
    requestId,
  });
  return fixture.app.inject({
    method: input.method,
    url: input.url,
    headers: {
      authorization: `Bearer ${input.accessToken ?? fixture.accessToken}`,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-body-sha256': Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signedBody)),
      ).toString('hex'),
      'x-device-signature': sign(null, Buffer.from(message), fixture.privateKey).toString('base64'),
      'x-request-id': requestId,
      ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(input.body === undefined ? {} : { payload: body }),
  });
}

export function requestFor(capability: ProviderCapabilityV1, requestId: string): ProviderRequestV1 {
  const base = {
    schema_version: '1.0' as const,
    request_id: requestId,
    model_alias: 'mock-v1',
    quality_tier: 'standard' as const,
    inputs: [] as [],
    request_snapshot_hash: '1'.repeat(64),
    max_cost: { amount: 10, currency: 'CNY' as const },
  };
  switch (capability) {
    case 'text.generate.v1':
      return {
        ...base,
        capability,
        parameters: { prompt: '合成测试', max_tokens: 20, temperature: 0 },
      };
    case 'image.generate.v1':
      return {
        ...base,
        capability,
        parameters: { prompt: '合成测试', width: 512, height: 512, count: 1 },
      };
    case 'image.edit.v1':
      throw new Error('image edit requires an object fixture');
    case 'video.generate.v1':
      return {
        ...base,
        capability,
        parameters: { prompt: '合成测试', duration_seconds: 2, aspect_ratio: '9:16' },
      };
    case 'tts.synthesize.v1':
      return {
        ...base,
        capability,
        parameters: { text: '合成测试', voice_alias: 'voice-v1', format: 'mp3' },
      };
    case 'voice.clone.v1':
    case 'lipsync.generate.v1':
      throw new Error(`${capability} requires object fixtures`);
  }
}
