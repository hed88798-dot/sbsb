import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AlibabaQwen37C3cTextAdapter,
  type AlibabaQwen37C3cTextAdapterOptions,
} from '@app/provider-adapters';
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
import { openDatabase } from '../../packages/local-db/src/index.js';
import { HttpTextCapabilityClient } from '../../packages/provider-client/src/index.js';

export async function openGoldenEvaluationEnvironment(options: {
  directory: string;
  budgetCny: number;
  provider: AlibabaQwen37C3cTextAdapterOptions;
  approval: Omit<
    Parameters<typeof approveProvider>[1],
    'provider' | 'providerModel' | 'capability'
  >;
  listen?: boolean;
}) {
  if (!Number.isFinite(options.budgetCny) || options.budgetCny < 1.560576)
    throw new Error('GOLDEN_INVALID_EXPLICIT_BUDGET');
  if (options.provider.inputUnitCost !== 0.000002 || options.provider.outputUnitCost !== 0.000008)
    throw new Error('GOLDEN_PRICING_IDENTITY_MISMATCH');
  for (const name of ['gateway.db', 'desktop.db'])
    if (existsSync(join(options.directory, name)))
      throw new Error('GOLDEN_DATABASE_ALREADY_EXISTS');
  const adapter = new AlibabaQwen37C3cTextAdapter(options.provider);
  const gatewayDb = openGatewayDatabase({
    dbPath: join(options.directory, 'gateway.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/gateway-sqlite'),
  });
  const desktopDb = (
    await openDatabase({
      dbPath: join(options.directory, 'desktop.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    })
  ).db;
  let gateway: ReturnType<typeof buildGatewayApp> | undefined;
  try {
    const pepper = randomBytes(32).toString('hex');
    const activationCode = randomBytes(16).toString('hex');
    seedLicense(gatewayDb.db, {
      activationCodeHash: hashCredential(activationCode, pepper),
      monthlyBudget: options.budgetCny,
      currency: 'CNY',
    });
    approveProvider(gatewayDb.db, {
      ...options.approval,
      provider: adapter.alias,
      providerModel: adapter.providerModel,
      capability: 'text.generate.v1',
    });
    gateway = buildGatewayApp({
      db: gatewayDb.db,
      credentialPepper: pepper,
      tokenSecret: randomBytes(32).toString('hex'),
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
        device_id: 'dev_real_golden_evaluation',
        public_key_pem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      },
    });
    if (activation.statusCode !== 200) throw new Error('GOLDEN_ACTIVATION_FAILED');
    let backendUrl = 'http://127.0.0.1';
    if (options.listen !== false) {
      await gateway.listen({ host: '127.0.0.1', port: 0 });
      const address = gateway.server.address();
      if (!address || typeof address === 'string')
        throw new Error('GOLDEN_LOCAL_GATEWAY_BIND_FAILED');
      backendUrl += `:${address.port}`;
    }
    const client = new HttpTextCapabilityClient({
      backendUrl,
      accessToken: activation.json<{ access_token: string }>().access_token,
      timeoutMs: 30_000,
      requestSigner: {
        sign: async (input) => {
          const timestamp = String(Math.floor(Date.now() / 1000));
          const nonce = randomBytes(18).toString('base64url');
          return {
            timestamp,
            nonce,
            bodySha256: sha256(input.body),
            signature: sign(
              null,
              Buffer.from(signingMessage({ ...input, timestamp, nonce })),
              privateKey,
            ).toString('base64'),
          };
        },
      },
    });
    const hostname = new URL(options.provider.endpoint).hostname;
    const readyGateway = gateway;
    return {
      gateway: readyGateway,
      gatewayDb: gatewayDb.db,
      desktopDb,
      client,
      forbiddenValues: [
        options.provider.apiKey,
        options.provider.webhookSecret,
        options.provider.endpoint,
        hostname,
        hostname.split('.')[0]!,
        activationCode,
        pepper,
        privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      ],
      async close() {
        await readyGateway.close();
        gatewayDb.close();
        desktopDb.close();
      },
    };
  } catch {
    try {
      await gateway?.close();
    } finally {
      gatewayDb.close();
      desktopDb.close();
    }
    throw new Error('GOLDEN_ENVIRONMENT_INITIALIZATION_FAILED');
  }
}
