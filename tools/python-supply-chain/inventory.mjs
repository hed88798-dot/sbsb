import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(toolDirectory, '../..');
export const inventorySchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/python-artifact-inventory/v1/inventory.schema.json',
);
export const packagedSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/python-artifact-inventory/v1/packaged-native-inventory.schema.json',
);
export const scopeOrder = [
  'PRODUCTION_WORKER_RUNTIME',
  'WORKER_BUILD',
  'MODEL_EXPORT',
  'MODEL_EVALUATION',
];
const nativePattern = /(?:\.pyd|\.dll|\.dylib|\.so(?:\.|$))/iu;

export function normalizePythonName(value) {
  return value.toLowerCase().replaceAll(/[-_.]+/gu, '-');
}

export function pythonPurl(name, version) {
  return `pkg:pypi/${normalizePythonName(name)}@${version}`;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export async function sha256File(path) {
  const digest = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return digest.digest('hex');
}

function validatorFor(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

const validateInventorySchema = validatorFor(inventorySchemaPath);
const validatePackagedSchema = validatorFor(packagedSchemaPath);

function schemaErrors(validator) {
  return (validator.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function safeArtifactPath(root, value) {
  if (isAbsolute(value) || basename(value) === '')
    throw new Error(`unsafe artifact path: ${value}`);
  const requested = resolve(root, value);
  const fromRoot = relative(root, requested);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`artifact path escapes root: ${value}`);
  }
  return requested;
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

export function discoverInventoryPaths(root = repositoryRoot) {
  const directory = resolve(root, 'compliance/python-artifacts');
  return walkFiles(directory)
    .filter((path) => path.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
}

function validateSemanticInventory(document, sourcePath) {
  const failures = [];
  const byPurl = new Map();
  const artifactPaths = new Set();
  const artifactHashes = new Set();
  for (const artifact of document.packages) {
    const prefix = `${sourcePath}:${artifact.package_name}@${artifact.version}`;
    const expectedPurl = pythonPurl(artifact.package_name, artifact.version);
    if (artifact.purl !== expectedPurl) failures.push(`${prefix}: purl must be ${expectedPurl}`);
    if (artifact.python_version !== document.target.python_version)
      failures.push(`${prefix}: python_version differs from target`);
    if (artifact.python_tag !== document.target.python_tag)
      failures.push(`${prefix}: python_tag differs from target`);
    if (artifact.abi_tag !== document.target.abi_tag)
      failures.push(`${prefix}: abi_tag differs from target`);
    if (artifact.platform_tag !== document.target.platform_tag)
      failures.push(`${prefix}: platform_tag differs from target`);
    if (byPurl.has(artifact.purl)) failures.push(`${prefix}: duplicate purl`);
    byPurl.set(artifact.purl, artifact);
    if (artifactPaths.has(artifact.artifact_path))
      failures.push(`${prefix}: duplicate artifact_path`);
    artifactPaths.add(artifact.artifact_path);
    if (artifactHashes.has(artifact.sha256)) failures.push(`${prefix}: duplicate artifact hash`);
    artifactHashes.add(artifact.sha256);
    if (artifact.artifact_type !== 'wheel') {
      failures.push(`${prefix}: artifact_type ${artifact.artifact_type} is rejected by v1`);
    }
    if (!artifact.filename.endsWith('.whl') || !artifact.provenance.download_url.includes('.whl')) {
      failures.push(`${prefix}: approved artifact must be an exact wheel URL and filename`);
    }
    const expectedWheelTags = `-${artifact.python_tag}-${artifact.abi_tag}-${artifact.platform_tag}.whl`;
    if (!artifact.filename.endsWith(expectedWheelTags)) {
      failures.push(`${prefix}: wheel filename does not match target tags ${expectedWheelTags}`);
    }
    if (/latest|git\+|\/refs\/heads\//iu.test(artifact.provenance.download_url)) {
      failures.push(`${prefix}: floating/VCS artifact URL is rejected`);
    }
    if (
      document.scope === 'PRODUCTION_WORKER_RUNTIME' &&
      ['torch', 'transformers'].includes(normalizePythonName(artifact.package_name))
    ) {
      failures.push(`${prefix}: ${artifact.package_name} is forbidden in production worker scope`);
    }
    for (const native of artifact.native_artifacts) {
      if (
        normalizePythonName(native.source_package) !== normalizePythonName(artifact.package_name)
      ) {
        failures.push(`${prefix}: native owner mismatch for ${native.relative_path}`);
      }
    }
    const includedDeclarations = new Set();
    for (const declaration of artifact.dependency_declarations) {
      if (declaration.disposition === 'INCLUDED') {
        if (!declaration.purl) failures.push(`${prefix}: included dependency has no purl`);
        else includedDeclarations.add(declaration.purl);
        if (declaration.reason)
          failures.push(`${prefix}: included dependency reason must be empty`);
      } else {
        if (declaration.purl !== null) {
          failures.push(`${prefix}: not-applicable dependency purl must be null`);
        }
        if (!declaration.reason.trim()) {
          failures.push(`${prefix}: not-applicable dependency requires a review reason`);
        }
      }
    }
    const dependencySet = new Set(artifact.dependencies);
    if (
      dependencySet.size !== includedDeclarations.size ||
      [...dependencySet].some((dependency) => !includedDeclarations.has(dependency))
    ) {
      failures.push(`${prefix}: dependencies differ from INCLUDED METADATA declarations`);
    }
  }
  for (const artifact of document.packages) {
    for (const dependency of artifact.dependencies) {
      if (!byPurl.has(dependency)) {
        failures.push(
          `${sourcePath}:${artifact.purl}: dependency missing from complete graph: ${dependency}`,
        );
      }
    }
  }
  const reachable = new Set();
  const pending = document.packages
    .filter((artifact) => artifact.direct)
    .map((artifact) => artifact.purl);
  while (pending.length > 0) {
    const purl = pending.shift();
    if (!purl || reachable.has(purl)) continue;
    reachable.add(purl);
    pending.push(...(byPurl.get(purl)?.dependencies ?? []));
  }
  for (const artifact of document.packages) {
    if (!reachable.has(artifact.purl)) {
      failures.push(
        `${sourcePath}:${artifact.purl}: package is unreachable from direct dependencies`,
      );
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

export function loadInventories(paths = discoverInventoryPaths()) {
  const inventoryPaths = [...new Set(paths.map((path) => resolve(path)))].sort();
  const loaded = inventoryPaths.map((path) => {
    const document = JSON.parse(readFileSync(path, 'utf8'));
    if (!validateInventorySchema(document)) {
      throw new Error(
        `${path}: inventory schema invalid: ${schemaErrors(validateInventorySchema)}`,
      );
    }
    validateSemanticInventory(document, path);
    return { path, document };
  });
  const ids = new Set();
  for (const item of loaded) {
    if (ids.has(item.document.inventory_id)) {
      throw new Error(`duplicate inventory_id: ${item.document.inventory_id}`);
    }
    ids.add(item.document.inventory_id);
  }
  return loaded;
}

export function inspectWheel(path, pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python3') {
  const result = spawnSync(pythonExecutable, [resolve(toolDirectory, 'inspect-wheel.py'), path], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr.trim() || `wheel inspection failed: ${path}`);
  }
  return JSON.parse(result.stdout);
}

function compareDeclaredFiles(expected, actual, label) {
  const expectedMap = new Map(expected.map((entry) => [entry.relative_path, entry]));
  const actualMap = new Map(actual.map((entry) => [entry.relative_path, entry]));
  const failures = [];
  for (const [path, entry] of expectedMap) {
    const found = actualMap.get(path);
    if (!found) failures.push(`${label}: declared file missing: ${path}`);
    else if (found.sha256 !== entry.sha256)
      failures.push(`${label}: declared file hash mismatch: ${path}`);
  }
  for (const path of actualMap.keys()) {
    if (!expectedMap.has(path)) failures.push(`${label}: undeclared file: ${path}`);
  }
  return failures;
}

export async function verifyArtifactInventories(loaded, artifactRoot) {
  const root = resolve(artifactRoot);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Python artifact root is missing: ${root}`);
  }
  const expectedWheelPaths = new Set();
  const results = [];
  const failures = [];
  for (const { document, path: inventoryPath } of loaded) {
    for (const artifact of document.packages) {
      const wheelPath = safeArtifactPath(root, artifact.artifact_path);
      expectedWheelPaths.add(wheelPath);
      const label = `${inventoryPath}:${artifact.package_name}@${artifact.version}`;
      if (!statSync(wheelPath, { throwIfNoEntry: false })?.isFile()) {
        failures.push(`${label}: wheel missing: ${artifact.artifact_path}`);
        continue;
      }
      const actualHash = await sha256File(wheelPath);
      if (actualHash !== artifact.sha256) {
        failures.push(
          `${label}: wheel hash mismatch: expected ${artifact.sha256}, got ${actualHash}`,
        );
        continue;
      }
      let inspected;
      try {
        inspected = inspectWheel(wheelPath);
      } catch (error) {
        failures.push(`${label}: ${error.message}`);
        continue;
      }
      if (
        normalizePythonName(inspected.package_name) !== normalizePythonName(artifact.package_name)
      )
        failures.push(`${label}: wheel METADATA package name mismatch: ${inspected.package_name}`);
      if (inspected.version !== artifact.version)
        failures.push(`${label}: wheel METADATA version mismatch: ${inspected.version}`);
      if (inspected.filename !== artifact.filename)
        failures.push(`${label}: wheel filename mismatch: ${inspected.filename}`);
      failures.push(
        ...compareDeclaredFiles(artifact.license_files, inspected.license_files, label),
      );
      failures.push(
        ...compareDeclaredFiles(artifact.native_artifacts, inspected.native_artifacts, label),
      );
      const expectedRequirements = new Set(
        artifact.dependency_declarations.map((entry) => entry.requirement),
      );
      const actualRequirements = new Set(inspected.requires_dist_raw);
      for (const requirement of expectedRequirements) {
        if (!actualRequirements.has(requirement)) {
          failures.push(`${label}: declared Requires-Dist missing from wheel: ${requirement}`);
        }
      }
      for (const requirement of actualRequirements) {
        if (!expectedRequirements.has(requirement)) {
          failures.push(`${label}: undeclared Requires-Dist in wheel: ${requirement}`);
        }
      }
      results.push({ inventory: document, artifact, wheelPath, inspected });
    }
  }
  for (const wheelPath of walkFiles(root).filter((path) => path.toLowerCase().endsWith('.whl'))) {
    if (!expectedWheelPaths.has(wheelPath)) {
      failures.push(`undeclared wheel in artifact root: ${relative(root, wheelPath)}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return results;
}

export function validatePackagedInventory(document) {
  if (!validatePackagedSchema(document)) {
    throw new Error(
      `packaged native inventory schema invalid: ${schemaErrors(validatePackagedSchema)}`,
    );
  }
  return document;
}

export function nativeType(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.pyd')) return 'pyd';
  if (lower.endsWith('.dll')) return 'dll';
  if (lower.endsWith('.dylib')) return 'dylib';
  if (lower.endsWith('.so') || lower.includes('.so.')) return 'so';
  return 'other';
}

export function listNativeFiles(root) {
  return walkFiles(resolve(root))
    .filter((path) => nativePattern.test(basename(path)))
    .sort((left, right) => left.localeCompare(right));
}

export function dependencyPaths(inventory, targetPurl) {
  const byPurl = new Map(inventory.packages.map((artifact) => [artifact.purl, artifact]));
  const paths = [];
  const pending = inventory.packages
    .filter((artifact) => artifact.direct)
    .map((artifact) => [artifact.purl]);
  while (pending.length > 0) {
    const path = pending.shift();
    const current = path.at(-1);
    if (current === targetPurl) paths.push(path);
    if (!current || path.length > inventory.packages.length) continue;
    for (const dependency of byPurl.get(current)?.dependencies ?? []) {
      if (!path.includes(dependency)) pending.push([...path, dependency]);
    }
  }
  return paths;
}
