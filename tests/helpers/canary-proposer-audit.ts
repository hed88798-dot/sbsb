import { writeFileSync } from 'node:fs';

const normalizationEvent = 'shot_plan.proposal.structural_normalization';
const normalizationRule = 'OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1';

interface Correlation {
  operation_id: string;
  provider_request_id: string;
}

interface NormalizationEvidence extends Correlation {
  event: typeof normalizationEvent;
  structural_normalization: typeof normalizationRule;
  normalized_optional_context_fields: number;
  raw_provider_canonical_schema_validation: 'FAIL';
  post_normalization_canonical_schema_validation: 'PASS' | 'FAIL';
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);
}

/** Canary-only evidence sink. Never retains arbitrary audit fields or changes proposer behavior. */
export function createCanaryProposerAuditCollector(operationId: string) {
  if (!safeIdentifier(operationId)) throw new Error('CANARY_AUDIT_INVALID_OPERATION_ID');
  const events: NormalizationEvidence[] = [];
  let invalidEvent = false;

  const audit = (event: string, fields: Record<string, unknown>): void => {
    if (event !== normalizationEvent) return;
    if (
      fields.operation_id !== operationId ||
      !safeIdentifier(fields.provider_request_id) ||
      !fields.provider_request_id.startsWith('provider_request_') ||
      fields.structural_normalization !== normalizationRule ||
      !Number.isSafeInteger(fields.normalized_optional_context_fields) ||
      (fields.normalized_optional_context_fields as number) < 1 ||
      (fields.normalized_optional_context_fields as number) > 1000 ||
      fields.raw_provider_canonical_schema_validation !== 'FAIL' ||
      (fields.post_normalization_canonical_schema_validation !== 'PASS' &&
        fields.post_normalization_canonical_schema_validation !== 'FAIL') ||
      events.length >= 64
    ) {
      invalidEvent = true;
      return;
    }
    // Copy only explicitly allowed scalar values, never the incoming fields object.
    events.push({
      event: normalizationEvent,
      operation_id: operationId,
      provider_request_id: fields.provider_request_id,
      structural_normalization: normalizationRule,
      normalized_optional_context_fields: fields.normalized_optional_context_fields as number,
      raw_provider_canonical_schema_validation: 'FAIL',
      post_normalization_canonical_schema_validation:
        fields.post_normalization_canonical_schema_validation as 'PASS' | 'FAIL',
    });
  };

  const evidence = (trace: Correlation) => {
    if (
      invalidEvent ||
      trace.operation_id !== operationId ||
      !safeIdentifier(trace.provider_request_id) ||
      !trace.provider_request_id.startsWith('provider_request_') ||
      events.some((event) => event.provider_request_id !== trace.provider_request_id) ||
      events.length > 1
    ) {
      throw new Error('CANARY_AUDIT_CORRELATION_OR_EVENT_INVALID');
    }
    const event = events[0];
    if (event && event.post_normalization_canonical_schema_validation !== 'PASS') {
      throw new Error('CANARY_AUDIT_POST_NORMALIZATION_VALIDATION_FAILED');
    }
    return {
      operation_id: operationId,
      provider_request_id: trace.provider_request_id,
      STRUCTURAL_NORMALIZATION_APPLIED: event ? 'YES' : 'NO',
      NORMALIZATION_AUDIT_EXPECTED: event ? 'YES' : 'NO',
      NORMALIZATION_AUDIT_CAPTURED: event ? 'YES' : 'NOT_APPLICABLE',
      NORMALIZATION_AUDIT_EVENT_COUNT: events.length,
      NORMALIZATION_AUDIT_RULE: event?.structural_normalization ?? 'NONE',
      NORMALIZATION_AUDIT_FIELD_COUNT: event?.normalized_optional_context_fields ?? 0,
      NORMALIZATION_AUDIT_RAW_CANONICAL_VALIDATION:
        event?.raw_provider_canonical_schema_validation ?? 'NOT_APPLICABLE',
      NORMALIZATION_AUDIT_POST_NORMALIZATION_VALIDATION:
        event?.post_normalization_canonical_schema_validation ?? 'NOT_APPLICABLE',
      normalization_audit_events: events.map((value) => ({ ...value })),
    };
  };

  return {
    audit,
    evidence,
    writeEvidence(path: string, trace: Correlation) {
      const report = evidence(trace);
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      return report;
    },
  };
}
