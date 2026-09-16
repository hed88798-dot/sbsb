import {
  renderCancelResultV1Schema,
  renderJobDtoV1Schema,
  renderPrepareRequestV1Schema,
  type RenderCancelResultV1,
  type RenderJobDTOv1,
  type RenderPrepareRequestV1,
} from '@app/contracts';
import type {
  JobRepository,
  RenderExecutionRepository,
  RenderPreparationRepository,
} from '@app/local-db';
import { RENDER_POLICY_V1, type RenderAcceptedTimelineRequestV1 } from '@app/render';
import type {
  ExecutedRenderResultV1,
  RenderExecutionServiceV1,
} from './render-execution-service.js';
import type { RenderPreparationService } from './render-preparation-service.js';
import { mapPersistedRenderError } from './render-public-error.js';

export const RENDER_SUBSYSTEM_UNAVAILABLE = 'RENDER_SUBSYSTEM_UNAVAILABLE';
export const RENDER_DESKTOP_SHUTDOWN_TIMEOUT_MS =
  RENDER_POLICY_V1.execution.graceful_cancel_timeout_ms +
  RENDER_POLICY_V1.execution.forced_cancel_timeout_ms +
  5_000;

export interface DesktopRenderStartupRecoveryResultV1 {
  execution_recovered: number;
  preparation_recovered: number;
  generic_recovered: number;
}

export interface DesktopRenderShutdownResultV1 {
  settled: boolean;
  timed_out: boolean;
  cancellation_requested_job_ids: string[];
}

interface RenderServicesV1 {
  preparation: Pick<RenderPreparationService, 'prepare' | 'recoverInterrupted'>;
  execution: Pick<
    RenderExecutionServiceV1,
    'executePreparedRender' | 'cancelPreparedRender' | 'recoverInterruptedExecutions'
  >;
}

export class DesktopRenderOrchestratorV1 {
  readonly #jobs: JobRepository;
  readonly #preparations: RenderPreparationRepository;
  readonly #executions: RenderExecutionRepository;
  readonly #services: RenderServicesV1 | null;
  readonly #activePreparations = new Set<Promise<unknown>>();
  readonly #activeExecutions = new Map<string, Set<Promise<ExecutedRenderResultV1>>>();
  #acceptingWork = true;

  constructor(options: {
    jobs: JobRepository;
    preparations: RenderPreparationRepository;
    executions: RenderExecutionRepository;
    services: RenderServicesV1 | null;
  }) {
    this.#jobs = options.jobs;
    this.#preparations = options.preparations;
    this.#executions = options.executions;
    this.#services = options.services;
  }

  get available(): boolean {
    return this.#services !== null;
  }

  async recoverStartup(): Promise<DesktopRenderStartupRecoveryResultV1> {
    let executionRecovered = 0;
    let preparationRecovered = 0;
    if (this.#services) {
      executionRecovered = (await this.#services.execution.recoverInterruptedExecutions()).length;
      preparationRecovered = (await this.#services.preparation.recoverInterrupted()).length;
    }
    const genericRecovered = this.#jobs.recoverInterruptedNonRenderJobs();
    return {
      execution_recovered: executionRecovered,
      preparation_recovered: preparationRecovered,
      generic_recovered: genericRecovered,
    };
  }

  async prepare(requestValue: RenderPrepareRequestV1): Promise<RenderJobDTOv1> {
    this.#assertAcceptingWork();
    const services = this.#requireServices();
    const request = renderPrepareRequestV1Schema.parse(requestValue);
    const work = services.preparation.prepare(request as RenderAcceptedTimelineRequestV1);
    this.#activePreparations.add(work);
    void work.then(
      () => this.#activePreparations.delete(work),
      () => this.#activePreparations.delete(work),
    );
    const prepared = await work;
    return this.#toDto(prepared.job.job_id, null);
  }

  async execute(jobId: string): Promise<RenderJobDTOv1> {
    this.#assertAcceptingWork();
    const services = this.#requireServices();
    const work = services.execution.executePreparedRender(jobId);
    const activeForJob = this.#activeExecutions.get(jobId) ?? new Set();
    activeForJob.add(work);
    this.#activeExecutions.set(jobId, activeForJob);
    void work.then(
      () => this.#removeActive(jobId, work),
      () => this.#removeActive(jobId, work),
    );
    const result = await work;
    return this.#toDto(jobId, result.recovered_existing_success);
  }

  async cancel(jobId: string): Promise<RenderCancelResultV1> {
    const services = this.#requireServices();
    const accepted = await services.execution.cancelPreparedRender(jobId);
    return renderCancelResultV1Schema.parse({
      schema_version: '1.0',
      job_id: jobId,
      accepted,
      reason: accepted ? 'CANCELLATION_REQUESTED' : 'NO_ACTIVE_EXECUTION',
    });
  }

  get(jobId: string): RenderJobDTOv1 | null {
    this.#requireServices();
    if (!this.#preparations.get(jobId)) return null;
    return this.#toDto(jobId, null);
  }

  async shutdown(
    timeoutMs = RENDER_DESKTOP_SHUTDOWN_TIMEOUT_MS,
  ): Promise<DesktopRenderShutdownResultV1> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('RENDER_SHUTDOWN_TIMEOUT_INVALID');
    }
    this.#acceptingWork = false;
    if (!this.#services) {
      return { settled: true, timed_out: false, cancellation_requested_job_ids: [] };
    }

    const activeAttempts = this.#executions.listActive();
    const activeJobIds = [...new Set(activeAttempts.map((attempt) => attempt.job_id))].sort();
    const trackedExecutions = [...this.#activeExecutions.values()].flatMap((work) => [...work]);
    const trackedJobIds = new Set(this.#activeExecutions.keys());
    const tracked = [...this.#activePreparations, ...trackedExecutions];
    const hasUntrackedPersistedAttempt = activeJobIds.some((jobId) => !trackedJobIds.has(jobId));
    await Promise.allSettled(
      activeJobIds.map((jobId) => this.#services!.execution.cancelPreparedRender(jobId)),
    );

    if (tracked.length === 0 && !hasUntrackedPersistedAttempt) {
      return {
        settled: true,
        timed_out: false,
        cancellation_requested_job_ids: activeJobIds,
      };
    }

    const settlement = hasUntrackedPersistedAttempt
      ? new Promise<void>(() => undefined)
      : Promise.allSettled(tracked).then(() => undefined);
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      settlement.then(() => false),
      new Promise<true>((resolve) => {
        timeout = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    return {
      settled: !timedOut,
      timed_out: timedOut,
      cancellation_requested_job_ids: activeJobIds,
    };
  }

  #toDto(jobId: string, recoveredExistingSuccess: boolean | null): RenderJobDTOv1 {
    const preparation = this.#preparations.require(jobId);
    const generic = this.#jobs.require(jobId);
    if (generic.job_type !== 'RENDER') throw new Error('RENDER_JOB_TYPE_MISMATCH');
    const active = this.#executions.findActive(jobId);
    const success = generic.state === 'SUCCEEDED' ? this.#executions.findSucceeded(jobId) : null;
    const safeError =
      generic.error_code !== null || generic.error_message !== null
        ? mapPersistedRenderError(generic.error_code, generic.error_message)
        : mapPersistedRenderError(preparation.error_code, preparation.error_message);
    const output = success?.receipt.output_artifact ?? null;
    const verification = success?.receipt.verification_facts ?? null;
    const result =
      success && output && verification && success.attempt.finalize_protocol
        ? {
            execution_attempt_id: success.attempt.execution_attempt_id,
            recovered_existing_success: recoveredExistingSuccess,
            output_sha256: output.output_sha256,
            output_size_bytes: output.size_bytes,
            receipt_hash: success.receipt.receipt_hash,
            terminal_state: 'SUCCEEDED' as const,
            finalize_protocol: success.attempt.finalize_protocol,
            actual_video_frames: verification.frame_count ?? null,
          }
        : null;
    return renderJobDtoV1Schema.parse({
      schema_version: '1.0',
      job_id: preparation.job_id,
      job_state: generic.state,
      progress: generic.progress,
      preparation_state: preparation.state,
      active_execution_state: active?.state ?? null,
      timeline_id: preparation.request.timeline_id,
      timeline_version: preparation.request.timeline_version,
      logical_render_hash: preparation.logical_render_hash,
      execution_snapshot_hash: preparation.current_execution_snapshot_hash,
      cancellation_requested: active?.cancellation_requested_at !== null && active !== null,
      error_code: safeError.error_code,
      error_message: safeError.error_message,
      created_at: generic.created_at,
      started_at: generic.started_at,
      finished_at: generic.finished_at,
      result,
    });
  }

  #assertAcceptingWork(): void {
    if (!this.#acceptingWork) throw new Error('RENDER_DESKTOP_SHUTTING_DOWN');
  }

  #requireServices(): RenderServicesV1 {
    if (!this.#services) throw new Error(RENDER_SUBSYSTEM_UNAVAILABLE);
    return this.#services;
  }

  #removeActive(jobId: string, work: Promise<ExecutedRenderResultV1>): void {
    const activeForJob = this.#activeExecutions.get(jobId);
    if (!activeForJob) return;
    activeForJob.delete(work);
    if (activeForJob.size === 0) this.#activeExecutions.delete(jobId);
  }
}
