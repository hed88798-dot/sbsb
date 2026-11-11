import {
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
} from '../../packages/contracts/dist/index.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
} from '../../packages/timeline/dist/index.js';

function timestamp(ms) {
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

// Sidecar only. No subtitle rendering, modified video, or Render Receipt is produced.
export function createDemoSrt(planValue, timingValue) {
  const plan = confirmedShotPlanV1Schema.parse(planValue);
  const timing = narrationTimingSnapshotV1Schema.parse(timingValue);
  const { shot_plan_hash, ...planPreimage } = plan;
  const { timing_snapshot_hash, ...timingPreimage } = timing;
  if (
    computeConfirmedShotPlanHash(planPreimage) !== shot_plan_hash ||
    computeNarrationTimingSnapshotHash(timingPreimage) !== timing_snapshot_hash ||
    timing.shot_plan_id !== plan.shot_plan_id ||
    timing.shot_plan_hash !== plan.shot_plan_hash ||
    timing.source_document_id !== plan.source_document_id ||
    timing.source_document_hash !== plan.source_document_hash ||
    timing.slot_timings.length !== plan.slots.length
  )
    throw new Error('DEMO_CAPTION_AUTHORITY_MISMATCH');
  return timing.slot_timings
    .map((interval, index) => {
      const slot = plan.slots[index];
      if (slot.slot_id !== interval.slot_id) throw new Error('DEMO_CAPTION_SLOT_MISMATCH');
      const text = slot.source_text
        .replace(/\r?\n/g, ' ')
        .replace(/-->/g, '→')
        .replace(/[<>]/g, '');
      return `${index + 1}\n${timestamp(interval.start_ms)} --> ${timestamp(interval.end_ms)}\n${text}\n`;
    })
    .join('\n');
}
