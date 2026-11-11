import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfirmedShotPlanV1 } from '../../packages/contracts/src/index.js';
import { computeConfirmedShotPlanHash } from '../../packages/timeline/src/index.js';
import { parseNarrationAudioArtifactV1 } from '../../packages/render/src/index.js';
import {
  commitDemoWorkerManifest,
  parseDemoPcmWave,
  registerDemoSlotNarration,
} from '../../apps/desktop/src/main/demo-local-media.js';

// Synthetic PCM fixtures verify byte accounting only, never real Demo acceptance.
function wave(seconds: number, rate = 8000): Buffer {
  const pcm = Buffer.alloc(seconds * rate * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF');
  head.writeUInt32LE(pcm.length + 36, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}
function plan(): ConfirmedShotPlanV1 {
  const preimage = {
    schema_version: '1.0' as const,
    shot_plan_id: 'plan',
    shot_plan_version: 1,
    source_document_id: 'source',
    source_document_version: 1,
    source_document_hash: 'a'.repeat(64),
    review_state: 'CONFIRMED' as const,
    source_offset_unit: 'UNICODE_CODE_POINT' as const,
    slots: ['one', 'two'].map((id, index) => ({
      slot_id: id,
      order_index: index,
      source_start: index,
      source_end: index + 1,
      source_text: id,
      route: 'ANIMAL' as const,
      visual_continuity_group_id: id,
    })),
  };
  return { ...preimage, shot_plan_hash: computeConfirmedShotPlanHash(preimage) };
}
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Demo local PCM narration', () => {
  it('rejects changed or escaped worker manifests before database mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'demo-manifest-test-'));
    directories.push(root);
    const manifest = join(root, 'manifest.json');
    await writeFile(manifest, '{}');
    let writes = 0;
    const repository = {
      commitAssetRevision: () => {
        writes++;
      },
      recordAssetLocation: () => {
        writes++;
      },
    };
    await expect(
      commitDemoWorkerManifest({
        output_root: root,
        manifest_path: manifest,
        expected_manifest_sha256: 'a'.repeat(64),
        source_path: manifest,
        repository,
      }),
    ).rejects.toThrow('DEMO_MANIFEST_HASH_MISMATCH');
    const otherRoot = await mkdtemp(join(tmpdir(), 'demo-manifest-outside-'));
    directories.push(otherRoot);
    await expect(
      commitDemoWorkerManifest({
        output_root: otherRoot,
        manifest_path: manifest,
        expected_manifest_sha256: 'a'.repeat(64),
        source_path: manifest,
        repository,
      }),
    ).rejects.toThrow('DEMO_MANIFEST_PATH_ESCAPE');
    expect(writes).toBe(0);
  });
  it('measures samples and rejects truncated/compressed/partial-frame WAVs', () => {
    expect(parseDemoPcmWave(wave(8))).toMatchObject({
      sample_count: 64000,
      sample_rate_hz: 8000,
      channels: 1,
    });
    expect(() => parseDemoPcmWave(wave(8).subarray(0, 80))).toThrow(
      'DEMO_NARRATION_PCM16_WAV_REQUIRED',
    );
    const compressed = wave(8);
    compressed.writeUInt16LE(3, 20);
    expect(() => parseDemoPcmWave(compressed)).toThrow('DEMO_NARRATION_PCM16_WAV_REQUIRED');
    const badRate = wave(8);
    badRate.writeUInt32LE(0, 24);
    expect(() => parseDemoPcmWave(badRate)).toThrow('DEMO_NARRATION_PCM16_WAV_REQUIRED');
  });
  it('registers exact concatenated sample evidence bound to confirmed slots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'demo-audio-test-'));
    directories.push(root);
    const first = join(root, 'one.wav');
    const second = join(root, 'two.wav');
    await writeFile(first, wave(8));
    await writeFile(second, wave(9));
    let registrations = 0;
    const repository = {
      register: async (input: {
        artifact: Parameters<typeof parseNarrationAudioArtifactV1>[0];
      }) => {
        registrations++;
        return parseNarrationAudioArtifactV1(input.artifact);
      },
    };
    const options = {
      plan: plan(),
      slot_audio: [
        { slot_id: 'one', path: first },
        { slot_id: 'two', path: second },
      ],
      output_path: join(root, 'combined.wav'),
      repository,
    };
    const result = await registerDemoSlotNarration(options);
    expect(registrations).toBe(1);
    expect(result.artifact).toMatchObject({
      sample_count: 136000,
      duration_ms: 17000,
      duration_measurement: 'SAMPLE_COUNT_DERIVED',
    });
    expect(result.timing.slot_timings).toEqual([
      { slot_id: 'one', start_ms: 0, end_ms: 8000 },
      { slot_id: 'two', start_ms: 8000, end_ms: 17000 },
    ]);
    expect(parseDemoPcmWave(await readFile(result.path)).sample_count).toBe(136000);
    await expect(registerDemoSlotNarration(options)).rejects.toThrow('EEXIST');
    const stale = { ...plan(), shot_plan_hash: 'b'.repeat(64) };
    await expect(registerDemoSlotNarration({ ...options, plan: stale })).rejects.toThrow(
      'CONFIRMED_SHOT_PLAN_HASH_MISMATCH',
    );
    await expect(
      registerDemoSlotNarration({
        ...options,
        slot_audio: [options.slot_audio[1]!, options.slot_audio[0]!],
      }),
    ).rejects.toThrow('DEMO_NARRATION_SLOT_BINDING_INVALID');
    expect(registrations).toBe(1);
  });
});
