import { describe, expect, it } from 'vitest';
import {
  angleEquivalent,
  displayAngleFamily,
  normalizeDisplayAngle,
} from '../../tools/ffmpeg-render-build/rotation-angle.mjs';

describe('FFmpeg display-matrix angle normalization', () => {
  it('normalizes modulo 360 with tolerance', () => {
    expect(normalizeDisplayAngle(0)).toBe(0);
    expect(normalizeDisplayAngle(0.4)).toBe(0);
    expect(normalizeDisplayAngle(360)).toBe(0);
    expect(normalizeDisplayAngle(90.4)).toBeCloseTo(90.4);
    expect(normalizeDisplayAngle(270)).toBe(-90);
    expect(normalizeDisplayAngle(-90)).toBe(-90);
    expect(normalizeDisplayAngle(180)).toBe(180);
    expect(normalizeDisplayAngle(-180)).toBe(180);
    expect(normalizeDisplayAngle(179.6)).toBe(180);
  });

  it('accepts signed equivalent representations but keeps quarter-turn direction', () => {
    expect(angleEquivalent(0, 0)).toBe(true);
    expect(angleEquivalent(90.4, 90)).toBe(true);
    expect(angleEquivalent(-90, 270)).toBe(true);
    expect(angleEquivalent(180, -180)).toBe(true);
    expect(angleEquivalent(90, 270)).toBe(false);
    expect(displayAngleFamily(90)).toBe('POSITIVE_90');
    expect(displayAngleFamily(270)).toBe('NEGATIVE_90');
    expect(displayAngleFamily(90)).not.toBe(displayAngleFamily(270));
  });
});
