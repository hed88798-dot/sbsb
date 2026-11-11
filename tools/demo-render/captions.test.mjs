import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoSrt } from './captions.mjs';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
} from '../../packages/timeline/dist/index.js';

// Synthetic authority objects exercise formatting only; no MP4 acceptance claim.
function fixture() {
  const hash = 'a'.repeat(64);
  const planPreimage = {
    schema_version: '1.0',
    shot_plan_id: 'test-plan',
    shot_plan_version: 1,
    source_document_id: 'test-source',
    source_document_version: 1,
    source_document_hash: hash,
    review_state: 'CONFIRMED',
    source_offset_unit: 'UNICODE_CODE_POINT',
    slots: [
      {
        slot_id: 'one',
        order_index: 0,
        source_start: 0,
        source_end: 2,
        source_text: '猪群',
        route: 'ANIMAL',
        visual_continuity_group_id: 'one',
      },
      {
        slot_id: 'two',
        order_index: 1,
        source_start: 2,
        source_end: 4,
        source_text: '活动',
        route: 'ANIMAL',
        visual_continuity_group_id: 'two',
      },
    ],
  };
  const plan = { ...planPreimage, shot_plan_hash: computeConfirmedShotPlanHash(planPreimage) };
  const timingPreimage = {
    schema_version: '1.0',
    timing_snapshot_id: 'test-timing',
    timing_snapshot_version: 1,
    timing_kind: 'EXACT',
    shot_plan_id: plan.shot_plan_id,
    shot_plan_hash: plan.shot_plan_hash,
    source_document_id: plan.source_document_id,
    source_document_hash: hash,
    narration_audio_id: 'test-audio',
    narration_audio_hash: hash,
    total_duration_ms: 15000,
    slot_timings: [
      { slot_id: 'one', start_ms: 0, end_ms: 7000 },
      { slot_id: 'two', start_ms: 7000, end_ms: 15000 },
    ],
    pause_intervals: [],
  };
  return {
    plan,
    timing: {
      ...timingPreimage,
      timing_snapshot_hash: computeNarrationTimingSnapshotHash(timingPreimage),
    },
  };
}

test('exports Unicode sidecar with exact slot intervals', () => {
  const { plan, timing } = fixture();
  assert.equal(
    createDemoSrt(plan, timing),
    '1\n00:00:00,000 --> 00:00:07,000\n猪群\n\n2\n00:00:07,000 --> 00:00:15,000\n活动\n',
  );
});

test('rejects mutated timing bytes despite otherwise valid intervals', () => {
  const { plan, timing } = fixture();
  timing.slot_timings[0].end_ms = 6000;
  assert.throws(() => createDemoSrt(plan, timing), /AUTHORITY_MISMATCH/);
});

test('rejects timing bound to a different source even with a valid self hash', () => {
  const { plan, timing } = fixture();
  timing.source_document_hash = 'b'.repeat(64);
  timing.timing_snapshot_hash = computeNarrationTimingSnapshotHash(timing);
  assert.throws(() => createDemoSrt(plan, timing), /AUTHORITY_MISMATCH/);
});

test('rejects reordered slot timing even with a valid self hash', () => {
  const { plan, timing } = fixture();
  timing.slot_timings[0].slot_id = 'two';
  timing.slot_timings[1].slot_id = 'one';
  timing.timing_snapshot_hash = computeNarrationTimingSnapshotHash(timing);
  assert.throws(() => createDemoSrt(plan, timing), /SLOT_MISMATCH/);
});
