import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { repositoryRoot, sha256File } from './inventory.mjs';

export const toolchainSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/python-toolchain-inventory/v1/inventory.schema.json',
);
export const buildProvenanceSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/build-artifact-provenance/v1/provenance.schema.json',
);

function validatorFor(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

const validateToolchainSchema = validatorFor(toolchainSchemaPath);
const validateBuildSchema = validatorFor(buildProvenanceSchemaPath);

function errors(validator) {
  return (validator.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function safePath(root, value) {
  if (isAbsolute(value) || basename(value) === '')
    throw new Error(`unsafe artifact path: ${value}`);
  const path = resolve(root, value);
  const fromRoot = relative(root, path);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`artifact path escapes root: ${value}`);
  }
  return path;
}

export function validateToolchainInventory(document, source = 'toolchain inventory') {
  if (!validateToolchainSchema(document)) {
    throw new Error(`${source}: schema invalid: ${errors(validateToolchainSchema)}`);
  }
  const failures = [];
  const components = new Map();
  const nativePaths = new Set();
  const artifactPaths = new Set();
  for (const component of document.components) {
    if (components.has(component.component_id)) {
      failures.push(`${component.component_id}: duplicate component id`);
    }
    components.set(component.component_id, component);
    if (artifactPaths.has(component.artifact.artifact_path)) {
      failures.push(`${component.component_id}: duplicate toolchain artifact path`);
    }
    artifactPaths.add(component.artifact.artifact_path);
    if (/latest|git\+|\/refs\/heads\//iu.test(component.artifact.canonical_reference)) {
      failures.push(`${component.component_id}: floating toolchain artifact reference is rejected`);
    }
    if (/unknown|unlicensed|noassertion/iu.test(component.license.expression)) {
      failures.push(`${component.component_id}: unknown toolchain license is rejected`);
    }
    if (
      component.platform !== 'any' &&
      (component.platform !== document.target.os ||
        (component.architecture !== 'any' &&
          component.architecture !== document.target.architecture))
    ) {
      failures.push(`${component.component_id}: component target differs from inventory target`);
    }
    if (component.component_kind === 'CPYTHON_DISTRIBUTION') {
      if (component.version !== document.target.python_version) {
        failures.push(`${component.component_id}: CPython exact patch differs from target`);
      }
      if (component.artifact.artifact_type !== 'distribution') {
        failures.push(`${component.component_id}: CPython must bind a distribution artifact`);
      }
      if (
        !component.usage_scopes.includes('PACKAGED_RUNTIME_COMPONENT') ||
        component.packaged_native_artifacts.length === 0
      ) {
        failures.push(
          `${component.component_id}: CPython runtime provenance has no packaged native bytes`,
        );
      }
    }
    if (
      ['PYINSTALLER', 'PYINSTALLER_BOOTLOADER'].includes(component.component_kind) &&
      !component.license.expression.includes('Bootloader-exception')
    ) {
      failures.push(
        `${component.component_id}: PyInstaller license must preserve the bootloader exception`,
      );
    }
    if (
      component.usage_scopes.includes('BUILD_TOOLCHAIN_COMPONENT') &&
      !component.usage_scopes.includes('PACKAGED_RUNTIME_COMPONENT') &&
      component.packaged_native_artifacts.length > 0
    ) {
      failures.push(
        `${component.component_id}: build-only component declares packaged runtime bytes`,
      );
    }
    for (const native of component.packaged_native_artifacts) {
      if (nativePaths.has(native.internal_path)) {
        failures.push(`duplicate toolchain packaged native path: ${native.internal_path}`);
      }
      nativePaths.add(native.internal_path);
    }
    if (
      new Date(component.vulnerability.review_expires_at) <=
      new Date(component.vulnerability.reviewed_at)
    ) {
      failures.push(`${component.component_id}: vulnerability review expiry is not after review`);
    }
  }
  for (const component of document.components) {
    for (const dependency of component.dependencies) {
      if (!components.has(dependency)) {
        failures.push(
          `${component.component_id}: dependency is not in complete graph: ${dependency}`,
        );
      }
    }
  }
  const kinds = new Set(document.components.map((component) => component.component_kind));
  for (const kind of ['CPYTHON_DISTRIBUTION', 'PYINSTALLER', 'PYINSTALLER_BOOTLOADER']) {
    if (!kinds.has(kind)) failures.push(`toolchain graph is missing ${kind}`);
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return document;
}

export function loadToolchainInventory(path) {
  const resolved = resolve(path);
  return {
    path: resolved,
    document: validateToolchainInventory(JSON.parse(readFileSync(resolved, 'utf8')), resolved),
  };
}

export async function verifyToolchainArtifacts(loaded, artifactRoot) {
  const root = resolve(artifactRoot);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`toolchain artifact root is missing: ${root}`);
  }
  const failures = [];
  for (const component of loaded.document.components) {
    const path = safePath(root, component.artifact.artifact_path);
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
      failures.push(`${component.component_id}: source artifact is missing`);
      continue;
    }
    if (basename(path) !== component.artifact.filename) {
      failures.push(`${component.component_id}: source artifact filename mismatch`);
    }
    const hash = await sha256File(path);
    if (hash !== component.artifact.sha256) {
      failures.push(`${component.component_id}: source artifact hash mismatch`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return loaded;
}

export function validateBuildProvenance(document, source = 'build provenance') {
  if (!validateBuildSchema(document)) {
    throw new Error(`${source}: schema invalid: ${errors(validateBuildSchema)}`);
  }
  return document;
}

export function loadBuildProvenance(path) {
  const resolved = resolve(path);
  return {
    path: resolved,
    document: validateBuildProvenance(JSON.parse(readFileSync(resolved, 'utf8')), resolved),
  };
}

export async function verifyBuildProvenance(
  loadedBuild,
  loadedToolchain,
  loadedWheels,
  buildRoot,
  inspection,
) {
  const build = loadedBuild.document;
  const toolchain = loadedToolchain.document;
  const failures = [];
  if (
    build.target.os !== toolchain.target.os ||
    build.target.architecture !== toolchain.target.architecture
  )
    failures.push('build target differs from toolchain target');
  const wheelIdentities = new Map(
    build.inputs.wheel_inventories.map((item) => [item.inventory_id, item]),
  );
  if (wheelIdentities.size !== build.inputs.wheel_inventories.length) {
    failures.push('build contains duplicate wheel inventory identities');
  }
  for (const loaded of loadedWheels) {
    const identity = wheelIdentities.get(loaded.document.inventory_id);
    if (!identity)
      failures.push(`build is missing wheel inventory ${loaded.document.inventory_id}`);
    else if ((await sha256File(loaded.path)) !== identity.manifest_sha256) {
      failures.push(`wheel inventory manifest hash mismatch: ${loaded.document.inventory_id}`);
    }
  }
  if (wheelIdentities.size !== loadedWheels.length)
    failures.push('build wheel inventory set differs from verified inputs');
  if (build.inputs.toolchain_inventory.inventory_id !== toolchain.inventory_id) {
    failures.push('build toolchain inventory id mismatch');
  }
  if (
    (await sha256File(loadedToolchain.path)) !== build.inputs.toolchain_inventory.manifest_sha256
  ) {
    failures.push('build toolchain inventory manifest hash mismatch');
  }
  const byId = new Map(
    toolchain.components.map((component) => [component.component_id, component]),
  );
  for (const [field, kind] of [
    ['cpython_component_id', 'CPYTHON_DISTRIBUTION'],
    ['pyinstaller_component_id', 'PYINSTALLER'],
    ['bootloader_component_id', 'PYINSTALLER_BOOTLOADER'],
  ]) {
    if (byId.get(build.inputs[field])?.component_kind !== kind) {
      failures.push(`build ${field} does not bind ${kind}`);
    }
  }
  if (
    build.inputs.pip_component_id &&
    byId.get(build.inputs.pip_component_id)?.component_kind !== 'PIP'
  ) {
    failures.push('build pip_component_id does not bind PIP');
  }
  const configPath = safePath(resolve(buildRoot), build.build_configuration.path);
  const finalPath = safePath(resolve(buildRoot), build.final_artifact.artifact_path);
  if (
    !existsSync(configPath) ||
    (await sha256File(configPath)) !== build.build_configuration.sha256
  ) {
    failures.push('build configuration/spec hash mismatch');
  }
  if (!existsSync(finalPath) || (await sha256File(finalPath)) !== build.final_artifact.sha256) {
    failures.push('final worker hash mismatch');
  }
  if (basename(finalPath) !== build.final_artifact.filename) {
    failures.push('final worker filename differs from build provenance');
  }
  if (inspection) {
    if (inspection.final_artifact.sha256 !== build.final_artifact.sha256)
      failures.push('inspected final worker hash differs from build provenance');
    if (inspection.bootloader_layer.sha256 !== build.output_layers.bootloader_sha256)
      failures.push('bootloader layer hash differs from build provenance');
    if (inspection.archive_payload.sha256 !== build.output_layers.archive_payload_sha256)
      failures.push('CArchive payload hash differs from build provenance');
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return { build, finalPath };
}

export function auditToolchainLicenses(toolchain) {
  const components = toolchain.components.map((component) => ({
    owner_kind: 'TOOLCHAIN_OWNED_NATIVE',
    component_id: component.component_id,
    component_kind: component.component_kind,
    version: component.version,
    usage_scopes: component.usage_scopes,
    artifact_sha256: component.artifact.sha256,
    license_expression: component.license.expression,
    redistribution_evidence: component.license.redistribution_evidence,
    status: component.license.review_status,
  }));
  return { schema_version: '1', status: 'PASS', owner_kind: 'TOOLCHAIN_OWNED_NATIVE', components };
}

export function auditToolchainVulnerabilities(toolchain, now = new Date()) {
  const failures = [];
  const components = toolchain.components.map((component) => {
    if (new Date(component.vulnerability.review_expires_at) <= now) {
      failures.push(`${component.component_id}: vulnerability review expired`);
    }
    if (component.vulnerability.advisory_ids.length > 0) {
      failures.push(`${component.component_id}: unresolved vulnerability advisories`);
    }
    return {
      owner_kind: 'TOOLCHAIN_OWNED_NATIVE',
      component_id: component.component_id,
      version: component.version,
      usage_scopes: component.usage_scopes,
      artifact_sha256: component.artifact.sha256,
      source_type: component.vulnerability.source_type,
      data_source: component.vulnerability.data_source,
      unsupported_policy: component.vulnerability.unsupported_policy,
      advisory_ids: component.vulnerability.advisory_ids,
    };
  });
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return { schema_version: '1', status: 'PASS', owner_kind: 'TOOLCHAIN_OWNED_NATIVE', components };
}
