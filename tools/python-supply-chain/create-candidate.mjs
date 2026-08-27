import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import {
  canonicalJson,
  inspectWheel,
  normalizePythonName,
  pythonPurl,
  sha256File,
} from './inventory.mjs';

function parse(values) {
  const options = { direct: [] };
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const value = values[++index];
    if (!value) throw new Error(`${key} requires a value`);
    if (key === '--direct') options.direct.push(normalizePythonName(value));
    else if (key === '--artifact-root') options.artifactRoot = value;
    else if (key === '--scope') options.scope = value;
    else if (key === '--python-version') options.pythonVersion = value;
    else if (key === '--python-tag') options.pythonTag = value;
    else if (key === '--abi-tag') options.abiTag = value;
    else if (key === '--platform-tag') options.platformTag = value;
    else if (key === '--inventory-id') options.inventoryId = value;
    else if (key === '--source-index') options.sourceIndex = value;
    else if (key === '--source-base') options.sourceBase = value;
    else if (key === '--download-base') options.downloadBase = value;
    else if (key === '--supplier') options.supplier = value;
    else if (key === '--output') options.output = value;
    else throw new Error(`unknown argument: ${key}`);
  }
  const required = [
    'artifactRoot',
    'scope',
    'pythonVersion',
    'pythonTag',
    'abiTag',
    'platformTag',
    'inventoryId',
    'sourceIndex',
    'sourceBase',
    'downloadBase',
    'supplier',
    'output',
  ];
  for (const key of required) if (!options[key]) throw new Error(`--${key} is required`);
  if (options.direct.length === 0) throw new Error('at least one --direct package is required');
  return options;
}

function wheelFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return wheelFiles(path);
    return entry.isFile() && entry.name.endsWith('.whl') ? [path] : [];
  });
}

async function main() {
  const options = parse(process.argv.slice(2));
  const artifactRoot = resolve(options.artifactRoot);
  const inspected = wheelFiles(artifactRoot)
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ path, metadata: inspectWheel(path) }));
  if (inspected.length === 0) throw new Error('candidate generation found no wheels');
  const known = new Map(
    inspected.map(({ metadata }) => [
      normalizePythonName(metadata.package_name),
      pythonPurl(metadata.package_name, metadata.version),
    ]),
  );
  const packages = [];
  for (const { path, metadata } of inspected) {
    const normalized = normalizePythonName(metadata.package_name);
    packages.push({
      package_name: metadata.package_name,
      version: metadata.version,
      artifact_type: 'wheel',
      filename: basename(path),
      artifact_path: relative(artifactRoot, path).replaceAll('\\', '/'),
      sha256: await sha256File(path),
      source: `${options.sourceBase.replace(/\/$/u, '')}/${normalized}`,
      source_index: options.sourceIndex,
      python_version: options.pythonVersion,
      python_tag: options.pythonTag,
      abi_tag: options.abiTag,
      platform_tag: options.platformTag,
      purl: pythonPurl(metadata.package_name, metadata.version),
      license_expression: metadata.license_expression ?? metadata.legacy_license ?? 'UNKNOWN',
      license_files: metadata.license_files.map(({ relative_path, sha256 }) => ({
        relative_path,
        sha256,
      })),
      native_artifacts: metadata.native_artifacts.map((native) => ({
        filename: native.filename,
        relative_path: native.relative_path,
        packaged_relative_path: `REVIEW_REQUIRED/${native.filename}`,
        sha256: native.sha256,
        type: native.type,
        source_package: metadata.package_name,
      })),
      provenance: {
        supplier: options.supplier,
        download_url: `${options.downloadBase.replace(/\/$/u, '')}/${basename(path)}`,
        review_status: 'PENDING',
        reviewed_at: new Date().toISOString(),
        upstream_signature: null,
        notes: 'Generated candidate; owner and Code F must review every field before approval.',
      },
      direct: options.direct.includes(normalized),
      dependencies: metadata.requires_dist.map(
        (name) => known.get(normalizePythonName(name)) ?? `REVIEW_REQUIRED:${name}`,
      ),
      dependency_declarations: metadata.requires_dist_raw.map((requirement) => {
        const packageName = requirement.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/u)?.[1];
        const purl = packageName ? known.get(normalizePythonName(packageName)) : null;
        return {
          requirement,
          package_name: packageName ?? 'REVIEW_REQUIRED',
          disposition: purl ? 'INCLUDED' : 'NOT_APPLICABLE',
          purl,
          reason: purl ? '' : 'REVIEW_REQUIRED',
        };
      }),
    });
  }
  const candidate = {
    schema_version: '1',
    inventory_id: options.inventoryId,
    scope: options.scope,
    target: {
      python_version: options.pythonVersion,
      python_tag: options.pythonTag,
      abi_tag: options.abiTag,
      platform_tag: options.platformTag,
    },
    graph_complete: false,
    packages,
  };
  const output = resolve(options.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, canonicalJson(candidate));
  console.log(
    `python-inventory-candidate: CREATED (${packages.length} wheels; PENDING and intentionally not CI-acceptable)`,
  );
}

main().catch((error) => {
  console.error(`python-inventory-candidate: FAIL\n${error.message}`);
  process.exitCode = 1;
});
