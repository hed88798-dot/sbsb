import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ShotPlanAuthorityService } from '../../apps/desktop/src/main/shot-plan-authority-service.js';
import {
  ShotPlanProposerServiceV1,
  ShotPlanProposerError,
} from '../../apps/desktop/src/main/shot-plan-proposer-service.js';
import { SourceDocumentAuthorityService } from '../../apps/desktop/src/main/source-document-authority-service.js';
import {
  normalizeOptionalContextNullV1,
  OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1,
} from '../../apps/desktop/src/main/shot-plan-proposal-normalization.js';
import { reconcileSemanticShotPlanProposal } from '../../apps/desktop/src/main/shot-plan-proposal-reconciler.js';
import {
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
  SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
} from '../../apps/desktop/src/main/shot-plan-proposer-prompt.v1.js';
import {
  shotPlanSemanticProposalV1Schema,
  type ShotPlanSemanticProposalV1,
  type TextGatewayRequestV1,
  type TextGatewayResultV1,
} from '../../packages/contracts/src/index.js';
import {
  CopywritingRepository,
  ShotPlanAuthorityRepository,
  SourceDocumentRepository,
} from '../../packages/local-db/dist/index.js';
import type { TextCapabilityClient } from '../../packages/provider-client/src/index.js';
import {
  evaluateShotPlanSemanticProposalV1,
  shotPlanSemanticGoldenFixturesV1,
} from '../../packages/test-fixtures/src/shot-plan-semantic.js';
import { createCanaryProposerAuditCollector } from './canary-proposer-audit.js';
import type { observeGoldenProviderUsage } from './golden-provider-usage.js';

const canonicalSchema = JSON.parse(
  readFileSync(
    new URL(
      '../../schemas/shot-planning/v1/semantic-shot-plan-proposal.schema.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(canonicalSchema);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const systemic = [
  'AUTH_FAILED',
  'QUOTA_EXHAUSTED',
  'BUDGET_EXCEEDED',
  'LICENSE_BUDGET_EXCEEDED',
  'PROVIDER_NOT_APPROVED',
  'NO_PROVIDER_ROUTE',
  'INVALID_PARAMS',
  'UNSUPPORTED_MODEL',
];
type Database = ConstructorParameters<typeof SourceDocumentRepository>[0];
type TechnicalResult =
  | 'PASS'
  | 'FAIL_PROVIDER'
  | 'FAIL_RAW_JSON'
  | 'FAIL_CANONICAL'
  | 'FAIL_RECONCILIATION'
  | 'FAIL_CANDIDATE'
  | 'FAIL_EVIDENCE'
  | 'FAIL_ENVIRONMENT';

/** Human inspection projection only; invalid data never becomes a canonical proposal. */
function rawSemanticEvidence(value: unknown) {
  const object = (input: unknown): Record<string, unknown> | null =>
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;
  const scalars = (input: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(
      keys
        .filter(
          (key) =>
            Object.hasOwn(input, key) &&
            (input[key] === null || ['string', 'number', 'boolean'].includes(typeof input[key])),
        )
        .map((key) => [key, input[key]]),
    );
  const warnings = (input: unknown) =>
    Array.isArray(input)
      ? input.map((item) =>
          object(item)
            ? scalars(object(item)!, ['code', 'severity', 'message'])
            : { invalid_warning_type: typeof item },
        )
      : null;
  const record = object(value);
  if (!record) return null;
  return {
    ...scalars(record, ['schema_version', 'segmentation_state']),
    review_warnings: warnings(record.review_warnings),
    raw_unit_count: Array.isArray(record.units) ? record.units.length : null,
    units:
      Array.isArray(record.units) && record.units.length <= 500
        ? record.units.map((item) => {
            const unit = object(item);
            if (!unit) return { invalid_unit_type: typeof item };
            const state = (key: string) =>
              !Object.hasOwn(unit, key)
                ? 'ABSENT'
                : unit[key] === null
                  ? 'NULL'
                  : typeof unit[key] === 'string'
                    ? 'STRING'
                    : 'INVALID';
            return {
              ...scalars(unit, [
                'exact_fragment',
                'left_context',
                'right_context',
                'route',
                'route_state',
                'continuity_action',
                'continuity_state',
                'rationale',
              ]),
              review_warnings: warnings(unit.review_warnings),
              raw_left_context_state: state('left_context'),
              raw_right_context_state: state('right_context'),
            };
          })
        : [],
  };
}

function reconstruct(text: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      raw_json_parse: 'FAIL',
      raw_canonical: 'NOT_RUN',
      normalized_count: 0,
      post_canonical: 'NOT_RUN',
      canonical: null,
      raw_semantic_proposal: null,
      raw_context_states: [],
    } as const;
  }
  const rawValid = validate(raw) && shotPlanSemanticProposalV1Schema.safeParse(raw).success;
  const normalized = normalizeOptionalContextNullV1(raw);
  const parsed = shotPlanSemanticProposalV1Schema.safeParse(normalized.value);
  const valid = validate(normalized.value) && parsed.success;
  const units =
    raw && typeof raw === 'object' && 'units' in raw && Array.isArray(raw.units) ? raw.units : [];
  const state = (value: unknown) =>
    value === undefined
      ? 'ABSENT'
      : value === null
        ? 'NULL'
        : typeof value === 'string'
          ? 'STRING'
          : 'INVALID';
  return {
    raw_json_parse: 'PASS',
    raw_canonical: rawValid ? 'PASS' : 'FAIL',
    normalized_count: normalized.normalizedOptionalContextFields,
    post_canonical: valid ? 'PASS' : 'FAIL',
    canonical: valid && parsed.success ? parsed.data : null,
    raw_semantic_proposal: rawSemanticEvidence(raw),
    raw_context_states: units.map((unit: Record<string, unknown>) => ({
      raw_left_context_state: state(unit?.left_context),
      raw_right_context_state: state(unit?.right_context),
    })),
  } as const;
}

export function captureGoldenClient(
  client: TextCapabilityClient,
  onRequest: (request: TextGatewayRequestV1) => void,
  onResult: (result: TextGatewayResultV1) => void,
): TextCapabilityClient {
  return {
    async generate(request, options) {
      try {
        onRequest(request);
      } catch {
        /* Observation cannot change the request or retry policy. */
      }
      const result = await client.generate(request, options);
      try {
        onResult(result);
      } catch {
        /* Missing evidence is checked after execution. */
      }
      return result;
    },
  };
}

export function automatedSemanticPass(
  evaluation: ReturnType<typeof evaluateShotPlanSemanticProposalV1>,
): boolean {
  return (
    evaluation.structural_validity &&
    evaluation.segmentation &&
    evaluation.route &&
    evaluation.continuity &&
    evaluation.needs_review &&
    evaluation.forbidden_outcome_violations.length === 0
  );
}

interface Attempt {
  request_id: string;
  reconstruction: ReturnType<typeof reconstruct> | null;
  identity_matches: boolean;
  audit: ReturnType<typeof createCanaryProposerAuditCollector>;
  normalization_events: Array<Record<string, string | number>>;
  audit_invalid: boolean;
}

export async function runShotPlanGoldenEvaluation(options: {
  directory: string;
  gitHead: string;
  desktopDb: Database;
  gatewayDb: Database;
  client: TextCapabilityClient;
  usage: ReturnType<typeof observeGoldenProviderUsage>;
  forbiddenValues: string[];
  executionKind: 'REAL_PROVIDER_EVALUATION' | 'DETERMINISTIC_FAKE_TRANSPORT';
  now?: () => Date;
}) {
  const fixtures = shotPlanSemanticGoldenFixturesV1;
  if (
    fixtures.length !== 30 ||
    new Set(fixtures.map((f) => f.id)).size !== 30 ||
    !/^[a-f0-9]{40}$/u.test(options.gitHead)
  )
    throw new Error('GOLDEN_INVALID_AUTHORITY_OR_HEAD');
  const paths = ['real-30-golden-summary.json', 'real-30-golden-cases.json'].map((name) =>
    join(options.directory, name),
  );
  if (paths.some((path) => existsSync(path))) throw new Error('GOLDEN_EVIDENCE_ALREADY_EXISTS');
  const descriptors: number[] = [];
  try {
    for (const path of paths) descriptors.push(openSync(path, 'wx', 0o600));
  } catch (error) {
    descriptors.forEach(closeSync);
    throw error;
  }
  const now = options.now ?? (() => new Date());
  const runId = randomUUID();
  const fixtureHash = sha256(JSON.stringify(fixtures));
  const metadata = {
    schema_version: 'c3c-real-golden-evaluation-v1',
    execution_kind: options.executionKind,
    execution_mode: 'SEQUENTIAL',
    git_head: options.gitHead,
    evaluation_timestamp: now().toISOString(),
    provider: 'Alibaba Cloud Model Studio',
    region: 'China (Beijing)',
    capability_alias: 'text.semantic-shot-planning',
    provider_alias: 'alibaba-beijing-qwen37-plus-c3c-nonthinking',
    provider_model: 'qwen3.7-plus',
    model_version_policy: 'ROLLING_PROVIDER_MODEL',
    prompt_template_id: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_ID,
    prompt_template_version: SHOT_PLAN_PROPOSER_PROMPT_TEMPLATE_VERSION,
    canonical_schema_version: '1.0',
    canonical_schema_sha256: sha256(JSON.stringify(canonicalSchema)),
    normalization_rule: OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1,
    wire_policy: {
      temperature: 0.7,
      enable_thinking: false,
      response_format: 'json_schema',
      strict: true,
      schema_name: 'ShotPlanSemanticProposalV1',
      absent_fields: [
        'max_tokens',
        'max_completion_tokens',
        'thinking_budget',
        'reasoning_effort',
        'tools',
        'stream',
      ],
    },
    fixture_authority: 'shotPlanSemanticGoldenFixturesV1',
    evaluator_authority: 'evaluateShotPlanSemanticProposalV1',
    fixture_count: fixtures.length,
    fixture_sha256: fixtureHash,
    fixture_ids: fixtures.map((f) => f.id),
    C3C_REAL_MODEL_SEMANTIC_ACCEPTANCE: 'PENDING_BRAIN1_REVIEW',
  };
  const forbidden = new Set(options.forbiddenValues.filter(Boolean));
  const rejectsSecret = (value: unknown) => {
    const serialized = JSON.stringify(value);
    return [...forbidden].some(
      (secret) =>
        serialized.includes(secret) || serialized.includes(JSON.stringify(secret).slice(1, -1)),
    );
  };
  const rejectUnsafeEvidence = () => {
    descriptors.forEach((fd) =>
      writeFileSync(fd, JSON.stringify({ ...metadata, error: 'EVIDENCE_SECRET_REJECTED' })),
    );
    throw new Error('EVIDENCE_SECRET_REJECTED');
  };
  const sources = new SourceDocumentRepository(options.desktopDb);
  const repository = new ShotPlanAuthorityRepository(options.desktopDb);
  const sourceAuthority = new SourceDocumentAuthorityService({
    scripts: new CopywritingRepository(options.desktopDb),
    sourceDocuments: sources,
  });
  const shotPlans = new ShotPlanAuthorityService({ repository, sourceDocuments: sources });
  const candidateIds = new Set<string>();
  const cases = [];
  let stopReason: string | null = null;
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const scriptId = `golden_script_${runId}_${index}`;
      const operationId = `golden_operation_${runId}_${index}`;
      const timestamp = now().toISOString();
      options.desktopDb
        .prepare(
          'INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at) VALUES (?, NULL, 1, ?, ?)',
        )
        .run(scriptId, timestamp, timestamp);
      options.desktopDb
        .prepare(
          `INSERT INTO script_versions(script_id, version, text, raw_model_output, result_status, fact_snapshot_json, fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias, provider_model, request_snapshot_hash, created_at) VALUES (?, 1, ?, ?, 'SUCCEEDED', NULL, '[]', 'synthetic-golden', '1', 'synthetic', 'synthetic', ?, ?)`,
        )
        .run(
          scriptId,
          fixture.source_text,
          fixture.source_text,
          sha256(fixture.source_text),
          timestamp,
        );
      const source = sourceAuthority.ensureFromScriptVersion({
        script_id: scriptId,
        script_version: 1,
      });
      const attempts: Attempt[] = [];
      let active: Attempt | undefined;
      let unknownAudit = false;
      const wrapped = captureGoldenClient(
        options.client,
        (request) => {
          forbidden.add(request.prompt);
          if (request.structured_output)
            forbidden.add(JSON.stringify(request.structured_output.schema));
          active = {
            request_id: request.request_id,
            reconstruction: null,
            identity_matches: false,
            audit: createCanaryProposerAuditCollector(operationId),
            normalization_events: [],
            audit_invalid: false,
          };
          attempts.push(active);
          options.usage.begin(request.request_id);
        },
        (result) => {
          if (!active) return;
          active.identity_matches =
            result.request_id === active.request_id &&
            result.provider_alias === metadata.provider_alias &&
            result.provider_model === metadata.provider_model;
          active.reconstruction = reconstruct(result.text);
        },
      );
      const client: TextCapabilityClient = {
        async generate(request, settings) {
          try {
            return await wrapped.generate(request, settings);
          } finally {
            options.usage.end();
          }
        },
      };
      const service = new ShotPlanProposerServiceV1({
        sourceDocuments: sources,
        shotPlans,
        client,
        audit: (event, fields) => {
          if (event !== 'shot_plan.proposal.structural_normalization') return;
          const attempt = attempts.find((a) => a.request_id === fields.provider_request_id);
          if (!attempt || fields.operation_id !== operationId) {
            unknownAudit = true;
            return;
          }
          attempt.audit.audit(event, fields);
          if (
            fields.structural_normalization !== OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1 ||
            !Number.isSafeInteger(fields.normalized_optional_context_fields) ||
            (fields.normalized_optional_context_fields as number) < 1 ||
            (fields.normalized_optional_context_fields as number) > 1000 ||
            fields.raw_provider_canonical_schema_validation !== 'FAIL' ||
            (fields.post_normalization_canonical_schema_validation !== 'PASS' &&
              fields.post_normalization_canonical_schema_validation !== 'FAIL')
          ) {
            attempt.audit_invalid = true;
            return;
          }
          attempt.normalization_events.push({
            event: 'shot_plan.proposal.structural_normalization',
            operation_id: operationId,
            provider_request_id: attempt.request_id,
            structural_normalization: OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1,
            normalized_optional_context_fields: fields.normalized_optional_context_fields as number,
            raw_provider_canonical_schema_validation:
              fields.raw_provider_canonical_schema_validation,
            post_normalization_canonical_schema_validation:
              fields.post_normalization_canonical_schema_validation,
          });
        },
      });
      let technical: TechnicalResult = 'PASS';
      let errorCode = 'NONE';
      let candidate = null;
      let canonical: ShotPlanSemanticProposalV1 | null = null;
      try {
        const result = await service.propose({
          operation_id: operationId,
          source_document_id: source.source_document_id,
          source_document_version: source.source_document_version,
          source_document_hash: source.source_document_hash,
        });
        candidate = result.candidate;
        const last = attempts.at(-1)!;
        canonical = last.reconstruction?.canonical ?? null;
        if (
          !canonical ||
          !last.identity_matches ||
          candidateIds.has(candidate.candidate_id) ||
          result.trace.provider_attempts !== attempts.length
        )
          throw new Error('GOLDEN_CANDIDATE_INCONSISTENT');
        const groupIds = [
          ...new Set(
            candidate.slots
              .map((s) => s.visual_continuity_group_id)
              .filter((s): s is string => s !== null),
          ),
        ];
        const reconciled = reconcileSemanticShotPlanProposal(source, canonical, {
          continuityGroupId: (groupIndex) => groupIds[groupIndex]!,
        });
        const actualSlots = candidate.slots.map((slot) => ({
          order_index: slot.order_index,
          source_start: slot.source_start,
          source_end: slot.source_end,
          source_text: slot.source_text,
          route: slot.route,
          route_state: slot.route_state,
          visual_continuity_group_id: slot.visual_continuity_group_id,
          continuity_state: slot.continuity_state,
          rationale: slot.rationale,
          review_warnings: slot.review_warnings,
        }));
        if (
          JSON.stringify(reconciled.slots) !== JSON.stringify(actualSlots) ||
          candidate.segmentation_state !== canonical.segmentation_state ||
          JSON.stringify(candidate.review_warnings) !== JSON.stringify(canonical.review_warnings) ||
          candidate.source_offset_unit !== 'UNICODE_CODE_POINT' ||
          candidate.source_document_hash !== source.source_document_hash ||
          candidate.source_document_id !== scriptId ||
          candidate.candidate_revision !== 1 ||
          candidate.candidate_status !== 'ACTIVE' ||
          'review_state' in candidate ||
          JSON.stringify(repository.getCandidate(candidate.candidate_id)?.candidate) !==
            JSON.stringify(candidate)
        )
          throw new Error('GOLDEN_CANDIDATE_INCONSISTENT');
        candidateIds.add(candidate.candidate_id);
      } catch (error) {
        const code =
          error instanceof ShotPlanProposerError ? error.code : 'GOLDEN_CANDIDATE_INCONSISTENT';
        const last = attempts.at(-1)?.reconstruction;
        canonical = last?.canonical ?? null;
        if (code === 'SHOT_PLAN_PROPOSAL_PROVIDER_FAILED' && canonical) {
          technical = 'FAIL_CANDIDATE';
          errorCode = 'CANDIDATE_PERSISTENCE_FAILED';
          stopReason = errorCode;
        } else if (code.includes('_PROVIDER_')) {
          technical = 'FAIL_PROVIDER';
          errorCode = systemic.find((c) => code.endsWith(`_${c}`)) ?? 'PROVIDER_FAILURE';
        } else if (last?.raw_json_parse === 'FAIL') {
          technical = 'FAIL_RAW_JSON';
          errorCode = 'INVALID_JSON';
        } else if (last?.post_canonical === 'FAIL') {
          technical = 'FAIL_CANONICAL';
          errorCode = 'INVALID_CANONICAL';
        } else if (
          code.startsWith('SHOT_PLAN_PROPOSAL_') &&
          !code.includes('INVALID_STRUCTURED_OUTPUT')
        ) {
          technical = 'FAIL_RECONCILIATION';
          errorCode = 'SOURCE_RECONCILIATION_FAILED';
        } else {
          technical = 'FAIL_CANDIDATE';
          errorCode = 'CANDIDATE_INCONSISTENT';
          stopReason = errorCode;
        }
      }
      const attemptReports = attempts.map((attempt) => {
        const usage = options.usage.get(attempt.request_id);
        const settlement = options.gatewayDb
          .prepare(
            "SELECT COUNT(*) AS count, COALESCE(SUM(final_cost),0) AS amount FROM usage_events WHERE request_id=? AND event_type='SETTLEMENT'",
          )
          .get(attempt.request_id) as { count: number; amount: number };
        const job = options.gatewayDb
          .prepare('SELECT state, error_class FROM provider_jobs WHERE request_id=?')
          .get(attempt.request_id) as { state: string; error_class: string | null } | undefined;
        const noProviderCall = !job && usage.provider_requests === 0;
        const cost = settlement.count
          ? settlement.amount
          : job?.state === 'FAILED' || noProviderCall
            ? 0
            : null;
        if (noProviderCall)
          Object.assign(usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        if (!job && usage.provider_requests === 0) stopReason = 'GATEWAY_ENVIRONMENT_FAILURE';
        if (cost === null) {
          technical = 'FAIL_EVIDENCE';
          errorCode = 'UNSETTLED_PROVIDER_OUTCOME';
          stopReason = errorCode;
        }
        const reconstruction = attempt.reconstruction;
        if (reconstruction && usage.provider_requests !== 1) {
          technical = 'FAIL_EVIDENCE';
          errorCode = 'PROVIDER_REQUEST_EVIDENCE_INCONSISTENT';
          stopReason = errorCode;
        }
        let auditEvidence = null;
        let auditValid = !attempt.audit_invalid;
        if (reconstruction?.normalized_count) {
          const event = attempt.normalization_events[0];
          auditValid &&=
            attempt.normalization_events.length === 1 &&
            event?.normalized_optional_context_fields === reconstruction.normalized_count &&
            event?.post_normalization_canonical_schema_validation === reconstruction.post_canonical;
          if (reconstruction.post_canonical === 'PASS') {
            try {
              auditEvidence = attempt.audit.evidence({
                operation_id: operationId,
                provider_request_id: attempt.request_id,
              });
            } catch {
              auditValid = false;
            }
          }
        } else {
          auditValid &&= attempt.normalization_events.length === 0;
          try {
            auditEvidence = attempt.audit.evidence({
              operation_id: operationId,
              provider_request_id: attempt.request_id,
            });
          } catch {
            auditValid = false;
          }
        }
        if (
          !auditValid ||
          unknownAudit ||
          (reconstruction && !attempt.identity_matches) ||
          usage.thinking_state === 'NONEMPTY'
        ) {
          technical = 'FAIL_EVIDENCE';
          errorCode = 'EVIDENCE_INCONSISTENT';
          stopReason = errorCode;
        }
        if (reconstruction && !attempt.identity_matches)
          stopReason = 'MODEL_OR_RESULT_IDENTITY_MISMATCH';
        if (
          (usage.prompt_tokens !== null && usage.prompt_tokens > 256000) ||
          (usage.completion_tokens !== null && usage.completion_tokens > 131072)
        ) {
          technical = 'FAIL_EVIDENCE';
          errorCode = 'USAGE_OUTSIDE_PROTECTED_ENVELOPE';
          stopReason = errorCode;
        }
        if (
          settlement.count &&
          (usage.prompt_tokens === null ||
            usage.completion_tokens === null ||
            usage.total_tokens === null ||
            usage.prompt_tokens > 256000 ||
            Math.abs(
              usage.prompt_tokens * 0.000002 +
                usage.completion_tokens * 0.000008 -
                settlement.amount,
            ) > 1e-10)
        ) {
          technical = 'FAIL_EVIDENCE';
          errorCode = 'USAGE_EVIDENCE_INCONSISTENT';
          stopReason = errorCode;
        }
        return {
          request_id: attempt.request_id,
          ...usage,
          settled_cost_cny: cost,
          raw_json_parse: reconstruction?.raw_json_parse ?? 'NOT_RUN',
          raw_provider_canonical_schema_validation: reconstruction?.raw_canonical ?? 'NOT_RUN',
          structural_normalization_applied: reconstruction
            ? reconstruction.normalized_count > 0
            : null,
          normalized_optional_context_fields: reconstruction?.normalized_count ?? 0,
          post_normalization_canonical_schema_validation:
            reconstruction?.post_canonical ?? 'NOT_RUN',
          normalization_audit: auditEvidence,
          normalization_audit_events: attempt.normalization_events,
          canonical_proposal: reconstruction?.canonical ?? null,
          raw_semantic_proposal: reconstruction?.raw_semantic_proposal ?? null,
        };
      });
      const evaluation = canonical ? evaluateShotPlanSemanticProposalV1(fixture, canonical) : null;
      const semanticResult =
        technical !== 'PASS' || !evaluation
          ? 'NOT_EVALUATED'
          : automatedSemanticPass(evaluation)
            ? 'AUTOMATED_SEMANTIC_PASS'
            : 'AUTOMATED_SEMANTIC_FAIL';
      cases.push({
        fixture_id: fixture.id,
        source_text: fixture.source_text,
        route_review: fixture.route_review,
        expected_needs_review: fixture.expected_needs_review,
        operation_id: operationId,
        source_document_id: scriptId,
        source_document_hash: source.source_document_hash,
        technical_result: technical,
        error_code: errorCode,
        automated_semantic_result: semanticResult,
        evaluation,
        actual_needs_review: canonical
          ? canonical.segmentation_state === 'NEEDS_REVIEW' ||
            canonical.units.some(
              (u) => u.route_state === 'NEEDS_REVIEW' || u.continuity_state === 'NEEDS_REVIEW',
            )
          : null,
        segmentation_state: canonical?.segmentation_state ?? null,
        review_warnings: canonical?.review_warnings ?? [],
        semantic_units:
          canonical?.units.map((unit, unitIndex) => ({
            ...unit,
            ...attempts.at(-1)!.reconstruction!.raw_context_states[unitIndex],
          })) ??
          attempts.at(-1)?.reconstruction?.raw_semantic_proposal?.units ??
          [],
        candidate,
        provider_attempts: attempts.length,
        provider_request_count: attemptReports.reduce((sum, a) => sum + a.provider_requests, 0),
        attempts: attemptReports,
      });
      if (systemic.includes(errorCode)) stopReason = errorCode;
      if (rejectsSecret(cases.at(-1))) rejectUnsafeEvidence();
      if (stopReason) break;
    }
    if (sha256(JSON.stringify(fixtures)) !== fixtureHash)
      throw new Error('GOLDEN_FIXTURES_CHANGED');
    const completed = cases.filter((c) => c.technical_result === 'PASS');
    const allAttempts = cases.flatMap((c) => c.attempts);
    const sum = (
      key: 'prompt_tokens' | 'completion_tokens' | 'total_tokens' | 'settled_cost_cny',
    ) =>
      allAttempts.some((a) => a[key] === null)
        ? null
        : allAttempts.reduce((total, a) => total + (a[key] ?? 0), 0);
    const dimension = (
      key: 'structural_validity' | 'segmentation' | 'route' | 'continuity' | 'needs_review',
    ) => completed.filter((c) => c.evaluation?.[key]).length;
    const passCount = cases.filter(
      (c) => c.automated_semantic_result === 'AUTOMATED_SEMANTIC_PASS',
    ).length;
    const summary = {
      ...metadata,
      FIXTURES_EXPECTED: 30,
      FIXTURES_STARTED: cases.length,
      FIXTURES_TECHNICALLY_COMPLETED: completed.length,
      FIXTURES_AUTOMATED_SEMANTIC_PASS: passCount,
      FIXTURES_AUTOMATED_SEMANTIC_FAIL: cases.filter(
        (c) => c.automated_semantic_result === 'AUTOMATED_SEMANTIC_FAIL',
      ).length,
      FIXTURES_TECHNICAL_FAIL: cases.length - completed.length,
      STRUCTURAL_PASS_COUNT: dimension('structural_validity'),
      SEGMENTATION_PASS_COUNT: dimension('segmentation'),
      ROUTE_PASS_COUNT: dimension('route'),
      CONTINUITY_PASS_COUNT: dimension('continuity'),
      NEEDS_REVIEW_PASS_COUNT: dimension('needs_review'),
      FORBIDDEN_VIOLATION_CASE_COUNT: cases.filter(
        (c) => (c.evaluation?.forbidden_outcome_violations.length ?? 0) > 0,
      ).length,
      AUTOMATED_30_CASE_GOLDEN_RESULT:
        cases.length === 30 && completed.length === 30 && passCount === 30 ? 'PASS' : 'FAIL',
      SUITE_STOP_REASON: stopReason,
      PROVIDER_ATTEMPTS_TOTAL: cases.reduce((total, c) => total + c.provider_attempts, 0),
      PROVIDER_REQUEST_COUNT_TOTAL: cases.reduce((total, c) => total + c.provider_request_count, 0),
      REAL_PROVIDER_REQUEST_COUNT:
        options.executionKind === 'REAL_PROVIDER_EVALUATION'
          ? cases.reduce((total, c) => total + c.provider_request_count, 0)
          : 0,
      PROMPT_TOKENS_TOTAL: sum('prompt_tokens'),
      COMPLETION_TOKENS_TOTAL: sum('completion_tokens'),
      TOTAL_TOKENS_TOTAL: sum('total_tokens'),
      SETTLED_COST_CNY_TOTAL: sum('settled_cost_cny'),
    };
    const reports = [summary, { ...metadata, cases }];
    const serialized = reports.map((report) => JSON.stringify(report, null, 2));
    if (reports.some(rejectsSecret)) rejectUnsafeEvidence();
    serialized.forEach((value, index) => writeFileSync(descriptors[index]!, `${value}\n`));
    return { summary, cases };
  } finally {
    descriptors.forEach(closeSync);
  }
}
