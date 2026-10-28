export const OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1 = 'OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1';

/** Only parsed proposal units' optional context anchors have this compatibility rule. */
export function normalizeOptionalContextNullV1(value: unknown): {
  value: unknown;
  normalizedOptionalContextFields: number;
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { value, normalizedOptionalContextFields: 0 };
  }
  const proposal = value as Record<string, unknown>;
  // Leave oversized/invalid shapes to canonical validation, without traversing them.
  if (!Array.isArray(proposal.units) || proposal.units.length > 500) {
    return { value, normalizedOptionalContextFields: 0 };
  }
  let normalizedOptionalContextFields = 0;
  const units = proposal.units.map((unit: unknown) => {
    if (unit === null || typeof unit !== 'object' || Array.isArray(unit)) return unit;
    const record = unit as Record<string, unknown>;
    if (record.left_context !== null && record.right_context !== null) return unit;
    const normalized = { ...record };
    if (record.left_context === null) {
      delete normalized.left_context;
      normalizedOptionalContextFields += 1;
    }
    if (record.right_context === null) {
      delete normalized.right_context;
      normalizedOptionalContextFields += 1;
    }
    return normalized;
  });
  return {
    value: normalizedOptionalContextFields === 0 ? value : { ...proposal, units },
    normalizedOptionalContextFields,
  };
}
