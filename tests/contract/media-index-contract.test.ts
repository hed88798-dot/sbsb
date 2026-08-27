import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  KEYFRAME_POLICY_VERSION_V1,
  MEDIA_INDEX_SCHEMA_VERSION_V1,
  assetRevisionManifestV1Schema,
  mediaWorkerMethodV1Schema,
} from '../../packages/contracts/src/index.js';

describe('media index v1 public contract', () => {
  it('extends sidecar protocol 1.0 without removing Code A methods', () => {
    for (const method of [
      'hello',
      'ping',
      'echo',
      'progress',
      'cancel',
      'error',
      'media.index.asset.v1',
      'media.search.exact.v1',
    ]) {
      expect(mediaWorkerMethodV1Schema.safeParse(method).success).toBe(true);
    }
  });

  it('ships a strict JSON Schema 2020-12 manifest validator', () => {
    const root = resolve(import.meta.dirname, '../..');
    const schema = JSON.parse(
      readFileSync(
        resolve(root, 'schemas/media-index/v1/asset-revision-manifest.schema.json'),
        'utf8',
      ),
    ) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    expect(() => ajv.compile(schema)).not.toThrow();
    const searchSchema = JSON.parse(
      readFileSync(resolve(root, 'schemas/media-index/v1/shot-search.schema.json'), 'utf8'),
    ) as object;
    expect(() => ajv.compile(searchSchema)).not.toThrow();
    expect(MEDIA_INDEX_SCHEMA_VERSION_V1).toBe('1.0');
    expect(KEYFRAME_POLICY_VERSION_V1).toBe('safe-mid-best-v1');
    expect(assetRevisionManifestV1Schema.safeParse({}).success).toBe(false);
  });

  it('pins every official SigLIP 2 source file and validates the generated manifest schema', () => {
    const root = resolve(import.meta.dirname, '../..');
    const sourceLock = JSON.parse(
      readFileSync(
        resolve(
          root,
          'sidecars/media-worker/model-manifests/siglip2-base-patch32-256.source-lock.json',
        ),
        'utf8',
      ),
    ) as { source_revision: string; license: string; files: Record<string, { sha256: string }> };
    expect(sourceLock.source_revision).toMatch(/^[a-f0-9]{40}$/u);
    expect(sourceLock.license).toBe('Apache-2.0');
    expect(Object.keys(sourceLock.files)).toEqual(
      expect.arrayContaining(['model.safetensors', 'tokenizer.json', 'tokenizer.model']),
    );
    for (const file of Object.values(sourceLock.files))
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const modelManifestSchema = JSON.parse(
      readFileSync(
        resolve(root, 'sidecars/media-worker/model-manifests/MODEL_MANIFEST.schema.json'),
        'utf8',
      ),
    ) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateManifest = ajv.compile(modelManifestSchema);
    const checkedManifest = JSON.parse(
      readFileSync(
        resolve(
          root,
          'sidecars/media-worker/model-manifests/siglip2-base-patch32-256.onnx-fp32.manifest.json',
        ),
        'utf8',
      ),
    ) as object;
    expect(validateManifest(checkedManifest), JSON.stringify(validateManifest.errors)).toBe(true);
  });
});
