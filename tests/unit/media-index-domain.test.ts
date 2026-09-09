import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VisualDescriptorV1 } from '@app/contracts';
import {
  createIndexSignature,
  enforceConservativeTemporalEvidence,
  hashFile,
  MediaIndexJobControl,
  reconcileInventory,
  scanVideoFolder,
  selectQuartileKeyframes,
  selectSafeMidBestKeyframes,
} from '../../packages/domain-media-index/src/index.js';

describe('media inventory', () => {
  it('does not cross symlinks and reconciles unchanged, moved, changed, and missing files', async () => {
    const root = await mkdtemp(join(tmpdir(), '媒体 索引 '));
    const outside = await mkdtemp(join(tmpdir(), 'media-outside-'));
    try {
      mkdirSync(join(root, '中文 子目录'));
      const unchangedPath = join(root, '中文 子目录', '未变化.mp4');
      const changedPath = join(root, 'changed.mp4');
      const movedPath = join(root, 'moved name.mp4');
      writeFileSync(unchangedPath, 'same-content');
      writeFileSync(changedPath, 'new-content');
      writeFileSync(movedPath, 'moved-content');
      writeFileSync(join(outside, 'outside.mp4'), 'must-not-scan');
      symlinkSync(outside, join(root, 'escape-link'));
      const inventory = await scanVideoFolder(root);
      expect(inventory.map((item) => item.normalizedPath)).not.toContain(
        join(outside, 'outside.mp4'),
      );
      const unchanged = inventory.find(
        (item) => item.normalizedPath === realpathSync(unchangedPath),
      )!;
      const changed = inventory.find((item) => item.normalizedPath === realpathSync(changedPath))!;
      const moved = inventory.find((item) => item.normalizedPath === realpathSync(movedPath))!;
      let hashCalls = 0;
      const decisions = await reconcileInventory(
        inventory,
        [
          {
            ...unchanged,
            assetId: 'asset_unchanged',
            fileHash: await hashFile(unchangedPath),
            activeRevision: 1,
            status: 'ACTIVE',
          },
          {
            ...changed,
            sizeBytes: changed.sizeBytes - 1,
            assetId: 'asset_changed',
            fileHash: '0'.repeat(64),
            activeRevision: 1,
            status: 'ACTIVE',
          },
          {
            ...moved,
            normalizedPath: join(root, 'old-name.mp4'),
            assetId: 'asset_moved',
            fileHash: await hashFile(movedPath),
            activeRevision: 1,
            status: 'ACTIVE',
          },
          {
            ...moved,
            normalizedPath: join(root, 'missing.mp4'),
            assetId: 'asset_missing',
            fileHash: 'f'.repeat(64),
            activeRevision: 1,
            status: 'ACTIVE',
          },
        ],
        async (path) => {
          hashCalls += 1;
          return hashFile(path);
        },
      );
      expect(hashCalls).toBe(2);
      expect(decisions.map((decision) => decision.action)).toEqual([
        'REBUILD',
        'RELOCATED',
        'UNCHANGED',
        'MISSING',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('deduplicates two new locations with the same content hash into one Asset identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-duplicates-'));
    try {
      writeFileSync(join(root, 'duplicate-a.mp4'), 'identical');
      writeFileSync(join(root, 'duplicate-b.mp4'), 'identical');
      const decisions = await reconcileInventory(await scanVideoFolder(root), []);
      expect(decisions.map((decision) => decision.action)).toEqual(['NEW', 'RELOCATED']);
      expect(decisions[0]?.assetId).toBe(decisions[1]?.assetId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rehashes changed stats but performs zero analysis when content SHA-256 is unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-mtime-'));
    try {
      const path = join(root, 'mtime-only.mp4');
      writeFileSync(path, 'same-content');
      const [item] = await scanVideoFolder(root);
      const fileHash = await hashFile(path);
      const decisions = await reconcileInventory(
        [item!],
        [
          {
            ...item!,
            mtimeNs: '1',
            assetId: 'asset_same_hash',
            fileHash,
            activeRevision: 1,
            status: 'ACTIVE',
          },
        ],
      );
      expect(decisions).toMatchObject([
        { action: 'RELOCATED', assetId: 'asset_same_hash', fileHash },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('keyframe policy', () => {
  it('implements and differentiates the two documented candidates', () => {
    expect(selectQuartileKeyframes(0, 10_000)).toEqual([2500, 5000, 7500]);
    expect(
      selectSafeMidBestKeyframes(0, 10_000, [
        { timestampMs: 7500, qualityScore: 0.3 },
        { timestampMs: 9000, qualityScore: 0.95 },
      ]),
    ).toEqual([
      { role: 'SAFE_EARLY', timestampMs: 500 },
      { role: 'MIDPOINT', timestampMs: 5000 },
      { role: 'BEST_QUALITY', timestampMs: 9000 },
    ]);
  });
});

describe('descriptor evidence', () => {
  it('removes motion-sensitive claims without temporal evidence', () => {
    const descriptor: VisualDescriptorV1 = {
      schema_version: '1.0',
      shot_id: 'shot_motion',
      species: ['pig'],
      scene: 'farm',
      action: ['coughing', 'walking'],
      health_state: 'abnormal',
      people_present: null,
      product_present: null,
      shot_type: 'medium',
      description: '',
      quality: { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 },
      embedding_ref: 'embedding_motion',
      industry_metadata: { veterinary: {} },
      confidence: { action: 0.99, health_state: 0.9 },
      provenance: { vlm: 'OFF' },
      evidence: {},
    };
    const guarded = enforceConservativeTemporalEvidence(descriptor);
    expect(guarded.action).toEqual(['walking']);
    expect(guarded.health_state).toBe('unknown');
    expect(guarded.evidence.motion_sensitive_guard?.temporal_evidence).toBe('INSUFFICIENT');
  });

  it('never promotes a health state without explicit thresholded evidence', () => {
    const descriptor: VisualDescriptorV1 = {
      schema_version: '1.0',
      shot_id: 'shot_health',
      species: 'unknown',
      scene: 'unknown',
      action: 'unknown',
      health_state: 'abnormal',
      people_present: null,
      product_present: null,
      shot_type: 'unknown',
      description: '',
      quality: { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 },
      embedding_ref: 'embedding_health',
      industry_metadata: { veterinary: {} },
      confidence: { health_state: 0.99 },
      provenance: { vlm: 'OFF' },
      evidence: {},
    };
    expect(enforceConservativeTemporalEvidence(descriptor).health_state).toBe('unknown');
  });
});

describe('index signature', () => {
  it('is deterministic and binds keyframe policy and file hash', () => {
    const input = {
      index_schema_version: '1.0' as const,
      index_signature_version: '1.0' as const,
      embedding_model: 'google/siglip2-base-patch32-256',
      embedding_model_version: 'official-revision',
      embedding_preprocess_version: 'preprocess-v1',
      vlm_model: null,
      vlm_model_version: null,
      vlm_prompt_version: null,
      shot_detector: 'PySceneDetect.AdaptiveDetector',
      shot_detector_version: '0.7.1',
      shot_detector_params_hash: '1'.repeat(64),
      keyframe_policy_version: 'safe-mid-best-v1',
      file_hash: '2'.repeat(64),
    };
    expect(createIndexSignature(input).hash).toBe(createIndexSignature({ ...input }).hash);
    expect(createIndexSignature({ ...input, file_hash: '3'.repeat(64) }).hash).not.toBe(
      createIndexSignature(input).hash,
    );
  });
});

describe('background job control', () => {
  it('exposes bounded pause, resume, and cancel markers without a second service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-job-control-'));
    try {
      const control = new MediaIndexJobControl(root);
      await control.pause();
      expect(existsSync(control.pauseFile)).toBe(true);
      await control.resume();
      expect(existsSync(control.pauseFile)).toBe(false);
      await control.cancel();
      expect(existsSync(control.cancelFile)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
