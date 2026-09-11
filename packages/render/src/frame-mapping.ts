import type { RenderPolicyV1 } from './contracts.js';

export interface TimelineFrameIntervalV1 {
  timeline_start_ms: number;
  timeline_end_ms: number;
  frame_start: number;
  frame_end: number;
}

export function timelineMsToFrameBoundaryV1(
  timelineMs: number,
  timebase: RenderPolicyV1['timebase'],
): number {
  if (!Number.isSafeInteger(timelineMs) || timelineMs < 0) {
    throw new Error('TIMELINE_FRAME_BOUNDARY_INVALID');
  }
  const numerator = BigInt(timelineMs) * BigInt(timebase.fps_numerator);
  const denominator = 1000n * BigInt(timebase.fps_denominator);
  const frame = (2n * numerator + denominator) / (2n * denominator);
  if (frame > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('TIMELINE_FRAME_BOUNDARY_OVERFLOW');
  }
  return Number(frame);
}

export function mapTimelineIntervalsToFramesV1(
  intervals: readonly { timeline_start_ms: number; timeline_end_ms: number }[],
  policy: RenderPolicyV1,
): TimelineFrameIntervalV1[] {
  let previousEndMs: number | null = null;
  let previousEndFrame: number | null = null;
  return intervals.map((interval) => {
    if (
      !Number.isSafeInteger(interval.timeline_start_ms) ||
      !Number.isSafeInteger(interval.timeline_end_ms) ||
      interval.timeline_start_ms < 0 ||
      interval.timeline_end_ms <= interval.timeline_start_ms ||
      (previousEndMs !== null && interval.timeline_start_ms < previousEndMs)
    ) {
      throw new Error('TIMELINE_FRAME_INTERVAL_INVALID');
    }
    const frameStart = timelineMsToFrameBoundaryV1(interval.timeline_start_ms, policy.timebase);
    const frameEnd = timelineMsToFrameBoundaryV1(interval.timeline_end_ms, policy.timebase);
    if (frameEnd <= frameStart) throw new Error('TIMELINE_SEGMENT_ZERO_FRAMES');
    if (
      previousEndMs !== null &&
      interval.timeline_start_ms === previousEndMs &&
      frameStart !== previousEndFrame
    ) {
      throw new Error('TIMELINE_SHARED_FRAME_BOUNDARY_MISMATCH');
    }
    previousEndMs = interval.timeline_end_ms;
    previousEndFrame = frameEnd;
    return {
      timeline_start_ms: interval.timeline_start_ms,
      timeline_end_ms: interval.timeline_end_ms,
      frame_start: frameStart,
      frame_end: frameEnd,
    };
  });
}
