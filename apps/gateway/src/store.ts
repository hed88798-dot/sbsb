import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ProviderArtifactV1,
  ProviderJobStateV1,
  ProviderJobV1,
  ProviderRequestV1,
} from '@app/contracts';
import type { ProviderAdapter, ProviderEstimate, ProviderStatus } from '@app/provider-adapters';

export class GatewayStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayStoreError';
  }
}

interface JobRow {
  job_id: string;
  license_id: string;
  device_id: string;
  request_id: string;
  request_hash: string;
  capability: ProviderRequestV1['capability'];
  model_alias: string;
  provider: string;
  provider_model: string;
  provider_job_id: string | null;
  state: ProviderJobStateV1;
  estimated_cost: number;
  final_cost: number | null;
  currency: 'CNY' | 'USD';
  billed_units: number;
  latency_ms: number | null;
  error_class: string | null;
  error_code: string | null;
  fallback_reason: string | null;
  result_artifacts_json: string;
  created_at: string;
  updated_at: string;
}

export interface RoutedProvider {
  primary: ProviderAdapter;
  fallback?: ProviderAdapter;
  primaryEstimate: ProviderEstimate;
  reservationAmount: number;
}

function toJob(row: JobRow): ProviderJobV1 {
  return {
    schema_version: '1.0',
    protocol_version: '1.0',
    job_id: row.job_id,
    request_id: row.request_id,
    capability: row.capability,
    model_alias: row.model_alias,
    state: row.state,
    estimated_cost: row.estimated_cost,
    final_cost: row.final_cost,
    currency: row.currency,
    artifacts: JSON.parse(row.result_artifacts_json) as ProviderArtifactV1[],
    error: row.error_code
      ? { code: row.error_code, message: 'Provider job failed', retryable: false }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class GatewayStore {
  constructor(readonly db: Database.Database) {}

  getJob(jobId: string, licenseId?: string): ProviderJobV1 | null {
    const row = this.db
      .prepare(
        `SELECT * FROM provider_jobs WHERE job_id = ?${licenseId ? ' AND license_id = ?' : ''}`,
      )
      .get(...(licenseId ? [jobId, licenseId] : [jobId])) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  getJobRow(jobId: string): JobRow | null {
    return (
      (this.db.prepare('SELECT * FROM provider_jobs WHERE job_id = ?').get(jobId) as
        | JobRow
        | undefined) ?? null
    );
  }

  reserveAndCreate(input: {
    licenseId: string;
    deviceId: string;
    request: ProviderRequestV1;
    requestHash: string;
    route: RoutedProvider;
    now: string;
  }): { job: ProviderJobV1; created: boolean } {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM provider_jobs WHERE license_id = ? AND request_id = ?')
        .get(input.licenseId, input.request.request_id) as JobRow | undefined;
      if (existing) {
        if (existing.request_hash !== input.requestHash) {
          throw new GatewayStoreError(
            'IDEMPOTENCY_CONFLICT',
            'request_id was already used with a different request',
          );
        }
        return { job: toJob(existing), created: false };
      }
      const license = this.db
        .prepare(`SELECT status, monthly_budget, currency FROM licenses WHERE license_id = ?`)
        .get(input.licenseId) as
        | { status: string; monthly_budget: number; currency: string }
        | undefined;
      if (!license || license.status !== 'ACTIVE') {
        throw new GatewayStoreError('LICENSE_REVOKED', 'license is not active');
      }
      if (license.currency !== input.request.max_cost.currency) {
        throw new GatewayStoreError('CURRENCY_MISMATCH', 'budget currency does not match');
      }
      if (input.route.reservationAmount > input.request.max_cost.amount) {
        throw new GatewayStoreError('MAX_COST_EXCEEDED', 'approved request cost is too low');
      }
      const monthStart = `${input.now.slice(0, 7)}-01T00:00:00.000Z`;
      const committed = this.db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS amount
           FROM cost_reservations
           WHERE license_id = ? AND created_at >= ? AND state IN ('RESERVED','SETTLED','UNKNOWN')`,
        )
        .get(input.licenseId, monthStart) as { amount: number };
      if (committed.amount + input.route.reservationAmount > license.monthly_budget) {
        throw new GatewayStoreError('BUDGET_EXCEEDED', 'license budget exceeded');
      }
      const jobId = `job_${randomUUID()}`;
      const reservationId = `res_${randomUUID()}`;
      this.db
        .prepare(
          `INSERT INTO provider_jobs(
            job_id, license_id, device_id, request_id, request_hash, capability, model_alias,
            provider, provider_model, state, estimated_cost, currency, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`,
        )
        .run(
          jobId,
          input.licenseId,
          input.deviceId,
          input.request.request_id,
          input.requestHash,
          input.request.capability,
          input.request.model_alias,
          input.route.primary.alias,
          input.route.primary.providerModel,
          input.route.primaryEstimate.amount,
          input.route.primaryEstimate.currency,
          input.now,
          input.now,
        );
      this.db
        .prepare(
          `INSERT INTO cost_reservations(
            reservation_id, job_id, license_id, amount, currency, state, created_at
          ) VALUES (?, ?, ?, ?, ?, 'RESERVED', ?)`,
        )
        .run(
          reservationId,
          jobId,
          input.licenseId,
          input.route.reservationAmount,
          input.route.primaryEstimate.currency,
          input.now,
        );
      this.db
        .prepare(
          `INSERT INTO usage_events(
            usage_event_id, event_type, license_id, device_id, request_id, job_id,
            reservation_id, provider, provider_model, capability, estimated_cost,
            final_cost, currency, billed_units, state, occurred_at
          ) VALUES (?, 'RESERVATION', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 'QUEUED', ?)`,
        )
        .run(
          `use_${randomUUID()}`,
          input.licenseId,
          input.deviceId,
          input.request.request_id,
          jobId,
          reservationId,
          input.route.primary.alias,
          input.route.primary.providerModel,
          input.request.capability,
          input.route.primaryEstimate.amount,
          input.route.primaryEstimate.currency,
          input.now,
        );
      return { job: this.getJob(jobId)!, created: true };
    })();
  }

  attachProviderJob(jobId: string, providerJobId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE provider_jobs SET provider_job_id = ?, state = 'RUNNING', updated_at = ?
         WHERE job_id = ? AND provider_job_id IS NULL`,
      )
      .run(providerJobId, now, jobId);
  }

  switchProvider(
    jobId: string,
    adapter: ProviderAdapter,
    fallbackReason: string,
    now: string,
  ): void {
    this.db
      .prepare(
        `UPDATE provider_jobs SET provider = ?, provider_model = ?, provider_job_id = NULL,
         state = 'QUEUED', fallback_reason = ?, updated_at = ? WHERE job_id = ?`,
      )
      .run(adapter.alias, adapter.providerModel, fallbackReason, now, jobId);
  }

  markUnknown(
    jobId: string,
    providerJobId: string | undefined,
    errorClass: string,
    now: string,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE provider_jobs SET provider_job_id = COALESCE(?, provider_job_id), state = 'UNKNOWN',
           error_class = ?, error_code = 'PROVIDER_OUTCOME_UNKNOWN', updated_at = ? WHERE job_id = ?`,
        )
        .run(providerJobId ?? null, errorClass, now, jobId);
      this.db.prepare("UPDATE cost_reservations SET state = 'UNKNOWN' WHERE job_id = ?").run(jobId);
    })();
  }

  failJob(
    jobId: string,
    errorClass: string,
    errorCode: string,
    latencyMs: number,
    now: string,
  ): void {
    this.db.transaction(() => {
      const row = this.getJobRow(jobId);
      if (!row || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(row.state)) return;
      this.db
        .prepare(
          `UPDATE provider_jobs SET state = 'FAILED', error_class = ?, error_code = ?, latency_ms = ?,
           updated_at = ? WHERE job_id = ?`,
        )
        .run(errorClass, errorCode, latencyMs, now, jobId);
      this.db
        .prepare(
          "UPDATE cost_reservations SET state = 'RELEASED', amount = 0, settled_at = ? WHERE job_id = ?",
        )
        .run(now, jobId);
      this.insertTerminalEvent(row, 'RELEASE', 'FAILED', 0, 0, latencyMs, errorClass, now);
    })();
  }

  settle(jobId: string, status: ProviderStatus, latencyMs: number, now: string): void {
    this.db.transaction(() => {
      const row = this.getJobRow(jobId);
      if (!row) throw new GatewayStoreError('JOB_NOT_FOUND', 'job not found');
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(row.state)) return;
      if (status.state !== 'SUCCEEDED') {
        this.transition(jobId, status.state, now, status.errorClass ?? null);
        return;
      }
      const finalCost = status.finalCost ?? row.estimated_cost;
      this.db
        .prepare(
          `UPDATE provider_jobs SET state = 'SUCCEEDED', final_cost = ?, billed_units = ?, latency_ms = ?,
           result_artifacts_json = ?, error_class = NULL, error_code = NULL, updated_at = ? WHERE job_id = ?`,
        )
        .run(
          finalCost,
          status.billedUnits,
          latencyMs,
          JSON.stringify(status.artifacts),
          now,
          jobId,
        );
      this.db
        .prepare(
          `UPDATE cost_reservations SET state = 'SETTLED', amount = ?, settled_at = ? WHERE job_id = ?`,
        )
        .run(finalCost, now, jobId);
      this.insertTerminalEvent(
        row,
        'SETTLEMENT',
        'SUCCEEDED',
        finalCost,
        status.billedUnits,
        latencyMs,
        null,
        now,
      );
    })();
  }

  transition(
    jobId: string,
    incoming: ProviderJobStateV1,
    now: string,
    errorClass: string | null = null,
  ): boolean {
    const row = this.getJobRow(jobId);
    if (!row) throw new GatewayStoreError('JOB_NOT_FOUND', 'job not found');
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(row.state)) return false;
    const rank: Record<ProviderJobStateV1, number> = {
      QUEUED: 0,
      RUNNING: 1,
      UNKNOWN: 1,
      SUCCEEDED: 2,
      FAILED: 2,
      CANCELLED: 2,
    };
    if (rank[incoming] < rank[row.state]) return false;
    this.db
      .prepare(
        'UPDATE provider_jobs SET state = ?, error_class = ?, updated_at = ? WHERE job_id = ?',
      )
      .run(incoming, errorClass, now, jobId);
    return true;
  }

  private insertTerminalEvent(
    row: JobRow,
    eventType: 'SETTLEMENT' | 'RELEASE',
    state: ProviderJobStateV1,
    finalCost: number,
    billedUnits: number,
    latencyMs: number,
    errorClass: string | null,
    now: string,
  ): void {
    const reservation = this.db
      .prepare('SELECT reservation_id FROM cost_reservations WHERE job_id = ?')
      .get(row.job_id) as { reservation_id: string };
    this.db
      .prepare(
        `INSERT OR IGNORE INTO usage_events(
          usage_event_id, event_type, license_id, device_id, request_id, job_id,
          reservation_id, provider, provider_model, capability, estimated_cost,
          final_cost, currency, billed_units, latency_ms, state, error_class,
          fallback_reason, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `use_${randomUUID()}`,
        eventType,
        row.license_id,
        row.device_id,
        row.request_id,
        row.job_id,
        reservation.reservation_id,
        row.provider,
        row.provider_model,
        row.capability,
        row.estimated_cost,
        finalCost,
        row.currency,
        billedUnits,
        latencyMs,
        state,
        errorClass,
        row.fallback_reason,
        now,
      );
  }
}
