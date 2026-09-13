export const DISPLAY_ANGLE_TOLERANCE_DEGREES = 0.5;

/**
 * Normalize a display-matrix angle into the signed interval [-180, 180].
 * FFmpeg commonly represents 270 degrees as -90 degrees in stream metadata.
 */
export function normalizeDisplayAngle(angle, tolerance = DISPLAY_ANGLE_TOLERANCE_DEGREES) {
  if (!Number.isFinite(angle)) {
    throw new TypeError(`display angle must be finite: ${angle}`);
  }

  let normalized = angle % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;

  if (Math.abs(normalized) <= tolerance) return 0;
  if (Math.abs(Math.abs(normalized) - 180) <= tolerance) return 180;
  return normalized;
}

export function angleEquivalent(actual, expected, tolerance = DISPLAY_ANGLE_TOLERANCE_DEGREES) {
  const actualNormalized = normalizeDisplayAngle(actual, tolerance);
  const expectedNormalized = normalizeDisplayAngle(expected, tolerance);
  return Math.abs(actualNormalized - expectedNormalized) <= tolerance;
}

export function displayAngleFamily(angle, tolerance = DISPLAY_ANGLE_TOLERANCE_DEGREES) {
  const normalized = normalizeDisplayAngle(angle, tolerance);
  if (Math.abs(normalized) <= tolerance) return 'IDENTITY';
  if (Math.abs(normalized - 90) <= tolerance) return 'POSITIVE_90';
  if (Math.abs(normalized + 90) <= tolerance) return 'NEGATIVE_90';
  if (Math.abs(Math.abs(normalized) - 180) <= tolerance) return 'HALF_TURN';
  return 'OTHER';
}
