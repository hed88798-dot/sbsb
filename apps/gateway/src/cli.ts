import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALIBABA_QWEN37_C3C_PROVIDER_ALIAS,
  ALIBABA_QWEN37_C3C_PROVIDER_MODEL,
  AlibabaQwen37C3cTextAdapter,
  FixedEndpointJsonAdapter,
  OpenAiCompatibleTextAdapter,
  type ProviderAdapter,
} from '@app/provider-adapters';
import { buildGatewayApp } from './app.js';
import { openGatewayDatabase } from './database.js';
import { S3ObjectStoreSigner } from './object-store.js';
import type { ProviderRouteConfig } from './routing.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

interface DeploymentAdapterConfig {
  kind: 'openai-text' | 'async-json' | 'alibaba-qwen37-c3c-text';
  alias: string;
  provider_model: string;
  endpoint: string;
  api_key_env: string;
  webhook_secret_env: string;
  capabilities: ProviderRouteConfig['capability'][];
  unit_cost?: number;
  input_unit_cost?: number;
  output_unit_cost?: number;
  currency: 'CNY' | 'USD';
}

interface DeploymentConfig {
  adapters: DeploymentAdapterConfig[];
  routes: ProviderRouteConfig[];
  releases?: Record<string, unknown>;
}

const configPath = resolve(required('GATEWAY_PROVIDER_CONFIG_PATH'));
const deployment = JSON.parse(readFileSync(configPath, 'utf8')) as DeploymentConfig;
for (const route of deployment.routes) {
  if (route.fallback === ALIBABA_QWEN37_C3C_PROVIDER_ALIAS) {
    throw new Error('The frozen Alibaba C3C adapter cannot be configured as a fallback');
  }
  if (
    route.primary === ALIBABA_QWEN37_C3C_PROVIDER_ALIAS &&
    (route.capability !== 'text.generate.v1' ||
      route.modelAlias !== 'text.semantic-shot-planning' ||
      route.qualityTier !== 'standard' ||
      route.fallback !== undefined)
  ) {
    throw new Error('Alibaba C3C route does not match the frozen no-fallback policy');
  }
}
const adapters: ProviderAdapter[] = deployment.adapters.map((adapter) => {
  const common = {
    alias: adapter.alias,
    providerModel: adapter.provider_model,
    endpoint: adapter.endpoint,
    apiKey: required(adapter.api_key_env),
    webhookSecret: required(adapter.webhook_secret_env),
    currency: adapter.currency,
  };
  if (adapter.kind === 'openai-text') {
    return new OpenAiCompatibleTextAdapter({
      ...common,
      inputUnitCost: adapter.input_unit_cost ?? 0,
      outputUnitCost: adapter.output_unit_cost ?? 0,
    });
  }
  if (adapter.kind === 'alibaba-qwen37-c3c-text') {
    if (
      adapter.alias !== ALIBABA_QWEN37_C3C_PROVIDER_ALIAS ||
      adapter.provider_model !== ALIBABA_QWEN37_C3C_PROVIDER_MODEL ||
      adapter.currency !== 'CNY' ||
      adapter.capabilities.length !== 1 ||
      adapter.capabilities[0] !== 'text.generate.v1'
    ) {
      throw new Error('Alibaba C3C adapter identity does not match the frozen deployment policy');
    }
    return new AlibabaQwen37C3cTextAdapter({
      endpoint: adapter.endpoint,
      apiKey: required(adapter.api_key_env),
      webhookSecret: required(adapter.webhook_secret_env),
      inputUnitCost: adapter.input_unit_cost ?? 0,
      outputUnitCost: adapter.output_unit_cost ?? 0,
      currency: 'CNY',
    });
  }
  return new FixedEndpointJsonAdapter({
    ...common,
    capabilities: adapter.capabilities,
    unitCost: adapter.unit_cost ?? 0,
  });
});

const database = openGatewayDatabase({
  dbPath: resolve(required('GATEWAY_DB_PATH')),
  migrationsDirectory: resolve(process.env.GATEWAY_MIGRATIONS_PATH ?? 'migrations/gateway-sqlite'),
});
const app = buildGatewayApp({
  db: database.db,
  tokenSecret: required('GATEWAY_TOKEN_SECRET'),
  credentialPepper: required('GATEWAY_CREDENTIAL_PEPPER'),
  objectStore: new S3ObjectStoreSigner({
    endpoint: required('S3_ENDPOINT'),
    bucket: required('S3_BUCKET'),
    region: required('S3_REGION'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  }),
  adapters,
  routes: deployment.routes,
  ...(deployment.releases ? { releaseMetadata: deployment.releases } : {}),
});

const close = async () => {
  await app.close();
  database.close();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
await app.listen({
  host: process.env.GATEWAY_HOST ?? '127.0.0.1',
  port: Number(process.env.GATEWAY_PORT ?? 4400),
});
