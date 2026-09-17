import { createHash, randomUUID } from 'node:crypto';
import {
  shotPlanSemanticProposalV1Schema,
  type CandidateShotPlanV1,
  type ShotPlanSemanticProposalV1,
  type TextGatewayRequestV1,
  type TextGatewayResultV1,
} from '@app/contracts';
import type { SourceDocumentRepository } from '@app/local-db';
import { isGatewayClientError, type TextCapabilityClient } from '@app/provider-client';
import { logEvent } from './logger.js';
import type { ShotPlanAuthorityService } from './shot-plan-authority-service.js';
import {
  reconcileSemanticShotPlanProposal,
  ShotPlanProposalStructuralError,
} from './shot-plan-proposal-reconciler.js';
import {
  buildShotPlanProposerPromptV1,
  SHOT_PLAN_PROPOSER_MODEL_ALIAS,
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
} from './shot-plan-proposer-prompt.v1.js';

export interface ShotPlanProposalOperationV1 {
  operation_id: string;
  source_document_id: string;
  source_document_version: number;
  source_document_hash: string;
}

export interface ShotPlanProposalTraceV1 {
  operation_id: string;
  request_snapshot_hash: string;
  prompt_template_id: string;
  prompt_template_version: string;
  model_alias: string;
  provider_request_id: string;
  provider_alias: string;
  provider_model: string;
  provider_attempts: number;
  duration_ms: number;
}

export interface ShotPlanProposalResultV1 {
  candidate: CandidateShotPlanV1;
  trace: ShotPlanProposalTraceV1;
}

type AuditSink = (event: string, fields: Record<string, unknown>) => void;

interface InFlightOperation {
  requestSnapshotHash: string;
  promise: Promise<ShotPlanProposalResultV1>;
}

export class ShotPlanProposerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ShotPlanProposerError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ShotPlanProposerError(code);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateOperation(input: ShotPlanProposalOperationV1): void {
  if (
    input.operation_id.length === 0 ||
    input.operation_id.length > 256 ||
    input.operation_id.trim() !== input.operation_id ||
    input.source_document_id.length === 0 ||
    input.source_document_id.length > 256 ||
    input.source_document_id.trim() !== input.source_document_id ||
    !Number.isSafeInteger(input.source_document_version) ||
    input.source_document_version < 1 ||
    !/^[a-f0-9]{64}$/u.test(input.source_document_hash)
  ) {
    fail('SHOT_PLAN_PROPOSAL_OPERATION_INVALID');
  }
}

function parseProposal(text: string): ShotPlanSemanticProposalV1 {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return fail('SHOT_PLAN_PROPOSAL_INVALID_STRUCTURED_OUTPUT');
  }
  const parsed = shotPlanSemanticProposalV1Schema.safeParse(value);
  if (!parsed.success) return fail('SHOT_PLAN_PROPOSAL_INVALID_STRUCTURED_OUTPUT');
  return parsed.data;
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof ShotPlanProposalStructuralError) return true;
  if (error instanceof ShotPlanProposerError) {
    return error.code === 'SHOT_PLAN_PROPOSAL_INVALID_STRUCTURED_OUTPUT';
  }
  if (isGatewayClientError(error)) {
    return error.retryable || error.code === 'INVALID_GATEWAY_RESPONSE';
  }
  return false;
}

export class ShotPlanProposerServiceV1 {
  readonly #sourceDocuments: Pick<SourceDocumentRepository, 'getVersion'>;
  readonly #shotPlans: Pick<ShotPlanAuthorityService, 'createCandidate'>;
  readonly #client: TextCapabilityClient;
  readonly #maxProviderAttempts: number;
  readonly #clock: () => number;
  readonly #id: (kind: 'provider_request' | 'continuity_group') => string;
  readonly #audit: AuditSink;
  readonly #operations = new Map<string, InFlightOperation>();

  constructor(options: {
    sourceDocuments: Pick<SourceDocumentRepository, 'getVersion'>;
    shotPlans: Pick<ShotPlanAuthorityService, 'createCandidate'>;
    client: TextCapabilityClient;
    maxProviderAttempts?: number;
    clock?: () => number;
    id?: (kind: 'provider_request' | 'continuity_group') => string;
    audit?: AuditSink;
  }) {
    this.#sourceDocuments = options.sourceDocuments;
    this.#shotPlans = options.shotPlans;
    this.#client = options.client;
    this.#maxProviderAttempts = options.maxProviderAttempts ?? 2;
    if (!Number.isSafeInteger(this.#maxProviderAttempts) || this.#maxProviderAttempts < 1) {
      fail('SHOT_PLAN_PROPOSAL_RETRY_POLICY_INVALID');
    }
    this.#clock = options.clock ?? (() => Date.now());
    this.#id = options.id ?? ((kind) => `${kind}_${randomUUID()}`);
    this.#audit = options.audit ?? logEvent;
  }

  propose(
    input: ShotPlanProposalOperationV1,
    options: { signal?: AbortSignal } = {},
  ): Promise<ShotPlanProposalResultV1> {
    validateOperation(input);
    const source = this.#sourceDocuments.getVersion(
      input.source_document_id,
      input.source_document_version,
    );
    if (!source) return Promise.reject(new ShotPlanProposerError('SOURCE_DOCUMENT_NOT_FOUND'));
    if (source.source_document_hash !== input.source_document_hash) {
      return Promise.reject(new ShotPlanProposerError('SOURCE_DOCUMENT_HASH_MISMATCH'));
    }

    const prompt = buildShotPlanProposerPromptV1(source);
    const requestSnapshotHash = sha256(
      JSON.stringify({
        schema_version: '1.0',
        source_document_id: source.source_document_id,
        source_document_version: source.source_document_version,
        source_document_hash: source.source_document_hash,
        prompt_template_id: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
        prompt_template_version: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
        model_alias: SHOT_PLAN_PROPOSER_MODEL_ALIAS,
        prompt,
      }),
    );
    const existing = this.#operations.get(input.operation_id);
    if (existing) {
      if (existing.requestSnapshotHash !== requestSnapshotHash) {
        return Promise.reject(new ShotPlanProposerError('SHOT_PLAN_PROPOSAL_IDEMPOTENCY_CONFLICT'));
      }
      return existing.promise;
    }

    const promise = this.#execute({ input, source, prompt, requestSnapshotHash }, options).catch(
      (error: unknown) => {
        this.#operations.delete(input.operation_id);
        throw error;
      },
    );
    this.#operations.set(input.operation_id, { requestSnapshotHash, promise });
    return promise;
  }

  async #execute(
    context: {
      input: ShotPlanProposalOperationV1;
      source: NonNullable<ReturnType<SourceDocumentRepository['getVersion']>>;
      prompt: string;
      requestSnapshotHash: string;
    },
    options: { signal?: AbortSignal },
  ): Promise<ShotPlanProposalResultV1> {
    const startedAt = this.#clock();
    let lastError: unknown;
    let lastProviderRequestId: string | null = null;
    for (let attempt = 1; attempt <= this.#maxProviderAttempts; attempt += 1) {
      if (options.signal?.aborted) {
        throw new ShotPlanProposerError('SHOT_PLAN_PROPOSAL_CANCELLED');
      }
      const request: TextGatewayRequestV1 = {
        schema_version: '1.0',
        request_id: this.#id('provider_request'),
        capability: 'text.generate.v1',
        model_alias: SHOT_PLAN_PROPOSER_MODEL_ALIAS,
        prompt: context.prompt,
        request_snapshot_hash: context.requestSnapshotHash,
      };
      lastProviderRequestId = request.request_id;
      try {
        const providerResult = await this.#client.generate(
          request,
          options.signal ? { signal: options.signal } : {},
        );
        this.#validateProviderIdentity(request, providerResult);
        const proposal = parseProposal(providerResult.text);
        const reconciled = reconcileSemanticShotPlanProposal(context.source, proposal, {
          continuityGroupId: () => this.#id('continuity_group'),
        });
        const record = this.#shotPlans.createCandidate({
          source_document_id: context.source.source_document_id,
          source_document_version: context.source.source_document_version,
          source_document_hash: context.source.source_document_hash,
          ...reconciled,
        });
        const trace: ShotPlanProposalTraceV1 = {
          operation_id: context.input.operation_id,
          request_snapshot_hash: context.requestSnapshotHash,
          prompt_template_id: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
          prompt_template_version: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
          model_alias: SHOT_PLAN_PROPOSER_MODEL_ALIAS,
          provider_request_id: providerResult.request_id,
          provider_alias: providerResult.provider_alias,
          provider_model: providerResult.provider_model,
          provider_attempts: attempt,
          duration_ms: Math.max(0, this.#clock() - startedAt),
        };
        this.#safeAudit('shot_plan.proposal.succeeded', {
          operation_id: trace.operation_id,
          candidate_id: record.candidate.candidate_id,
          request_snapshot_hash: trace.request_snapshot_hash,
          prompt_template_id: trace.prompt_template_id,
          prompt_template_version: trace.prompt_template_version,
          model_alias: trace.model_alias,
          provider_request_id: trace.provider_request_id,
          provider_alias: trace.provider_alias,
          provider_model: trace.provider_model,
          provider_attempts: trace.provider_attempts,
          duration_ms: trace.duration_ms,
        });
        return { candidate: record.candidate, trace };
      } catch (error) {
        lastError = error;
        if (
          options.signal?.aborted ||
          (isGatewayClientError(error) && error.code === 'CANCELLED')
        ) {
          throw new ShotPlanProposerError('SHOT_PLAN_PROPOSAL_CANCELLED');
        }
        if (attempt >= this.#maxProviderAttempts || !shouldRetry(error)) break;
      }
    }

    const errorCode =
      lastError instanceof ShotPlanProposalStructuralError ||
      lastError instanceof ShotPlanProposerError
        ? lastError.code
        : isGatewayClientError(lastError)
          ? `SHOT_PLAN_PROPOSAL_PROVIDER_${lastError.code}`
          : 'SHOT_PLAN_PROPOSAL_PROVIDER_FAILED';
    this.#safeAudit('shot_plan.proposal.failed', {
      operation_id: context.input.operation_id,
      request_snapshot_hash: context.requestSnapshotHash,
      prompt_template_id: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
      prompt_template_version: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
      model_alias: SHOT_PLAN_PROPOSER_MODEL_ALIAS,
      provider_request_id: lastProviderRequestId,
      error_code: errorCode,
      duration_ms: Math.max(0, this.#clock() - startedAt),
    });
    throw new ShotPlanProposerError(errorCode);
  }

  #validateProviderIdentity(request: TextGatewayRequestV1, result: TextGatewayResultV1): void {
    if (
      result.request_id !== request.request_id ||
      result.request_snapshot_hash !== request.request_snapshot_hash
    ) {
      fail('SHOT_PLAN_PROPOSAL_PROVIDER_IDENTITY_MISMATCH');
    }
  }

  #safeAudit(event: string, fields: Record<string, unknown>): void {
    try {
      this.#audit(event, fields);
    } catch {
      // Audit transport is deliberately non-authoritative after Candidate persistence.
    }
  }
}
