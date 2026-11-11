import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  assetRevisionManifestV1Schema,
  type ConfirmedShotPlanV1,
  type NarrationTimingSnapshotV1,
  type CommittedMaterialSelectionRefV1,
} from '@app/contracts';
import { hashFile, hydrateSearchCandidates } from '@app/domain-media-index';
import type { MediaIndexRepository, NarrationAudioRepository } from '@app/local-db';
import { computeNarrationAudioArtifactHashV1, type NarrationAudioArtifactV1 } from '@app/render';
import {
  computeNarrationTimingSnapshotHash,
  parseConfirmedShotPlanV1,
  parseNarrationTimingSnapshotV1,
} from '@app/timeline';
import type { MaterialSelectionService } from './material-selection-service.js';
import { callSidecar } from './sidecar-client.js';

/** Executes real exact-search scores; caller activates/verifies worker + model before this call. */
export async function searchAndSelectDemoSlot(options: {
  plan: ConfirmedShotPlanV1;
  slot_id: string;
  generation_key_hash: string;
  cache_root: string;
  signature_hash: string;
  model_root: string;
  worker: { executablePath: string; args?: string[]; cwd?: string };
  media: Pick<MediaIndexRepository, 'listSearchableShots' | 'assertExactShotExecutable'>;
  selection: Pick<MaterialSelectionService, 'select'>;
}): Promise<CommittedMaterialSelectionRefV1> {
  const plan = parseConfirmedShotPlanV1(options.plan);
  const slot = plan.slots.find((item) => item.slot_id === options.slot_id);
  if (!slot || (slot.route !== 'ANIMAL' && slot.route !== 'PRODUCT'))
    throw new Error('DEMO_SLOT_ROUTE_UNSUPPORTED');
  const rows = options.media.listSearchableShots(options.generation_key_hash, {});
  const events = await callSidecar({
    ...options.worker,
    timeoutMs: 120000,
    request: {
      type: 'request',
      protocol_version: '1.0',
      request_id: `demo_search_${randomUUID()}`,
      method: 'media.search.exact.v1',
      payload: {
        cache_root: options.cache_root,
        signature_hash: options.signature_hash,
        model_root: options.model_root,
        query_text: slot.source_text,
        top_k: 20,
        allowed_shot_ids: rows.map((row) => row.shotId),
      },
    },
  });
  const result = events.at(-1);
  if (result?.type !== 'result')
    throw new Error(`DEMO_MEDIA_SEARCH_FAILED:${result?.error?.code ?? 'NO_RESULT'}`);
  const scores = z
    .object({
      candidates: z
        .array(
          z
            .object({
              asset_id: z.string().min(1),
              shot_id: z.string().min(1),
              revision: z.number().int().positive(),
              start_ms: z.number().int().nonnegative(),
              end_ms: z.number().int().positive(),
              semantic_score: z.number().finite().min(-1).max(1),
            })
            .strict(),
        )
        .max(20),
    })
    .strict()
    .parse(result.payload);
  const candidates = hydrateSearchCandidates(scores.candidates, rows);
  for (const candidate of candidates) options.media.assertExactShotExecutable(candidate);
  const selected = options.selection.select({
    intent: {
      schema_version: '1.0',
      selection_request_id: `demo_selection_${randomUUID()}`,
      batch_id: `demo_${plan.shot_plan_id}`,
      video_id: `demo_${plan.shot_plan_hash}`,
      slot_id: slot.slot_id,
      material_family: slot.route,
      candidate_set_id: `demo_search_${randomUUID()}`,
      candidate_set_contract_version: 'code-c-shot-search-v1',
    },
    eligibleCandidates: candidates,
  });
  if (selected.status !== 'SELECTED' || !selected.selected_asset_id || !selected.selected_shot_id)
    throw new Error('DEMO_MEDIA_NO_MATCH');
  return {
    selection_request_id: selected.selection_request_id,
    decision_receipt_hash: selected.decision_receipt_hash,
    asset_id: selected.selected_asset_id,
    shot_id: selected.selected_shot_id,
  };
}

// Main-only helpers. Paths must come from a local dialog or controlled worker job,
// never a renderer-supplied manifest or arbitrary executable.
export interface DemoPcmWave {
  sample_rate_hz: number;
  channels: 1 | 2;
  sample_count: number;
  pcm: Buffer;
}

export function parseDemoPcmWave(bytes: Buffer): DemoPcmWave {
  const fail = (): never => {
    throw new Error('DEMO_NARRATION_PCM16_WAV_REQUIRED');
  };
  if (
    bytes.length < 44 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    fail();
  let format: { rate: number; channels: 1 | 2; align: number } | undefined;
  let pcm: Buffer | undefined;
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) fail();
    const kind = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) fail();
    if (kind === 'fmt ') {
      if (format || length < 16) fail();
      const channels = bytes.readUInt16LE(start + 2);
      const rate = bytes.readUInt32LE(start + 4);
      const align = bytes.readUInt16LE(start + 12);
      if (
        bytes.readUInt16LE(start) !== 1 ||
        (channels !== 1 && channels !== 2) ||
        rate < 8000 ||
        rate > 192000 ||
        bytes.readUInt16LE(start + 14) !== 16 ||
        align !== channels * 2 ||
        bytes.readUInt32LE(start + 8) !== rate * align
      )
        fail();
      format = { rate, channels: channels as 1 | 2, align };
    }
    if (kind === 'data') {
      if (pcm) fail();
      pcm = bytes.subarray(start, start + length);
    }
    offset = start + length + (length % 2);
    if (offset > bytes.length) fail();
  }
  if (!format || !pcm || !pcm.length || pcm.length % format.align) return fail();
  return {
    sample_rate_hz: format.rate,
    channels: format.channels,
    sample_count: pcm.length / format.align,
    pcm,
  };
}

function waveBytes(wave: DemoPcmWave): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(wave.pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(wave.channels, 22);
  header.writeUInt32LE(wave.sample_rate_hz, 24);
  header.writeUInt32LE(wave.sample_rate_hz * wave.channels * 2, 28);
  header.writeUInt16LE(wave.channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(wave.pcm.length, 40);
  return Buffer.concat([header, wave.pcm]);
}

async function localFile(path: string, limit: number): Promise<string> {
  if (!isAbsolute(path) || (await lstat(path)).isSymbolicLink())
    throw new Error('DEMO_LOCAL_FILE_REQUIRED');
  const actual = await realpath(path);
  const details = await stat(actual);
  if (!details.isFile() || details.size < 1 || details.size > limit)
    throw new Error('DEMO_LOCAL_FILE_SIZE_INVALID');
  return actual;
}

const milliseconds = (samples: number, rate: number) => Math.round((samples * 1000) / rate);

/** Each WAV is a real recording/TTS output for exactly one confirmed slot.
 * Concatenating its PCM gives measured slot boundaries without guessed word timing.
 * Caller must fetch `plan` from ShotPlanAuthorityService, not accept a renderer DTO.
 */
export async function registerDemoSlotNarration(options: {
  plan: ConfirmedShotPlanV1;
  slot_audio: Array<{ slot_id: string; path: string }>;
  output_path: string;
  repository: Pick<NarrationAudioRepository, 'register'>;
}): Promise<{
  artifact: NarrationAudioArtifactV1;
  timing: NarrationTimingSnapshotV1;
  path: string;
}> {
  const plan = parseConfirmedShotPlanV1(options.plan);
  if (
    plan.slots.length < 2 ||
    plan.slots.length > 3 ||
    options.slot_audio.length !== plan.slots.length ||
    options.slot_audio.some((audio, index) => audio.slot_id !== plan.slots[index]?.slot_id)
  ) {
    throw new Error('DEMO_NARRATION_SLOT_BINDING_INVALID');
  }
  const waves: DemoPcmWave[] = [];
  for (const audio of options.slot_audio) {
    waves.push(parseDemoPcmWave(await readFile(await localFile(audio.path, 32 * 1024 * 1024))));
  }
  const first = waves[0]!;
  if (
    waves.some(
      (wave) => wave.sample_rate_hz !== first.sample_rate_hz || wave.channels !== first.channels,
    )
  ) {
    throw new Error('DEMO_NARRATION_FORMAT_MISMATCH');
  }
  const sampleCount = waves.reduce((total, wave) => total + wave.sample_count, 0);
  const duration = milliseconds(sampleCount, first.sample_rate_hz);
  if (duration < 15000 || duration > 30000)
    throw new Error('DEMO_NARRATION_DURATION_OUTSIDE_15_30_SECONDS');
  let cursor = 0;
  const slotTimings = waves.map((wave, index) => {
    const start = milliseconds(cursor, first.sample_rate_hz);
    cursor += wave.sample_count;
    return {
      slot_id: plan.slots[index]!.slot_id,
      start_ms: start,
      end_ms: milliseconds(cursor, first.sample_rate_hz),
    };
  });
  if (!isAbsolute(options.output_path)) throw new Error('DEMO_OUTPUT_PATH_INVALID');
  const output = resolve(options.output_path);
  const bytes = waveBytes({
    ...first,
    sample_count: sampleCount,
    pcm: Buffer.concat(waves.map((wave) => wave.pcm)),
  });
  // Exclusive creation preserves existing user files.
  await writeFile(output, bytes, { flag: 'wx' });
  const identity = randomUUID();
  const preimage = {
    schema_version: '1.0' as const,
    narration_audio_id: `demo_narration_${identity}`,
    artifact_id: `demo_pcm_${identity}`,
    artifact_sha256: await hashFile(output),
    duration_ms: duration,
    duration_measurement: 'SAMPLE_COUNT_DERIVED' as const,
    sample_count: sampleCount,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: first.sample_rate_hz,
    channels: first.channels,
    channel_layout: first.channels === 1 ? 'mono' : 'stereo',
    size_bytes: bytes.length,
    producer_ref: 'demo-local-per-slot-pcm-v1',
    provenance_ref: plan.shot_plan_hash,
  };
  const artifact = await options.repository.register({
    artifact: { ...preimage, artifact_hash: computeNarrationAudioArtifactHashV1(preimage) },
    trusted_local_path: output,
  });
  const timingPreimage = {
    schema_version: '1.0' as const,
    timing_snapshot_id: `demo_timing_${identity}`,
    timing_snapshot_version: 1,
    timing_kind: 'EXACT' as const,
    shot_plan_id: plan.shot_plan_id,
    shot_plan_hash: plan.shot_plan_hash,
    source_document_id: plan.source_document_id,
    source_document_hash: plan.source_document_hash,
    narration_audio_id: artifact.narration_audio_id,
    narration_audio_hash: artifact.artifact_sha256,
    total_duration_ms: duration,
    slot_timings: slotTimings,
    pause_intervals: [],
  };
  const timing = parseNarrationTimingSnapshotV1({
    ...timingPreimage,
    timing_snapshot_hash: computeNarrationTimingSnapshotHash(timingPreimage),
  });
  return { artifact, timing, path: output };
}

/** Commit only the result of a controlled worker job, after checking source and manifest bytes. */
export async function commitDemoWorkerManifest(options: {
  output_root: string;
  manifest_path: string;
  expected_manifest_sha256: string;
  source_path: string;
  repository: Pick<MediaIndexRepository, 'commitAssetRevision' | 'recordAssetLocation'>;
}): Promise<string> {
  const root = await realpath(options.output_root);
  const manifestPath = await localFile(options.manifest_path, 8 * 1024 * 1024);
  const within = relative(root, manifestPath);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
    throw new Error('DEMO_MANIFEST_PATH_ESCAPE');
  if ((await hashFile(manifestPath)) !== options.expected_manifest_sha256)
    throw new Error('DEMO_MANIFEST_HASH_MISMATCH');
  const manifest = assetRevisionManifestV1Schema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
  );
  const source = await localFile(options.source_path, Number.MAX_SAFE_INTEGER);
  if (
    (await realpath(manifest.artifact_root)) !== root ||
    (await realpath(manifest.source_path)) !== source ||
    (await hashFile(source)) !== manifest.file_hash
  )
    throw new Error('DEMO_MANIFEST_SOURCE_MISMATCH');
  const details = await stat(source, { bigint: true });
  if (details.size !== BigInt(manifest.size_bytes))
    throw new Error('DEMO_MANIFEST_SOURCE_MISMATCH');
  options.repository.commitAssetRevision({
    manifest,
    manifestSha256: options.expected_manifest_sha256,
  });
  options.repository.recordAssetLocation({
    assetId: manifest.asset_id,
    sourcePath: source,
    normalizedPath: source,
    sizeBytes: manifest.size_bytes,
    mtimeNs: String(details.mtimeNs),
  });
  return manifest.asset_id;
}
