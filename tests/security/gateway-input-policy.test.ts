import { afterEach, describe, expect, it } from 'vitest';
import { S3ObjectStoreSigner } from '../../apps/gateway/src/object-store.js';
import {
  createGatewayFixture,
  requestFor,
  signedInject,
  type GatewayFixture,
} from '../helpers/gateway-fixture.js';

let fixture: GatewayFixture | undefined;
afterEach(async () => fixture?.close());

describe('Gateway input and object policy', () => {
  it('creates a checksum-bound, short S3 SigV4 upload without exposing storage secret', () => {
    const signer = new S3ObjectStoreSigner({
      endpoint: 'https://objects.example.invalid',
      bucket: 'temporary-media',
      region: 'test-region-1',
      accessKeyId: 'TESTACCESSKEY',
      secretAccessKey: 'test-secret-that-must-not-appear',
    });
    const result = signer.presignPut({
      objectKey: 'transient/fixture.jpg',
      mimeType: 'image/jpeg',
      sha256Hex: 'a'.repeat(64),
      expiresInSeconds: 300,
      now: new Date('2026-08-27T00:00:00.000Z'),
    });
    expect(result.uploadUrl).toContain('X-Amz-Signature=');
    expect(result.uploadUrl).not.toContain('test-secret-that-must-not-appear');
    expect(result.requiredHeaders).toHaveProperty('x-amz-checksum-sha256');
    expect(result.expiresAt).toBe('2026-08-27T00:05:00.000Z');
  });

  it('fails closed when provider legal approval is missing or expired', async () => {
    fixture = await createGatewayFixture();
    fixture.database.db
      .prepare(
        `DELETE FROM legal_allowlist
         WHERE provider = 'mock-primary' AND provider_model = 'mock-model-v1'
           AND capability = 'image.generate.v1'`,
      )
      .run();
    const response = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: requestFor('image.generate.v1', 'legal_block_001'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'PROVIDER_LEGAL_BLOCKED' });
    expect(fixture.adapter.submitCount).toBe(0);
  });

  it('rejects arbitrary URL, provider URL, vendor payload and illegal model alias', async () => {
    fixture = await createGatewayFixture();
    const base = requestFor('image.generate.v1', 'ssrf_request_001');
    for (const mutation of [
      { ...base, input_url: 'http://127.0.0.1:8080/admin' },
      { ...base, provider_url: 'http://169.254.169.254/latest/meta-data' },
      { ...base, vendor_payload: { webhook: 'https://attacker.invalid' } },
    ]) {
      const response = await signedInject(fixture, {
        method: 'POST',
        url: '/v1/jobs',
        body: mutation,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_PROVIDER_REQUEST' });
    }
    const illegalModel = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/jobs',
      body: { ...base, request_id: 'illegal_model_001', model_alias: 'vendor-secret-model' },
    });
    expect(illegalModel.statusCode).toBe(400);
    expect(illegalModel.json()).toMatchObject({ code: 'UNSUPPORTED_MODEL' });
    expect(fixture.adapter.submitCount).toBe(0);
  });

  it('issues short-lived random object refs with MIME, extension, size and checksum enforcement', async () => {
    fixture = await createGatewayFixture();
    const valid = await signedInject(fixture, {
      method: 'POST',
      url: '/v1/uploads/presign',
      body: {
        filename: '客户原文件名.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1024,
        sha256: 'a'.repeat(64),
      },
    });
    expect(valid.statusCode).toBe(200);
    const presign = valid.json<{
      object_ref: string;
      upload_url: string;
      lifecycle_expires_at: string;
    }>();
    expect(presign.object_ref).toMatch(/^obj_/u);
    expect(presign.upload_url).not.toContain(encodeURIComponent('客户原文件名'));
    expect(new Date(presign.lifecycle_expires_at).getTime() - Date.now()).toBeLessThanOrEqual(
      86_400_000,
    );

    for (const body of [
      { filename: 'bad.exe', mime_type: 'image/jpeg', size_bytes: 10, sha256: 'a'.repeat(64) },
      { filename: 'bad.jpg', mime_type: 'text/html', size_bytes: 10, sha256: 'a'.repeat(64) },
      {
        filename: 'bad.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 99_000_000,
        sha256: 'a'.repeat(64),
      },
      { filename: 'bad.jpg', mime_type: 'image/jpeg', size_bytes: 10, sha256: 'bad' },
    ]) {
      const response = await signedInject(fixture, {
        method: 'POST',
        url: '/v1/uploads/presign',
        body,
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
