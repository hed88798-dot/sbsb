import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

const DEFAULT_VIDEO_EXTENSIONS = new Set([
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.webm',
]);

export interface InventorySnapshot {
  normalizedPath: string;
  sizeBytes: number;
  mtimeNs: string;
  fileIdentity: string | null;
  fileHash?: string;
}

export interface KnownAssetSnapshot extends InventorySnapshot {
  assetId: string;
  fileHash: string;
  activeRevision: number | null;
  status: 'ACTIVE' | 'MISSING' | 'FAILED';
}

export type InventoryDecision =
  | { action: 'UNCHANGED'; assetId: string; item: InventorySnapshot }
  | { action: 'RELOCATED'; assetId: string; item: InventorySnapshot; fileHash: string }
  | { action: 'REBUILD'; assetId: string; item: InventorySnapshot; fileHash: string }
  | { action: 'NEW'; assetId: string; item: InventorySnapshot; fileHash: string }
  | { action: 'MISSING'; assetId: string; previous: KnownAssetSnapshot };

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function fileIdentity(stats: Awaited<ReturnType<typeof stat>>): string | null {
  const inode = Number(stats.ino);
  const device = Number(stats.dev);
  return inode > 0 ? `${device}:${inode}` : null;
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function inventoryFile(path: string): Promise<InventorySnapshot> {
  const stats = await stat(path, { bigint: true });
  return {
    normalizedPath: normalize(resolve(path)),
    sizeBytes: Number(stats.size),
    mtimeNs: stats.mtimeNs.toString(10),
    fileIdentity:
      stats.ino > 0n
        ? `${stats.dev.toString(10)}:${stats.ino.toString(10)}`
        : fileIdentity(await stat(path)),
  };
}

export async function scanVideoFolder(
  selectedRoot: string,
  options: { extensions?: ReadonlySet<string> } = {},
): Promise<InventorySnapshot[]> {
  const root = await realpath(selectedRoot);
  const extensions = options.extensions ?? DEFAULT_VIDEO_EXTENSIONS;
  const found: InventorySnapshot[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      const candidateStats = await lstat(candidate);
      if (candidateStats.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const resolved = await realpath(candidate);
        if (isInside(root, resolved)) await walk(resolved);
        continue;
      }
      if (!entry.isFile() || !extensions.has(extname(entry.name).toLowerCase())) continue;
      const resolved = await realpath(candidate);
      if (!isInside(root, resolved)) continue;
      found.push(await inventoryFile(resolved));
    }
  }

  await walk(root);
  return found.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));
}

function statsUnchanged(current: InventorySnapshot, previous: KnownAssetSnapshot): boolean {
  return (
    current.normalizedPath === previous.normalizedPath &&
    current.sizeBytes === previous.sizeBytes &&
    current.mtimeNs === previous.mtimeNs &&
    current.fileIdentity === previous.fileIdentity
  );
}

export async function reconcileInventory(
  current: InventorySnapshot[],
  previous: KnownAssetSnapshot[],
  fileHasher: (path: string) => Promise<string> = hashFile,
): Promise<InventoryDecision[]> {
  const previousByPath = new Map(previous.map((asset) => [asset.normalizedPath, asset]));
  const assetByHash = new Map(previous.map((asset) => [asset.fileHash, asset.assetId]));
  const seen = new Set<string>();
  const decisions: InventoryDecision[] = [];

  for (const item of current) {
    const samePath = previousByPath.get(item.normalizedPath);
    if (samePath && statsUnchanged(item, samePath)) {
      seen.add(samePath.assetId);
      decisions.push({ action: 'UNCHANGED', assetId: samePath.assetId, item });
      continue;
    }

    const fileHash = await fileHasher(item.normalizedPath);
    const sameContentAssetId = assetByHash.get(fileHash);
    if (sameContentAssetId) {
      seen.add(sameContentAssetId);
      decisions.push({ action: 'RELOCATED', assetId: sameContentAssetId, item, fileHash });
      continue;
    }
    if (samePath) {
      seen.add(samePath.assetId);
      decisions.push({ action: 'REBUILD', assetId: samePath.assetId, item, fileHash });
      continue;
    }
    const assetId = `asset_${randomUUID()}`;
    assetByHash.set(fileHash, assetId);
    decisions.push({ action: 'NEW', assetId, item, fileHash });
  }

  for (const asset of previous) {
    if (!seen.has(asset.assetId))
      decisions.push({ action: 'MISSING', assetId: asset.assetId, previous: asset });
  }
  return decisions;
}

export function shouldFollowDirectoryEntry(entry: Pick<Dirent, 'isSymbolicLink'>): boolean {
  return !entry.isSymbolicLink();
}
