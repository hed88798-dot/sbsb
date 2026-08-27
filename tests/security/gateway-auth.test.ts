import { randomBytes, sign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256, signingMessage } from '../../apps/gateway/src/index.js';
import {
  createGatewayFixture,
  requestFor,
  signedInject,
  type GatewayFixture,
} from '../helpers/gateway-fixture.js';

let fixture: GatewayFixture | undefined;
afterEach(async () => fixture?.close());

describe('device auth and replay protection', () => {
  it('fails closed for duplicate nonce, stale timestamp and body tampering', async () => {
    fixture = await createGatewayFixture();
    const body = requestFor('image.generate.v1', 'auth_request_001');
    const nonce = randomBytes(18).toString('base64url');
    const first = await signedInject(fixture, { method: 'POST', url: '/v1/jobs', body, nonce });
    expect(first.statusCode).toBe(201);
    const replay = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body,
      nonce,
      requestId: 'replay_request_001',
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ code: 'REPLAY_DETECTED' });

    const stale = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'auth_request_002'),
      timestamp: String(Math.floor(Date.now() / 1000) - 1_000),
    });
    expect(stale.json()).toMatchObject({ code: 'STALE_REQUEST' });

    const tampered = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'auth_request_003'),
      signBody: requestFor('image.generate.v1', 'different_body'),
    });
    expect(tampered.json()).toMatchObject({ code: 'BODY_HASH_MISMATCH' });
    expect(fixture.adapter.submitCount).toBe(1);
  });

  it('rejects revoked device, revoked license and invalid access token before provider cost', async () => {
    fixture = await createGatewayFixture();
    fixture.database.db
      .prepare("UPDATE devices SET status = 'REVOKED', revoked_at = ? WHERE device_id = ?")
      .run(new Date().toISOString(), fixture.deviceId);
    const revokedDevice = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'revoked_device'),
    });
    expect(revokedDevice.statusCode).toBe(401);

    fixture.database.db
      .prepare("UPDATE devices SET status = 'ACTIVE' WHERE device_id = ?")
      .run(fixture.deviceId);
    fixture.database.db
      .prepare("UPDATE licenses SET status = 'REVOKED', revoked_at = ? WHERE license_id = ?")
      .run(new Date().toISOString(), fixture.licenseId);
    const revokedLicense = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'revoked_license'),
    });
    expect(revokedLicense.statusCode).toBe(401);

    const invalid = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'invalid_token'),
      accessToken: 'not.a.valid-token',
    });
    expect(invalid.statusCode).toBe(401);
    expect(fixture.adapter.submitCount).toBe(0);
  });

  it('rotates refresh credentials and rejects reuse or invalid refresh', async () => {
    fixture = await createGatewayFixture();
    const refreshBody = { refresh_token: fixture.refreshToken };
    const bodyText = JSON.stringify(refreshBody);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(18).toString('base64url');
    const requestId = 'refresh_request_001';
    const message = signingMessage({
      method: 'POST',
      path: '/v1/token/refresh',
      timestamp,
      nonce,
      body: bodyText,
      requestId,
    });
    const response = await fixture.app.inject({
      method: 'POST',
      url: '/v1/token/refresh',
      headers: {
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-body-sha256': sha256(bodyText),
        'x-device-signature': sign(null, Buffer.from(message), fixture.privateKey).toString(
          'base64',
        ),
        'x-request-id': requestId,
      },
      payload: bodyText,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schema_version: '1.0' });

    const reuse = await fixture.app.inject({
      method: 'POST',
      url: '/v1/token/refresh',
      payload: refreshBody,
    });
    expect(reuse.statusCode).toBe(401);

    const invalid = await fixture.app.inject({
      method: 'POST',
      url: '/v1/token/refresh',
      payload: { refresh_token: 'invalid.refresh' },
    });
    expect(invalid.statusCode).toBe(401);
  });

  it('rejects an expired access token', async () => {
    let current = new Date();
    fixture = await createGatewayFixture({ accessTtlSeconds: 1, now: () => current });
    current = new Date(current.getTime() + 2_000);
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'expired_access_001'),
      timestamp: String(Math.floor(current.getTime() / 1000)),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'ACCESS_TOKEN_EXPIRED' });
    expect(fixture.adapter.submitCount).toBe(0);
  });
});
