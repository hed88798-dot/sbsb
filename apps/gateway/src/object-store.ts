import { createHash, createHmac } from 'node:crypto';

export interface PresignedUpload {
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

export interface ObjectStoreSigner {
  presignPut(input: {
    objectKey: string;
    mimeType: string;
    sha256Hex: string;
    expiresInSeconds: number;
    now?: Date;
  }): PresignedUpload;
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export class S3ObjectStoreSigner implements ObjectStoreSigner {
  constructor(
    private readonly options: {
      endpoint: string;
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
  ) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:') throw new Error('Object store endpoint must use HTTPS');
    if (!/^[a-z0-9][a-z0-9.-]{1,62}$/u.test(options.bucket)) {
      throw new Error('Invalid object store bucket');
    }
  }

  presignPut(input: {
    objectKey: string;
    mimeType: string;
    sha256Hex: string;
    expiresInSeconds: number;
    now?: Date;
  }): PresignedUpload {
    const now = input.now ?? new Date();
    const date = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
    const dateStamp = date.slice(0, 8);
    const endpoint = new URL(this.options.endpoint);
    const path = `/${awsEncode(this.options.bucket)}/${input.objectKey
      .split('/')
      .map(awsEncode)
      .join('/')}`;
    const credentialScope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const checksum = Buffer.from(input.sha256Hex, 'hex').toString('base64');
    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.options.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': date,
      'X-Amz-Expires': String(input.expiresInSeconds),
      'X-Amz-SignedHeaders': 'content-type;host;x-amz-checksum-sha256',
    });
    query.sort();
    const canonicalHeaders = `content-type:${input.mimeType}\nhost:${endpoint.host}\nx-amz-checksum-sha256:${checksum}\n`;
    const canonicalRequest = [
      'PUT',
      path,
      query.toString(),
      canonicalHeaders,
      'content-type;host;x-amz-checksum-sha256',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      date,
      credentialScope,
      awaitlessSha256(canonicalRequest),
    ].join('\n');
    const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.options.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    endpoint.pathname = path;
    endpoint.search = `${query.toString()}&X-Amz-Signature=${signature}`;
    return {
      uploadUrl: endpoint.toString(),
      requiredHeaders: { 'content-type': input.mimeType, 'x-amz-checksum-sha256': checksum },
      expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString(),
    };
  }
}

function awaitlessSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class FakeObjectStoreSigner implements ObjectStoreSigner {
  constructor(private readonly secret = 'fake-object-store-secret') {}

  presignPut(input: {
    objectKey: string;
    mimeType: string;
    sha256Hex: string;
    expiresInSeconds: number;
    now?: Date;
  }): PresignedUpload {
    const now = input.now ?? new Date();
    const expires = Math.floor(now.getTime() / 1000) + input.expiresInSeconds;
    const signature = createHmac('sha256', this.secret)
      .update(`${input.objectKey}\n${input.mimeType}\n${input.sha256Hex}\n${expires}`)
      .digest('hex');
    const url = new URL(`https://object-store.invalid/${input.objectKey}`);
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('signature', signature);
    return {
      uploadUrl: url.toString(),
      requiredHeaders: {
        'content-type': input.mimeType,
        'x-content-sha256': input.sha256Hex,
      },
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }
}
