import { visualDescriptorV1Schema, type VisualDescriptorV1 } from '@app/contracts';

const MOTION_SENSITIVE_VALUES = new Set([
  'coughing',
  '咳嗽',
  'panting',
  '喘气',
  'limping',
  '跛行',
  'convulsing',
  '抽搐',
  'abnormal_movement',
  '异常走动',
]);

export function enforceConservativeTemporalEvidence(
  descriptor: VisualDescriptorV1,
): VisualDescriptorV1 {
  const parsed = visualDescriptorV1Schema.parse(descriptor);
  const healthEvidence = parsed.evidence.health_state;
  const healthState =
    parsed.health_state === 'unknown' ||
    (healthEvidence !== undefined &&
      healthEvidence.confidence >= 0.8 &&
      healthEvidence.temporal_evidence !== 'INSUFFICIENT')
      ? parsed.health_state
      : 'unknown';
  const actionValues = parsed.action === 'unknown' ? [] : parsed.action;
  const healthValues = parsed.health_state === 'unknown' ? [] : [parsed.health_state];
  const sensitive = [...actionValues, ...healthValues].filter((value) =>
    MOTION_SENSITIVE_VALUES.has(value),
  );
  if (sensitive.length === 0) {
    return visualDescriptorV1Schema.parse({
      ...parsed,
      health_state: healthState,
      confidence:
        healthState === 'unknown' ? { ...parsed.confidence, health_state: 0 } : parsed.confidence,
    });
  }
  const hasTemporalEvidence = sensitive.every((value) => {
    const evidence = parsed.evidence[`motion:${value}`];
    return evidence?.temporal_evidence === 'SUFFICIENT' && evidence.confidence >= 0.8;
  });
  if (hasTemporalEvidence) {
    return visualDescriptorV1Schema.parse({ ...parsed, health_state: healthState });
  }
  return visualDescriptorV1Schema.parse({
    ...parsed,
    action: actionValues.some((value) => !MOTION_SENSITIVE_VALUES.has(value))
      ? actionValues.filter((value) => !MOTION_SENSITIVE_VALUES.has(value))
      : 'unknown',
    health_state: 'unknown',
    confidence: { ...parsed.confidence, action: 0, health_state: 0 },
    evidence: {
      ...parsed.evidence,
      motion_sensitive_guard: {
        value: null,
        confidence: 0,
        provenance: 'motion-sensitive-guard-v1',
        temporal_evidence: 'INSUFFICIENT',
      },
    },
  });
}
