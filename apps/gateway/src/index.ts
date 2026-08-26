import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { textGatewayRequestV1Schema } from '@app/contracts';

export const MOCK_GATEWAY_MARKER = 'NON_PRODUCTION_DEV_ONLY_REFERENCE_IMPLEMENTATION';

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function factValue(prompt: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, 'u').exec(prompt);
  return match?.[1] ?? null;
}

export interface MockGatewayHandle {
  url: string;
  close(): Promise<void>;
}

export async function startMockGateway(port = 0): Promise<MockGatewayHandle> {
  const server: Server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/text/generate') {
      send(response, 404, { code: 'NOT_FOUND' });
      return;
    }
    const scenario = request.headers['x-mock-scenario'] ?? 'success';
    if (scenario === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (scenario === '429') {
      send(response, 429, { code: 'RATE_LIMITED' });
      return;
    }
    if (scenario === '500') {
      send(response, 500, { code: 'MOCK_UPSTREAM_ERROR' });
      return;
    }
    if (scenario === 'invalid') {
      send(response, 200, { invalid: true });
      return;
    }
    try {
      const parsed = textGatewayRequestV1Schema.parse(await readJson(request));
      const name = factValue(parsed.prompt, 'name');
      const specification = factValue(parsed.prompt, 'specification');
      const targetObject = factValue(parsed.prompt, 'target_object');
      const text = name
        ? `${name}，规格${specification ?? '以标签为准'}，适用对象${targetObject ?? '以标签为准'}。这是一段合成测试文案。`
        : '这是一段不包含企业产品事实的合成测试文案。';
      send(response, 200, {
        schema_version: '1.0',
        request_id: parsed.request_id,
        text,
        provider_alias: 'mock-gateway',
        provider_model: 'mock-text-v1',
        latency_ms: 1,
        billed_units: 0,
        request_snapshot_hash: parsed.request_snapshot_hash,
      });
    } catch {
      send(response, 400, { code: 'INVALID_REQUEST' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock Gateway failed to bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
