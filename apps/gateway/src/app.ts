import { randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  providerRequestV1Schema,
  textGatewayRequestV1Schema,
  type ProviderJobV1,
  type ProviderRequestV1,
} from '@app/contracts';
import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderStatus,
} from '@app/provider-adapters';
import type { ObjectStoreSigner } from './object-store.js';
import { routeProvider, type ProviderRouteConfig } from './routing.js';
import {
  canonicalSignedRequest,
  hashCredential,
  issueTokenPair,
  sha256,
  verifyAccessToken,
  verifyDeviceRequest,
} from './security.js';
import { GatewayStore, GatewayStoreError, type RoutedProvider } from './store.js';

export interface GatewayAppOptions {
  db: Database.Database;
  tokenSecret: string;
  credentialPepper: string;
  objectStore: ObjectStoreSigner;
  adapters: readonly ProviderAdapter[];
  routes: readonly ProviderRouteConfig[];
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  replayWindowSeconds?: number;
  objectTtlSeconds?: number;
  releaseMetadata?: Readonly<Record<string, unknown>>;
  deploymentRegion?: string;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
  now?: () => Date;
}

interface AuthContext {
  licenseId: string;
  deviceId: string;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(401, 'MISSING_AUTH_HEADER', 'Authentication failed');
  }
  return value;
}

function bodyText(request: FastifyRequest): string {
  if (request.body === undefined || request.body === null) return '';
  return typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
}

function publicError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof GatewayStoreError) {
    const status =
      error.code === 'IDEMPOTENCY_CONFLICT'
        ? 409
        : error.code.includes('BUDGET') || error.code.includes('COST')
          ? 402
          : 400;
    return new HttpError(status, error.code, error.message);
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'Gateway request failed');
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Invalid request');
  }
  return value as Record<string, unknown>;
}

export function buildGatewayApp(options: GatewayAppOptions): FastifyInstance {
  if (options.tokenSecret.length < 32 || options.credentialPepper.length < 32) {
    throw new Error('Gateway token secrets must contain at least 32 characters');
  }
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const store = new GatewayStore(options.db);
  const adapters = new Map(options.adapters.map((adapter) => [adapter.alias, adapter]));
  const now = () => (options.now ?? (() => new Date()))();
  const textResults = new Map<string, string>();
  const providerFailures = new Map<string, { count: number; openUntil: number }>();
  const rateWindows = new Map<string, { count: number; resetAt: number }>();
  app.addContentTypeParser(
    'application/webhook+json',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  app.setErrorHandler((error, request, reply) => {
    const safe = publicError(error);
    void reply.status(safe.statusCode).send({
      schema_version: '1.0',
      code: safe.code,
      message: safe.message,
      retryable: safe.retryable,
      request_id:
        typeof request.headers['x-request-id'] === 'string'
          ? request.headers['x-request-id']
          : undefined,
    });
  });

  function enforceRate(key: string, limit: number, windowMs: number): void {
    const current = now().getTime();
    const existing = rateWindows.get(key);
    if (!existing || existing.resetAt <= current) {
      rateWindows.set(key, { count: 1, resetAt: current + windowMs });
      return;
    }
    if (existing.count >= limit) {
      throw new HttpError(429, 'RATE_LIMITED', 'Request rate exceeded', true);
    }
    existing.count += 1;
  }

  function verifySignedRequest(request: FastifyRequest, deviceId: string): void {
    const timestamp = header(request, 'x-timestamp');
    const nonce = header(request, 'x-nonce');
    const claimedBodyHash = header(request, 'x-body-sha256');
    const signature = header(request, 'x-device-signature');
    const requestId = header(request, 'x-request-id');
    if (!/^[A-Za-z0-9_-]{16,128}$/u.test(nonce)) {
      throw new HttpError(401, 'INVALID_NONCE', 'Authentication failed');
    }
    const timestampSeconds = Number(timestamp);
    const nowMs = now().getTime();
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowMs - timestampSeconds * 1000) > (options.replayWindowSeconds ?? 300) * 1000
    ) {
      throw new HttpError(401, 'STALE_REQUEST', 'Authentication failed');
    }
    const actualBodyHash = sha256(bodyText(request));
    if (actualBodyHash !== claimedBodyHash) {
      throw new HttpError(401, 'BODY_HASH_MISMATCH', 'Authentication failed');
    }
    const device = options.db
      .prepare(
        `SELECT d.public_key_pem, d.status AS device_status, l.status AS license_status
         FROM devices d JOIN licenses l ON l.license_id = d.license_id WHERE d.device_id = ?`,
      )
      .get(deviceId) as
      | { public_key_pem: string; device_status: string; license_status: string }
      | undefined;
    if (!device || device.device_status !== 'ACTIVE') {
      throw new HttpError(401, 'DEVICE_REVOKED', 'Authentication failed');
    }
    if (device.license_status !== 'ACTIVE') {
      throw new HttpError(401, 'LICENSE_REVOKED', 'Authentication failed');
    }
    const signed = {
      method: request.method,
      path: request.url.split('?')[0] ?? request.url,
      timestamp,
      nonce,
      bodyHash: claimedBodyHash,
      requestId,
    };
    if (!verifyDeviceRequest(device.public_key_pem, signature, signed)) {
      throw new HttpError(401, 'INVALID_DEVICE_SIGNATURE', 'Authentication failed');
    }
    options.db.prepare('DELETE FROM replay_nonces WHERE expires_at <= ?').run(now().toISOString());
    try {
      options.db
        .prepare(
          'INSERT INTO replay_nonces(device_id, nonce, expires_at, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(
          deviceId,
          nonce,
          new Date(nowMs + (options.replayWindowSeconds ?? 300) * 1000).toISOString(),
          new Date(nowMs).toISOString(),
        );
    } catch {
      throw new HttpError(401, 'REPLAY_DETECTED', 'Authentication failed');
    }
  }

  function authenticate(request: FastifyRequest): AuthContext {
    const authorization = header(request, 'authorization');
    if (!authorization.startsWith('Bearer ')) {
      throw new HttpError(401, 'INVALID_ACCESS_TOKEN', 'Authentication failed');
    }
    let claims;
    try {
      claims = verifyAccessToken(authorization.slice(7), options.tokenSecret, now().getTime());
    } catch (error) {
      throw new HttpError(
        401,
        error instanceof Error && error.message === 'ACCESS_TOKEN_EXPIRED'
          ? 'ACCESS_TOKEN_EXPIRED'
          : 'INVALID_ACCESS_TOKEN',
        'Authentication failed',
      );
    }
    const token = options.db
      .prepare(
        `SELECT a.revoked_at, a.expires_at, d.status AS device_status, l.status AS license_status
         FROM access_tokens a
         JOIN devices d ON d.device_id = a.device_id
         JOIN licenses l ON l.license_id = d.license_id
         WHERE a.token_id = ? AND a.device_id = ? AND d.license_id = ?`,
      )
      .get(claims.token_id, claims.device_id, claims.license_id) as
      | {
          revoked_at: string | null;
          expires_at: string;
          device_status: string;
          license_status: string;
        }
      | undefined;
    if (
      !token ||
      token.revoked_at ||
      token.expires_at <= now().toISOString() ||
      token.device_status !== 'ACTIVE' ||
      token.license_status !== 'ACTIVE'
    ) {
      throw new HttpError(401, 'ACCESS_REVOKED', 'Authentication failed');
    }
    verifySignedRequest(request, claims.device_id);
    return { licenseId: claims.license_id, deviceId: claims.device_id };
  }

  function verifyInputObjects(auth: AuthContext, providerRequest: ProviderRequestV1): void {
    for (const input of providerRequest.inputs) {
      const object = options.db
        .prepare(
          `SELECT sha256, expires_at, state FROM object_refs
           WHERE object_ref = ? AND license_id = ? AND device_id = ?`,
        )
        .get(input.object_ref, auth.licenseId, auth.deviceId) as
        | { sha256: string; expires_at: string; state: string }
        | undefined;
      if (
        !object ||
        object.sha256 !== input.sha256 ||
        object.expires_at <= now().toISOString() ||
        ['EXPIRED', 'DELETED'].includes(object.state)
      ) {
        throw new HttpError(400, 'INVALID_OBJECT_REF', 'Input object is invalid or expired');
      }
    }
  }

  async function submitCreatedJob(
    job: ProviderJobV1,
    providerRequest: ProviderRequestV1,
    route: RoutedProvider,
  ): Promise<string | undefined> {
    const startedAt = now().getTime();
    let activeAdapter = route.primary;
    try {
      let submission;
      try {
        submission = await activeAdapter.submit(providerRequest);
        providerFailures.delete(activeAdapter.alias);
      } catch (error) {
        if (
          error instanceof ProviderAdapterError &&
          ['RATE_LIMITED', 'UPSTREAM_5XX', 'UNAVAILABLE'].includes(error.errorClass)
        ) {
          const previous = providerFailures.get(activeAdapter.alias)?.count ?? 0;
          const count = previous + 1;
          providerFailures.set(activeAdapter.alias, {
            count,
            openUntil:
              count >= (options.circuitBreakerThreshold ?? 3)
                ? now().getTime() + (options.circuitBreakerCooldownMs ?? 60_000)
                : 0,
          });
        }
        if (
          error instanceof ProviderAdapterError &&
          ['RATE_LIMITED', 'UPSTREAM_5XX', 'UNAVAILABLE'].includes(error.errorClass) &&
          route.fallback
        ) {
          activeAdapter = route.fallback;
          store.switchProvider(job.job_id, activeAdapter, error.errorClass, now().toISOString());
          submission = await activeAdapter.submit(providerRequest);
          providerFailures.delete(activeAdapter.alias);
        } else {
          throw error;
        }
      }
      store.attachProviderJob(job.job_id, submission.providerJobId, now().toISOString());
      if (submission.state === 'SUCCEEDED') {
        store.settle(job.job_id, submission, now().getTime() - startedAt, now().toISOString());
        if (submission.text !== undefined) textResults.set(job.job_id, submission.text);
      } else {
        store.transition(job.job_id, submission.state, now().toISOString());
      }
      return submission.text;
    } catch (error) {
      const latency = now().getTime() - startedAt;
      if (error instanceof ProviderAdapterError && error.errorClass === 'TIMEOUT_UNKNOWN') {
        store.markUnknown(job.job_id, error.providerJobId, error.errorClass, now().toISOString());
        return undefined;
      }
      const errorClass = error instanceof ProviderAdapterError ? error.errorClass : 'INTERNAL';
      store.failJob(
        job.job_id,
        errorClass,
        'PROVIDER_REQUEST_FAILED',
        latency,
        now().toISOString(),
      );
      return undefined;
    }
  }

  async function createJob(auth: AuthContext, providerRequest: ProviderRequestV1) {
    verifyInputObjects(auth, providerRequest);
    const requestHash = sha256(JSON.stringify(providerRequest));
    const currentTime = now().getTime();
    const unavailableProviders = new Set(
      [...providerFailures]
        .filter(([, state]) => state.openUntil > currentTime)
        .map(([provider]) => provider),
    );
    const route = routeProvider({
      db: options.db,
      request: providerRequest,
      routes: options.routes,
      adapters,
      now: now().toISOString(),
      ...(options.deploymentRegion ? { deploymentRegion: options.deploymentRegion } : {}),
      unavailableProviders,
    });
    const reserved = store.reserveAndCreate({
      licenseId: auth.licenseId,
      deviceId: auth.deviceId,
      request: providerRequest,
      requestHash,
      route,
      now: now().toISOString(),
    });
    const text = reserved.created
      ? await submitCreatedJob(reserved.job, providerRequest, route)
      : textResults.get(reserved.job.job_id);
    return { job: store.getJob(reserved.job.job_id)!, created: reserved.created, text };
  }

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async () => {
    options.db.prepare('SELECT 1').get();
    return { status: 'ready' };
  });

  app.post('/v1/activate', async (request, reply) => {
    enforceRate(`activate:ip:${request.ip}`, 10, 10 * 60_000);
    const body = parseObject(request.body);
    const activationCode = typeof body.activation_code === 'string' ? body.activation_code : '';
    const deviceId = typeof body.device_id === 'string' ? body.device_id : '';
    const publicKey = typeof body.public_key_pem === 'string' ? body.public_key_pem : '';
    if (
      !/^[A-Za-z0-9._:-]{8,128}$/u.test(activationCode) ||
      !/^dev_[A-Za-z0-9_-]{8,128}$/u.test(deviceId) ||
      publicKey.length < 64 ||
      publicKey.length > 2_000
    ) {
      throw new HttpError(400, 'INVALID_ACTIVATION', 'Activation failed');
    }
    const license = options.db
      .prepare(
        `SELECT license_id, status, device_limit FROM licenses WHERE activation_code_hash = ?`,
      )
      .get(hashCredential(activationCode, options.credentialPepper)) as
      | { license_id: string; status: string; device_limit: number }
      | undefined;
    if (!license || license.status !== 'ACTIVE') {
      throw new HttpError(401, 'INVALID_ACTIVATION', 'Activation failed');
    }
    const pair = options.db.transaction(() => {
      const existing = options.db
        .prepare('SELECT public_key_pem, status FROM devices WHERE device_id = ?')
        .get(deviceId) as { public_key_pem: string; status: string } | undefined;
      if (existing && (existing.public_key_pem !== publicKey || existing.status !== 'ACTIVE')) {
        throw new HttpError(409, 'DEVICE_CONFLICT', 'Activation failed');
      }
      if (!existing) {
        const count = options.db
          .prepare(
            "SELECT COUNT(*) AS count FROM devices WHERE license_id = ? AND status = 'ACTIVE'",
          )
          .get(license.license_id) as { count: number };
        if (count.count >= license.device_limit) {
          throw new HttpError(409, 'DEVICE_LIMIT', 'Activation failed');
        }
        options.db
          .prepare(
            `INSERT INTO devices(device_id, license_id, public_key_pem, status, created_at)
             VALUES (?, ?, ?, 'ACTIVE', ?)`,
          )
          .run(deviceId, license.license_id, publicKey, now().toISOString());
      }
      return issueTokenPair(options.db, {
        licenseId: license.license_id,
        deviceId,
        tokenSecret: options.tokenSecret,
        credentialPepper: options.credentialPepper,
        nowMs: now().getTime(),
        ...(options.accessTtlSeconds === undefined
          ? {}
          : { accessTtlSeconds: options.accessTtlSeconds }),
        ...(options.refreshTtlSeconds === undefined
          ? {}
          : { refreshTtlSeconds: options.refreshTtlSeconds }),
      });
    })();
    return reply.send({
      schema_version: '1.0',
      access_token: pair.accessToken,
      access_expires_at: pair.accessExpiresAt,
      refresh_token: pair.refreshToken,
      refresh_expires_at: pair.refreshExpiresAt,
    });
  });

  app.post('/v1/token/refresh', async (request) => {
    enforceRate(`refresh:ip:${request.ip}`, 20, 10 * 60_000);
    const body = parseObject(request.body);
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    const [credentialId, secret, extra] = refreshToken.split('.');
    if (!credentialId || !secret || extra) {
      throw new HttpError(401, 'INVALID_REFRESH', 'Refresh failed');
    }
    const credential = options.db
      .prepare(
        `SELECT r.device_id, r.secret_hash, r.expires_at, r.revoked_at, d.license_id
         FROM refresh_credentials r JOIN devices d ON d.device_id = r.device_id
         WHERE r.credential_id = ?`,
      )
      .get(credentialId) as
      | {
          device_id: string;
          secret_hash: string;
          expires_at: string;
          revoked_at: string | null;
          license_id: string;
        }
      | undefined;
    if (
      !credential ||
      credential.revoked_at ||
      credential.expires_at <= now().toISOString() ||
      hashCredential(secret, options.credentialPepper) !== credential.secret_hash
    ) {
      throw new HttpError(401, 'INVALID_REFRESH', 'Refresh failed');
    }
    verifySignedRequest(request, credential.device_id);
    const pair = options.db.transaction(() => {
      const revoked = options.db
        .prepare(
          'UPDATE refresh_credentials SET revoked_at = ? WHERE credential_id = ? AND revoked_at IS NULL',
        )
        .run(now().toISOString(), credentialId);
      if (revoked.changes !== 1) throw new HttpError(401, 'INVALID_REFRESH', 'Refresh failed');
      const issued = issueTokenPair(options.db, {
        licenseId: credential.license_id,
        deviceId: credential.device_id,
        tokenSecret: options.tokenSecret,
        credentialPepper: options.credentialPepper,
        nowMs: now().getTime(),
        ...(options.accessTtlSeconds === undefined
          ? {}
          : { accessTtlSeconds: options.accessTtlSeconds }),
        ...(options.refreshTtlSeconds === undefined
          ? {}
          : { refreshTtlSeconds: options.refreshTtlSeconds }),
      });
      options.db
        .prepare('UPDATE refresh_credentials SET replaced_by = ? WHERE credential_id = ?')
        .run(issued.credentialId, credentialId);
      return issued;
    })();
    return {
      schema_version: '1.0',
      access_token: pair.accessToken,
      access_expires_at: pair.accessExpiresAt,
      refresh_token: pair.refreshToken,
      refresh_expires_at: pair.refreshExpiresAt,
    };
  });

  app.post('/v1/jobs', async (request, reply) => {
    const auth = authenticate(request);
    const parsed = providerRequestV1Schema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_PROVIDER_REQUEST', 'Invalid request');
    enforceRate(`jobs:ip:${request.ip}`, 120, 60_000);
    enforceRate(`jobs:license:${auth.licenseId}`, 60, 60_000);
    enforceRate(`jobs:device:${auth.deviceId}`, 60, 60_000);
    enforceRate(`jobs:capability:${auth.licenseId}:${parsed.data.capability}`, 60, 60_000);
    const created = await createJob(auth, parsed.data);
    return reply.status(created.created ? 201 : 200).send(created.job);
  });

  app.get('/v1/jobs/:id', async (request) => {
    const auth = authenticate(request);
    const parameters = request.params as { id?: string };
    const job = parameters.id ? store.getJob(parameters.id, auth.licenseId) : null;
    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Job not found');
    const row = store.getJobRow(job.job_id)!;
    if (['QUEUED', 'RUNNING', 'UNKNOWN'].includes(job.state) && row.provider_job_id) {
      const adapter = adapters.get(row.provider);
      if (adapter) {
        try {
          const status = await adapter.getJob(row.provider_job_id);
          if (status.state === 'SUCCEEDED')
            store.settle(job.job_id, status, row.latency_ms ?? 0, now().toISOString());
          else
            store.transition(
              job.job_id,
              status.state,
              now().toISOString(),
              status.errorClass ?? null,
            );
        } catch {
          store.transition(job.job_id, 'UNKNOWN', now().toISOString(), 'STATUS_UNAVAILABLE');
        }
      }
    }
    return store.getJob(job.job_id)!;
  });

  app.post('/v1/uploads/presign', async (request) => {
    const auth = authenticate(request);
    enforceRate(`presign:license:${auth.licenseId}`, 30, 60_000);
    const body = parseObject(request.body);
    const filename = typeof body.filename === 'string' ? body.filename : '';
    const mimeType = typeof body.mime_type === 'string' ? body.mime_type : '';
    const sizeBytes = typeof body.size_bytes === 'number' ? body.size_bytes : -1;
    const checksum = typeof body.sha256 === 'string' ? body.sha256 : '';
    const extension = /\.([A-Za-z0-9]{2,5})$/u.exec(filename)?.[1]?.toLowerCase() ?? '';
    const allowed = new Map([
      ['image/jpeg', { extensions: ['jpg', 'jpeg'], max: 20 * 1024 * 1024 }],
      ['image/png', { extensions: ['png'], max: 20 * 1024 * 1024 }],
      ['video/mp4', { extensions: ['mp4'], max: 500 * 1024 * 1024 }],
      ['audio/mpeg', { extensions: ['mp3'], max: 50 * 1024 * 1024 }],
      ['audio/wav', { extensions: ['wav'], max: 100 * 1024 * 1024 }],
    ]);
    const policy = allowed.get(mimeType);
    if (
      !policy ||
      !policy.extensions.includes(extension) ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > policy.max ||
      !/^[a-f0-9]{64}$/u.test(checksum)
    ) {
      throw new HttpError(400, 'UPLOAD_POLICY_REJECTED', 'Upload does not meet policy');
    }
    const objectRef = `obj_${randomBytes(24).toString('base64url')}`;
    const objectKey = `transient/${now().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    const expiresInSeconds = Math.min(options.objectTtlSeconds ?? 86_400, 86_400);
    const presigned = options.objectStore.presignPut({
      objectKey,
      mimeType,
      sha256Hex: checksum,
      expiresInSeconds: Math.min(expiresInSeconds, 900),
      now: now(),
    });
    const lifecycleExpiresAt = new Date(now().getTime() + expiresInSeconds * 1000).toISOString();
    options.db
      .prepare(
        `INSERT INTO object_refs(
          object_ref, license_id, device_id, object_key, mime_type, extension,
          size_bytes, sha256, expires_at, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRESIGNED', ?)`,
      )
      .run(
        objectRef,
        auth.licenseId,
        auth.deviceId,
        objectKey,
        mimeType,
        extension,
        sizeBytes,
        checksum,
        lifecycleExpiresAt,
        now().toISOString(),
      );
    return {
      schema_version: '1.0',
      object_ref: objectRef,
      upload_url: presigned.uploadUrl,
      required_headers: presigned.requiredHeaders,
      upload_expires_at: presigned.expiresAt,
      lifecycle_expires_at: lifecycleExpiresAt,
    };
  });

  app.get('/v1/config/providers', async (request) => {
    authenticate(request);
    return {
      schema_version: '1.0',
      protocol_version: '1.0',
      models: options.routes.map((route) => ({
        capability: route.capability,
        model_alias: route.modelAlias,
        quality_tier: route.qualityTier,
      })),
    };
  });

  app.get('/v1/app/releases/:channel', async (request) => {
    const channel = (request.params as { channel?: string }).channel;
    if (!channel || !['dev', 'beta', 'stable'].includes(channel)) {
      throw new HttpError(404, 'CHANNEL_NOT_FOUND', 'Release channel not found');
    }
    const metadata = options.releaseMetadata?.[channel];
    if (!metadata) throw new HttpError(404, 'RELEASE_NOT_FOUND', 'Release not found');
    return metadata;
  });

  app.post('/v1/text/generate', async (request) => {
    const auth = authenticate(request);
    const parsed = textGatewayRequestV1Schema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_TEXT_REQUEST', 'Invalid request');
    const generic = providerRequestV1Schema.parse({
      schema_version: '1.0',
      request_id: parsed.data.request_id,
      capability: 'text.generate.v1',
      model_alias: parsed.data.model_alias,
      quality_tier: 'standard',
      inputs: [],
      parameters: { prompt: parsed.data.prompt, max_tokens: 2048, temperature: 0.7 },
      request_snapshot_hash: parsed.data.request_snapshot_hash,
      max_cost: { amount: 1, currency: 'CNY' },
    });
    const result = await createJob(auth, generic);
    if (result.job.state !== 'SUCCEEDED') {
      throw new HttpError(503, 'TEXT_PROVIDER_PENDING', 'Text provider result is not ready', true);
    }
    return {
      schema_version: '1.0',
      request_id: parsed.data.request_id,
      text: result.text ?? '',
      provider_alias: store.getJobRow(result.job.job_id)!.provider,
      provider_model: store.getJobRow(result.job.job_id)!.provider_model,
      latency_ms: store.getJobRow(result.job.job_id)!.latency_ms ?? 0,
      billed_units: store.getJobRow(result.job.job_id)!.billed_units,
      request_snapshot_hash: parsed.data.request_snapshot_hash,
    };
  });

  app.post('/v1/webhooks/:provider', async (request, reply) => {
    const provider = (request.params as { provider?: string }).provider;
    const adapter = provider ? adapters.get(provider) : undefined;
    if (!adapter || typeof request.body !== 'string') {
      throw new HttpError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found');
    }
    const signature = header(request, 'x-provider-signature');
    let event;
    try {
      event = adapter.verifyWebhook(request.body, signature);
    } catch {
      throw new HttpError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook authentication failed');
    }
    const applied = options.db.transaction(() => {
      const inserted = options.db
        .prepare(
          `INSERT OR IGNORE INTO webhook_events(provider, event_id, provider_job_id, state, received_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(provider, event.eventId, event.providerJobId, event.state, now().toISOString());
      if (inserted.changes === 0) return false;
      const row = options.db
        .prepare('SELECT job_id FROM provider_jobs WHERE provider = ? AND provider_job_id = ?')
        .get(provider, event.providerJobId) as { job_id: string } | undefined;
      if (!row) return true;
      const status: ProviderStatus = {
        providerJobId: event.providerJobId,
        state: event.state,
        finalCost: event.finalCost,
        billedUnits: event.billedUnits,
        artifacts: event.artifacts,
        ...(event.errorClass ? { errorClass: event.errorClass } : {}),
      };
      if (event.state === 'SUCCEEDED') store.settle(row.job_id, status, 0, now().toISOString());
      else store.transition(row.job_id, event.state, now().toISOString(), event.errorClass ?? null);
      return true;
    })();
    return reply.status(202).send({ accepted: true, duplicate: !applied });
  });

  return app;
}

export function signingMessage(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
  requestId: string;
}): string {
  return canonicalSignedRequest({
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodyHash: sha256(input.body),
    requestId: input.requestId,
  });
}
