import type { Database } from 'better-sqlite3';
import { isProviderErrorClass, sanitizeProviderDiagnostic } from '@app/provider-adapters';

/** Observe a failed opt-in canary without changing its result or exposing Provider payloads. */
export async function withCanaryProviderDiagnostics<T>(
  db: Database,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    try {
      const rows = db
        .prepare(
          `SELECT metadata_json FROM audit_events
         WHERE action = 'PROVIDER_FAILURE_DIAGNOSTIC'
           AND target_type = 'PROVIDER_JOB' AND length(metadata_json) <= 4096
         ORDER BY rowid LIMIT 64`,
        )
        .all() as Array<{ metadata_json: string }>;
      for (const row of rows) {
        const value: unknown = JSON.parse(row.metadata_json);
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const metadata = value as Record<string, unknown>;
        if (!isProviderErrorClass(metadata.error_class)) continue;
        const diagnostic = sanitizeProviderDiagnostic({
          httpStatus: metadata.http_status,
          providerCode: metadata.provider_code,
          providerRequestId: metadata.provider_request_id,
        });
        if (!diagnostic) continue;
        console.info(
          JSON.stringify({
            error_class: metadata.error_class,
            ...(diagnostic.httpStatus === undefined ? {} : { http_status: diagnostic.httpStatus }),
            ...(diagnostic.providerCode === undefined
              ? {}
              : { provider_code: diagnostic.providerCode }),
            ...(diagnostic.providerRequestId === undefined
              ? {}
              : { provider_request_id: diagnostic.providerRequestId }),
          }),
        );
      }
    } catch {
      // Diagnostic read/report failures must not mask the original canary failure.
    }
    throw error;
  }
}
