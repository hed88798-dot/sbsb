import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type RuntimeCompanionPlatform = 'linux' | 'windows';

/**
 * The desktop package owns the runtime layout; the Worker remains an
 * immutable artifact and receives this path through its existing payload.
 * No PATH lookup or filesystem discovery is allowed here.
 */
export const FFPROBE_LOCATORS: Record<RuntimeCompanionPlatform, string> = {
  linux: 'runtime/ffprobe/linux/bundle/ffprobe',
  windows: 'runtime/ffprobe/windows/bundle/ffprobe.exe',
};

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function resolveBundledFfprobe(options: {
  resourcesRoot: string;
  platform: RuntimeCompanionPlatform;
  expectedSha256?: string;
}): string {
  const root = resolve(options.resourcesRoot);
  const locator = FFPROBE_LOCATORS[options.platform];
  const path = resolve(root, locator);
  const relativePath = relative(root, path);
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('FFPROBE_LOCATOR_ESCAPES_RESOURCES_ROOT');
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('FFPROBE_LOCATOR_MUST_REFERENCE_REGULAR_FILE');
  }
  if (options.expectedSha256 && sha256File(path) !== options.expectedSha256) {
    throw new Error('FFPROBE_LOCATOR_SHA256_MISMATCH');
  }
  return path;
}
