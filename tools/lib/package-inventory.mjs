import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function manifestLicense(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim()) {
    return manifest.license.trim();
  }
  if (Array.isArray(manifest.licenses)) {
    const licenses = manifest.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter((entry) => typeof entry === 'string' && entry.trim());
    if (licenses.length > 0) return licenses.join(' OR ');
  }
  return 'UNKNOWN';
}

function packageManifests(nodeModulesDirectory) {
  const manifests = [];
  let entries;
  try {
    entries = readdirSync(nodeModulesDirectory, { withFileTypes: true });
  } catch {
    return manifests;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('@')) {
      const scopeDirectory = join(nodeModulesDirectory, entry.name);
      for (const scopedEntry of readdirSync(scopeDirectory, { withFileTypes: true })) {
        if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
        manifests.push(join(scopeDirectory, scopedEntry.name, 'package.json'));
      }
      continue;
    }
    manifests.push(join(nodeModulesDirectory, entry.name, 'package.json'));
  }
  return manifests;
}

export function collectPnpmInventory(repositoryRoot) {
  const virtualStore = join(repositoryRoot, 'node_modules', '.pnpm');
  let storeEntries;
  try {
    storeEntries = readdirSync(virtualStore, { withFileTypes: true });
  } catch {
    throw new Error('node_modules/.pnpm is missing; run the frozen-lockfile install first');
  }

  const packages = new Map();
  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory() || storeEntry.name === 'node_modules') continue;
    const nodeModulesDirectory = join(virtualStore, storeEntry.name, 'node_modules');
    for (const manifestPath of packageManifests(nodeModulesDirectory)) {
      const manifest = readManifest(manifestPath);
      if (!manifest || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
        continue;
      }
      const key = `${manifest.name}@${manifest.version}`;
      if (!packages.has(key)) {
        packages.set(key, {
          name: manifest.name,
          version: manifest.version,
          license: manifestLicense(manifest),
          internal: manifest.private === true && manifest.name.startsWith('@app/'),
          manifestPath,
        });
      }
    }
  }

  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

export function collectArtifactNodeInventory(artifactRoot) {
  const packages = new Map();

  function walk(directory, insideNodeModules = false) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      const nowInsideNodeModules = insideNodeModules || entry.name === 'node_modules';
      if (nowInsideNodeModules && entry.name !== 'node_modules' && !entry.name.startsWith('@')) {
        const manifestPath = join(path, 'package.json');
        const manifest = readManifest(manifestPath);
        if (manifest && typeof manifest.name === 'string' && typeof manifest.version === 'string') {
          const key = `${manifest.name}@${manifest.version}`;
          if (!packages.has(key)) {
            packages.set(key, {
              name: manifest.name,
              version: manifest.version,
              license: manifestLicense(manifest),
              internal: manifest.private === true && manifest.name.startsWith('@app/'),
              manifestPath,
            });
          }
        }
      }
      walk(path, nowInsideNodeModules);
    }
  }

  walk(artifactRoot);
  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

export function npmPackageUrl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}
