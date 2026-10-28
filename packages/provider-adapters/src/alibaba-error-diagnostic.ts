import { sanitizeProviderDiagnostic, type ProviderErrorDiagnostic } from './errors.js';

export const ALIBABA_ERROR_BODY_MAX_BYTES = 65_536;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Failure evidence only. Never retain a response message, body, or headers. */
export async function readAlibabaErrorDiagnostic(
  response: Response,
  forbiddenValues: readonly string[] = [],
): Promise<ProviderErrorDiagnostic> {
  const statusOnly = { httpStatus: response.status };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const length = response.headers.get('content-length');
    if (length !== null && /^\d+$/u.test(length) && Number(length) > ALIBABA_ERROR_BODY_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return statusOnly;
    }
    reader = response.body?.getReader();
    if (!reader) return statusOnly;
    let totalBytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > ALIBABA_ERROR_BODY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return statusOnly;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    const withoutSecrets = (value: unknown): unknown =>
      typeof value === 'string' &&
      forbiddenValues.some((secret) => secret.length > 0 && value.includes(secret))
        ? undefined
        : value;
    return (
      sanitizeProviderDiagnostic({
        ...statusOnly,
        providerCode: withoutSecrets(body?.code ?? record(body?.error)?.code),
        providerRequestId: withoutSecrets(body?.request_id),
      }) ?? statusOnly
    );
  } catch {
    return statusOnly;
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // Cleanup is diagnostic-only and cannot replace the HTTP failure classification.
    }
  }
}
