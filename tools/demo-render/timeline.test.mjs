import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { openDatabase, TimelinePlanRepository } from '../../packages/local-db/dist/index.js';
import { commitDemoTimeline } from './timeline.mjs';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  CopywritingRepository,
  SourceDocumentRepository,
  ShotPlanAuthorityRepository,
  MaterialSelectionRepository,
  NarrationAudioRepository,
} from '../../packages/local-db/dist/index.js';
import { SourceDocumentAuthorityService } from '../../apps/desktop/dist-electron/main/source-document-authority-service.js';
import { ShotPlanAuthorityService } from '../../apps/desktop/dist-electron/main/shot-plan-authority-service.js';
import { MaterialSelectionService } from '../../apps/desktop/dist-electron/main/material-selection-service.js';
import { computeNarrationTimingSnapshotHash } from '../../packages/timeline/dist/index.js';
import { computeNarrationAudioArtifactHashV1 } from '../../packages/render/dist/index.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Synthetic test inputs only. Media bytes are not a valid video; this checks
// authority integration, never formal render or real-material Demo acceptance.
async function seededFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'demo-timeline-synthetic-'));
  const { db } = await openDatabase({
    dbPath: join(directory, 'app.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
  });
  const now = '2026-11-12T00:00:00.000Z';
  db.prepare('INSERT INTO scripts VALUES (?, NULL, 1, ?, ?)').run('script-test', now, now);
  db.prepare(
    `INSERT INTO script_versions(script_id,version,text,raw_model_output,result_status,fact_snapshot_json,fact_conflicts_json,prompt_template_id,prompt_template_version,provider_alias,provider_model,request_snapshot_hash,created_at) VALUES (?,1,?,?,'SUCCEEDED',NULL,'[]','test','1','offline','offline',?,?)`,
  ).run('script-test', '猪群活动', '猪群活动', hash('script'), now);
  const sources = new SourceDocumentRepository(db);
  const source = new SourceDocumentAuthorityService({
    scripts: new CopywritingRepository(db),
    sourceDocuments: sources,
  }).ensureFromScriptVersion({ script_id: 'script-test', script_version: 1 });
  const authority = new ShotPlanAuthorityService({
    repository: new ShotPlanAuthorityRepository(db),
    sourceDocuments: sources,
  });
  const candidate = authority.createCandidate({
    ...source,
    segmentation_state: 'RESOLVED',
    slots: ['猪群', '活动'].map((text, i) => ({
      order_index: i,
      source_start: i * 2,
      source_end: i * 2 + 2,
      source_text: text,
      route: 'ANIMAL',
      route_state: 'RESOLVED',
      visual_continuity_group_id: `group-${i}`,
      continuity_state: 'RESOLVED',
    })),
  }).candidate;
  const plan = authority.confirmCandidate({
    candidate_id: candidate.candidate_id,
    candidate_revision: candidate.candidate_revision,
    source_document_id: source.source_document_id,
    source_document_version: 1,
    source_document_hash: source.source_document_hash,
  }).plan;
  const selectionIds = [];
  const selection = new MaterialSelectionService({
    repository: new MaterialSelectionRepository(db),
  });
  for (const [index, slot] of plan.slots.entries()) {
    const asset = `asset-${index}`,
      shot = `shot-${index}`,
      path = join(directory, `${asset}.mp4`);
    const bytes = `synthetic-test-only-${index}`;
    await writeFile(path, bytes);
    db.prepare(
      `INSERT INTO media_assets(asset_id,file_hash,media_type,status,active_revision,created_at,updated_at) VALUES (?,?,'video','ACTIVE',1,?,?)`,
    ).run(asset, hash(bytes), now, now);
    db.prepare(
      `INSERT INTO asset_revisions(asset_id,revision,file_hash,duration_ms,width,height,rotation,fps,index_signature_hash,generation_key_hash,index_signature_json,manifest_sha256,worker_version,state,created_at) VALUES (?,1,?,15000,100,100,0,25,?,?,'{}',?,'synthetic-test','READY',?)`,
    ).run(asset, hash(bytes), hash(asset), hash(shot), hash(bytes), now);
    db.prepare(
      `INSERT INTO shots(shot_id,asset_id,revision,start_ms,end_ms,quality_score,analysis_status) VALUES (?,?,1,0,15000,0.8,'READY')`,
    ).run(shot, asset);
    db.prepare(
      `INSERT INTO media_asset_locations(location_id,asset_id,source_path,normalized_path,size_bytes,mtime_ns,file_identity,location_status,last_seen_at) VALUES (?,?,?,?,?,'1',NULL,'PRESENT',?)`,
    ).run(`location-${index}`, asset, path, path, Buffer.byteLength(bytes), now);
    const id = `selection-${index}`;
    const result = selection.select({
      intent: {
        schema_version: '1.0',
        selection_request_id: id,
        batch_id: 'test-batch',
        video_id: 'test-video',
        slot_id: slot.slot_id,
        material_family: 'ANIMAL',
        candidate_set_id: `set-${index}`,
        candidate_set_contract_version: 'code-c-shot-search-v1',
      },
      eligibleCandidates: [
        {
          schema_version: '1.0',
          asset_id: asset,
          shot_id: shot,
          start_ms: 0,
          end_ms: 15000,
          revision: 1,
          semantic_score: 0.9,
          descriptor: {
            schema_version: '1.0',
            shot_id: shot,
            species: ['pig'],
            scene: 'farm',
            action: ['walking'],
            health_state: 'unknown',
            people_present: false,
            product_present: false,
            shot_type: 'unknown',
            description: 'synthetic authority test',
            quality: { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 },
            embedding_ref: `embedding-${index}`,
            industry_metadata: {},
            confidence: {},
            provenance: { source: 'synthetic-test' },
            evidence: {},
          },
        },
      ],
    });
    assert.equal(result.status, 'SELECTED');
    selectionIds.push(id);
  }
  // Valid 15-second mono PCM16 WAV, silence is explicitly test-only.
  const samples = 48000 * 15,
    wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  const audioPath = join(directory, 'test-silence.wav');
  await writeFile(audioPath, wav);
  const audioPreimage = {
    schema_version: '1.0',
    narration_audio_id: 'test-audio',
    artifact_id: 'test-artifact',
    artifact_sha256: hash(wav),
    duration_ms: 15000,
    duration_measurement: 'SAMPLE_COUNT_DERIVED',
    sample_count: samples,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: 48000,
    channels: 1,
    channel_layout: 'mono',
    size_bytes: wav.length,
    producer_ref: 'synthetic-test',
    provenance_ref: null,
  };
  await new NarrationAudioRepository(db).register({
    artifact: {
      ...audioPreimage,
      artifact_hash: computeNarrationAudioArtifactHashV1(audioPreimage),
    },
    trusted_local_path: audioPath,
  });
  const timingPreimage = {
    schema_version: '1.0',
    timing_snapshot_id: 'test-timing',
    timing_snapshot_version: 1,
    timing_kind: 'EXACT',
    shot_plan_id: plan.shot_plan_id,
    shot_plan_hash: plan.shot_plan_hash,
    source_document_id: plan.source_document_id,
    source_document_hash: plan.source_document_hash,
    narration_audio_id: 'test-audio',
    narration_audio_hash: hash(wav),
    total_duration_ms: 15000,
    slot_timings: plan.slots.map((slot, index) => ({
      slot_id: slot.slot_id,
      start_ms: index * 7500,
      end_ms: (index + 1) * 7500,
    })),
    pause_intervals: [],
  };
  const input = {
    database: db,
    shot_plan_id: plan.shot_plan_id,
    shot_plan_version: 1,
    timing_snapshot: {
      ...timingPreimage,
      timing_snapshot_hash: computeNarrationTimingSnapshotHash(timingPreimage),
    },
    selection_request_ids: selectionIds,
  };
  return { db, input };
}

test('commits synthetic authority chain and preserves exact 15-second duration', async () => {
  const { db, input } = await seededFixture();
  try {
    const result = await commitDemoTimeline(input);
    assert.equal(result.version, 1);
    assert.equal(result.planning_facts.total_duration_ms, 15000);
    assert.equal(new TimelinePlanRepository(db).listLatestCommitted().length, 1);
  } finally {
    db.close();
  }
});

test('rejects narration hash mismatch and duplicate extra selection without timeline writes', async () => {
  const { db, input } = await seededFixture();
  try {
    await assert.rejects(
      commitDemoTimeline({
        ...input,
        timing_snapshot: { ...input.timing_snapshot, narration_audio_hash: 'b'.repeat(64) },
      }),
      /NARRATION_AUDIO_TIMELINE_HASH_MISMATCH/,
    );
    await assert.rejects(
      commitDemoTimeline({
        ...input,
        selection_request_ids: [...input.selection_request_ids, input.selection_request_ids[0]],
      }),
      /DEMO_ONE_SELECTION_PER_SLOT_REQUIRED/,
    );
    const timing = { ...input.timing_snapshot, shot_plan_hash: 'b'.repeat(64) };
    timing.timing_snapshot_hash = computeNarrationTimingSnapshotHash(timing);
    await assert.rejects(commitDemoTimeline({ ...input, timing_snapshot: timing }));
    assert.deepEqual(new TimelinePlanRepository(db).listLatestCommitted(), []);
  } finally {
    db.close();
  }
});

test('fresh database cannot commit a timeline before explicit confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-render-authority-'));
  const { db } = await openDatabase({
    dbPath: join(directory, 'app.db'),
    migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
  });
  try {
    await assert.rejects(
      commitDemoTimeline({
        database: db,
        shot_plan_id: 'unconfirmed',
        shot_plan_version: 1,
        timing_snapshot: {},
        selection_request_ids: [],
      }),
      /DEMO_CONFIRMED_PLAN_REQUIRED/,
    );
    assert.deepEqual(new TimelinePlanRepository(db).listLatestCommitted(), []);
  } finally {
    db.close();
  }
});
