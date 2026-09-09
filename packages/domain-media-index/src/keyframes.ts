export interface QualitySample {
  timestampMs: number;
  qualityScore: number;
}

export interface KeyframeSelection {
  role: 'SAFE_EARLY' | 'MIDPOINT' | 'BEST_QUALITY';
  timestampMs: number;
}

function clampTimestamp(value: number, startMs: number, endMs: number): number {
  return Math.max(startMs, Math.min(endMs - 1, Math.round(value)));
}

export function selectSafeMidBestKeyframes(
  startMs: number,
  endMs: number,
  samples: QualitySample[],
): KeyframeSelection[] {
  if (endMs <= startMs) throw new Error('INVALID_SHOT_RANGE');
  const duration = endMs - startMs;
  if (duration < 600) {
    return [
      { role: 'MIDPOINT', timestampMs: clampTimestamp(startMs + duration / 2, startMs, endMs) },
    ];
  }
  const safeOffset = Math.min(Math.max(duration * 0.1, 120), 500);
  const safe = clampTimestamp(startMs + safeOffset, startMs, endMs);
  const midpoint = clampTimestamp(startMs + duration / 2, startMs, endMs);
  const candidates = samples.filter(
    (sample) => sample.timestampMs >= startMs && sample.timestampMs < endMs,
  );
  const best = candidates.sort(
    (left, right) => right.qualityScore - left.qualityScore || left.timestampMs - right.timestampMs,
  )[0];
  const bestTimestamp = clampTimestamp(
    best?.timestampMs ?? startMs + duration * 0.75,
    startMs,
    endMs,
  );
  const selected: KeyframeSelection[] = [
    { role: 'SAFE_EARLY', timestampMs: safe },
    { role: 'MIDPOINT', timestampMs: midpoint },
    { role: 'BEST_QUALITY', timestampMs: bestTimestamp },
  ];
  return selected.filter(
    (item, index) =>
      selected.findIndex((candidate) => candidate.timestampMs === item.timestampMs) === index,
  );
}

export function selectQuartileKeyframes(startMs: number, endMs: number): number[] {
  if (endMs <= startMs) throw new Error('INVALID_SHOT_RANGE');
  const duration = endMs - startMs;
  return [0.25, 0.5, 0.75].map((ratio) =>
    clampTimestamp(startMs + duration * ratio, startMs, endMs),
  );
}
