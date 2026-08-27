import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import type Database from 'better-sqlite3';

export interface AccessTokenClaims {
  token_id: string;
  license_id: string;
  device_id: string;
  issued_at: number;
  expires_at: number;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashCredential(secret: string, pepper: string): string {
  return createHmac('sha256', pepper).update(secret).digest('hex');
}

export function randomCredential(): string {
  return randomBytes(32).toString('base64url');
}

export function signAccessToken(claims: AccessTokenClaims, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): AccessTokenClaims {
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra) throw new Error('INVALID_ACCESS_TOKEN');
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  if (!safeEqual(signature, expected)) throw new Error('INVALID_ACCESS_TOKEN');
  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessTokenClaims;
  } catch {
    throw new Error('INVALID_ACCESS_TOKEN');
  }
  if (!claims.token_id || !claims.license_id || !claims.device_id) {
    throw new Error('INVALID_ACCESS_TOKEN');
  }
  if (claims.expires_at * 1000 <= nowMs) throw new Error('ACCESS_TOKEN_EXPIRED');
  return claims;
}

export function issueTokenPair(
  db: Database.Database,
  input: {
    licenseId: string;
    deviceId: string;
    tokenSecret: string;
    credentialPepper: string;
    nowMs?: number;
    accessTtlSeconds?: number;
    refreshTtlSeconds?: number;
  },
): {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  credentialId: string;
} {
  const nowMs = input.nowMs ?? Date.now();
  const accessTtl = input.accessTtlSeconds ?? 900;
  const refreshTtl = input.refreshTtlSeconds ?? 30 * 24 * 60 * 60;
  const tokenId = `at_${randomUUID()}`;
  const credentialId = `rt_${randomUUID()}`;
  const refreshSecret = randomCredential();
  const accessExpiresAt = new Date(nowMs + accessTtl * 1000).toISOString();
  const refreshExpiresAt = new Date(nowMs + refreshTtl * 1000).toISOString();
  db.prepare(
    'INSERT INTO access_tokens(token_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(tokenId, input.deviceId, accessExpiresAt, new Date(nowMs).toISOString());
  db.prepare(
    `INSERT INTO refresh_credentials(
      credential_id, device_id, secret_hash, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    credentialId,
    input.deviceId,
    hashCredential(refreshSecret, input.credentialPepper),
    refreshExpiresAt,
    new Date(nowMs).toISOString(),
  );
  const claims: AccessTokenClaims = {
    token_id: tokenId,
    license_id: input.licenseId,
    device_id: input.deviceId,
    issued_at: Math.floor(nowMs / 1000),
    expires_at: Math.floor(nowMs / 1000) + accessTtl,
  };
  return {
    accessToken: signAccessToken(claims, input.tokenSecret),
    accessExpiresAt,
    refreshToken: `${credentialId}.${refreshSecret}`,
    refreshExpiresAt,
    credentialId,
  };
}

export interface SignedRequestInput {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  requestId: string;
}

export function canonicalSignedRequest(input: SignedRequestInput): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.bodyHash,
    input.requestId,
  ].join('\n');
}

export function verifyDeviceRequest(
  publicKeyPem: string,
  signature: string,
  input: SignedRequestInput,
): boolean {
  try {
    return verifySignature(
      null,
      Buffer.from(canonicalSignedRequest(input), 'utf8'),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
