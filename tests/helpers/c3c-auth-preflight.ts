import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AlibabaQwen37C3cTextAdapter,
  isProviderErrorClass,
  sanitizeProviderDiagnostic,
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
import {
  HttpTextCapabilityClient,
  isGatewayClientError,
} from '../../packages/provider-client/src/index.js';
import { semanticShotPlanProposalJsonSchema } from '../../apps/desktop/src/main/semantic-shot-plan-proposal-schema.generated.js';
import { observeGoldenProviderUsage } from './golden-provider-usage.js';

export const AUTH_PREFLIGHT_PROMPT =
  'AUTH_PREFLIGHT_ONLY. Return only this synthetic JSON object, with no additional content: ' +
  '{"schema_version":"1.0","segmentation_state":"RESOLVED","review_warnings":[],"units":[{"exact_fragment":"AUTH_PREFLIGHT_ONLY","route":"NO_MATCH","route_state":"RESOLVED","continuity_action":"START_NEW","continuity_state":"RESOLVED","rationale":"AUTH_PREFLIGHT_ONLY","review_warnings":[]}]}';

export const AUTH_PREFLIGHT_STRUCTURED_OUTPUT = {
  mode: 'JSON_SCHEMA_STRICT' as const,
  schema_name: 'ShotPlanSemanticProposalV1',
  schema: semanticShotPlanProposalJsonSchema,
};

export async function openC3cAuthPreflight(options: {
  directory: string;
  provider: AlibabaQwen37C3cTextAdapterOptions;
  approval: Omit<
    Parameters<typeof approveProvider>[1],
    'provider' | 'providerModel' | 'capability'
  >;
  listen?: boolean;
}) {
  if (options.provider.inputUnitCost !== 0.000002 || options.provider.outputUnitCost !== 0.000008)
    throw new Error('AUTH_PREFLIGHT_PRICING_IDENTITY_MISMATCH');
  for (const name of ['gateway.db'])
    if (existsSync(join(options.directory, name)))
      throw new Error('AUTH_PREFLIGHT_DATABASE_ALREADY_EXISTS');
  const adapter = new AlibabaQwen37C3cTextAdapter(options.provider);
  const gatewayDb = openGatewayDatabase({
    dbPath: join(options.directory, 'gateway.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/gateway-sqlite'),
  });
  let gateway: ReturnType<typeof buildGatewayApp> | undefined;
  try {
    const pepper = randomBytes(32).toString('hex');
    const activationCode = randomBytes(16).toString('hex');
    seedLicense(gatewayDb.db, {
      activationCodeHash: hashCredential(activationCode, pepper),
      monthlyBudget: 2,
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
        device_id: 'dev_c3c_auth_preflight',
        public_key_pem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      },
    });
    if (activation.statusCode !== 200) throw new Error('AUTH_PREFLIGHT_ACTIVATION_FAILED');
    let backendUrl = 'http://127.0.0.1';
    if (options.listen !== false) {
      await gateway.listen({ host: '127.0.0.1', port: 0 });
      const address = gateway.server.address();
      if (!address || typeof address === 'string')
        throw new Error('AUTH_PREFLIGHT_LOCAL_GATEWAY_BIND_FAILED');
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
    const forbiddenValues = [
      options.provider.apiKey,
      options.provider.webhookSecret,
      options.provider.endpoint,
      hostname,
      hostname.split('.')[0]!,
      activationCode,
      pepper,
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    ];
    let invoked = false;
    return {
      gateway: readyGateway,
      gatewayDb: gatewayDb.db,
      async run() {
        if (invoked) throw new Error('AUTH_PREFLIGHT_ALREADY_INVOKED');
        invoked = true;
        const requestId = `auth_preflight_${randomBytes(16).toString('hex')}`;
        const usage = observeGoldenProviderUsage(options.provider.endpoint);
        usage.begin(requestId);
        let classification = 'SUCCESS';
        let retryable = false;
        let returnedTextNonempty = false;
        let identityMatches = false;
        try {
          // Exactly one direct client operation; no proposer and no retry loop.
          const result = await client.generate({
            schema_version: '1.0',
            request_id: requestId,
            capability: 'text.generate.v1',
            model_alias: 'text.semantic-shot-planning',
            prompt: AUTH_PREFLIGHT_PROMPT,
            structured_output: AUTH_PREFLIGHT_STRUCTURED_OUTPUT,
            request_snapshot_hash: sha256(AUTH_PREFLIGHT_PROMPT),
          });
          returnedTextNonempty = result.text.trim().length > 0;
          identityMatches =
            result.request_id === requestId &&
            result.provider_alias === adapter.alias &&
            result.provider_model === adapter.providerModel;
        } catch (error) {
          classification =
            isGatewayClientError(error) && isProviderErrorClass(error.code)
              ? error.code
              : 'GATEWAY_FAILURE';
          retryable = isGatewayClientError(error) && error.retryable;
        } finally {
          usage.end();
          usage.close();
        }
        const observed = usage.get(requestId);
        const job = gatewayDb.db
          .prepare('SELECT job_id,state,error_class FROM provider_jobs WHERE request_id=?')
          .get(requestId) as
          | { job_id: string; state: string; error_class: string | null }
          | undefined;
        if (classification !== 'SUCCESS' && isProviderErrorClass(job?.error_class))
          classification = job.error_class;
        const settlement = gatewayDb.db
          .prepare(
            "SELECT COUNT(*) AS count,COALESCE(SUM(final_cost),0) AS cost FROM usage_events WHERE request_id=? AND event_type='SETTLEMENT'",
          )
          .get(requestId) as { count: number; cost: number };
        const row = job
          ? (gatewayDb.db
              .prepare(
                "SELECT metadata_json FROM audit_events WHERE target_id=? AND action='PROVIDER_FAILURE_DIAGNOSTIC' AND length(metadata_json)<=4096 ORDER BY rowid DESC LIMIT 1",
              )
              .get(job.job_id) as { metadata_json: string } | undefined)
          : undefined;
        let diagnostic;
        try {
          const metadata = row ? JSON.parse(row.metadata_json) : {};
          diagnostic = sanitizeProviderDiagnostic({
            httpStatus: metadata.http_status,
            providerCode: metadata.provider_code,
            providerRequestId: metadata.provider_request_id,
          });
        } catch {
          /* No raw error or untrusted metadata is retained. */
        }
        const knownRejected =
          observed.provider_requests === 1 &&
          observed.http_status !== null &&
          observed.http_status >= 400 &&
          observed.http_status <= 599 &&
          job?.state === 'FAILED' &&
          settlement.count === 0;
        const settledCost =
          settlement.count === 1
            ? settlement.cost
            : knownRejected || observed.provider_requests === 0
              ? 0
              : null;
        const usageMatches =
          observed.prompt_tokens !== null &&
          observed.completion_tokens !== null &&
          observed.total_tokens !== null &&
          observed.total_tokens === observed.prompt_tokens + observed.completion_tokens &&
          observed.prompt_tokens <= 256000 &&
          observed.completion_tokens <= 131072 &&
          Math.abs(
            observed.prompt_tokens * 0.000002 +
              observed.completion_tokens * 0.000008 -
              settlement.cost,
          ) <= 1e-10;
        let failure = classification === 'SUCCESS' ? null : classification;
        if (
          classification === 'SUCCESS' &&
          (!returnedTextNonempty ||
            !identityMatches ||
            job?.state !== 'SUCCEEDED' ||
            settlement.count !== 1 ||
            !usageMatches)
        )
          failure = 'INCOMPLETE_SUCCESS_EVIDENCE';
        if (observed.provider_requests !== 1) failure = 'PROVIDER_REQUEST_COUNT_MISMATCH';
        if (observed.thinking_state === 'NONEMPTY') failure = 'THINKING_POLICY_DRIFT';
        if (settledCost !== null && settledCost > 0.05) failure = 'PREFLIGHT_COST_LIMIT';
        const report = {
          schema_version: 'c3c-auth-preflight-v1',
          purpose: 'AUTH_PREFLIGHT_ONLY',
          result: failure ? 'FAIL' : 'PASS',
          classification,
          failure_reason: failure,
          request_id: requestId,
          provider_alias: adapter.alias,
          provider_model: adapter.providerModel,
          model_alias: 'text.semantic-shot-planning',
          structured_output_mode: 'JSON_SCHEMA_STRICT',
          schema_name: 'ShotPlanSemanticProposalV1',
          temperature: 0.7,
          enable_thinking: false,
          prompt_sha256: sha256(AUTH_PREFLIGHT_PROMPT),
          ...observed,
          provider_code: diagnostic?.providerCode ?? null,
          provider_request_id: diagnostic?.providerRequestId ?? null,
          retryable,
          returned_text_nonempty: returnedTextNonempty,
          identity_matches: identityMatches,
          gateway_state: job?.state ?? null,
          settlement_count: settlement.count,
          settled_cost_cny: settledCost,
          temporary_license_budget_cny: 2,
          preflight_settled_cost_target_cny: 0.05,
          semantic_acceptance: 'NOT_EVALUATED',
          source_document_created: false,
          candidate_created: false,
        };
        const serialized = JSON.stringify(report);
        if (
          forbiddenValues
            .filter(Boolean)
            .some(
              (secret) =>
                serialized.includes(secret) ||
                serialized.includes(JSON.stringify(secret).slice(1, -1)),
            )
        )
          throw new Error('AUTH_PREFLIGHT_UNSAFE_EVIDENCE');
        return report;
      },
      async close() {
        await readyGateway.close();
        gatewayDb.close();
      },
    };
  } catch {
    try {
      await gateway?.close();
    } finally {
      gatewayDb.close();
    }
    throw new Error('AUTH_PREFLIGHT_ENVIRONMENT_INITIALIZATION_FAILED');
  }
}
