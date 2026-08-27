import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  assetRevisionManifestV1Schema,
  mediaArtifactResultV1Schema,
  type AssetRevisionManifestV1,
  type MediaArtifactResultV1,
} from '@app/contracts';
import { sha256 } from './signature.js';

export async function verifyAssetRevisionArtifact(options: {
  result: MediaArtifactResultV1;
  jobOutputDirectory: string;
}): Promise<{ manifest: AssetRevisionManifestV1; manifestSha256: string }> {
  const result = mediaArtifactResultV1Schema.parse(options.result);
  const outputRoot = await realpath(resolve(options.jobOutputDirectory));
  const requestedManifestPath = resolve(result.manifest_path);
  if ((await lstat(requestedManifestPath)).isSymbolicLink())
    throw new Error('MEDIA_MANIFEST_PATH_INVALID');
  const manifestPath = await realpath(requestedManifestPath);
  const fromRoot = relative(outputRoot, manifestPath);
  if (
    !isAbsolute(outputRoot) ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot) ||
    basename(manifestPath) !== 'asset-revision-manifest.json'
  ) {
    throw new Error('MEDIA_MANIFEST_PATH_INVALID');
  }
  const payload = await readFile(manifestPath);
  if (sha256(payload) !== result.manifest_sha256) throw new Error('MEDIA_MANIFEST_HASH_MISMATCH');
  const manifest = assetRevisionManifestV1Schema.parse(
    JSON.parse(payload.toString('utf8')) as unknown,
  );
  if (
    (await realpath(resolve(manifest.artifact_root))) !== outputRoot ||
    manifest.index_signature_hash !== result.index_signature_hash
  ) {
    throw new Error('MEDIA_MANIFEST_BINDING_MISMATCH');
  }
  return { manifest, manifestSha256: result.manifest_sha256 };
}
