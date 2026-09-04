import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const schemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/native-runtime-companion/v1/companion.schema.json',
);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

const SHA256 = /^[0-9a-f]{64}$/u;
const WINDOWS_DRIVE = /^[A-Za-z]:(?:[\\/]|$)/u;

/** The repository's canonical JSON rule: object keys sort recursively; arrays retain order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashCanonical(value) {
  return sha256Bytes(JSON.stringify(canonicalJson(value)));
}

export function manifestHash(manifest) {
  const copy = { ...manifest };
  delete copy.manifest_sha256;
  return hashCanonical(copy);
}

function normalizedMemberIdentities(manifest) {
  return [...manifest.bundle_members]
    .map((member) => ({
      ...member,
      path: normalizeRelativePath(member.path),
      ...(member.link_target ? { link_target: normalizeRelativePath(member.link_target) } : {}),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Bundle identity intentionally excludes the two self hashes and license disposition.
 * It includes every artifact/provenance/loader semantic that changes what is approved.
 */
export function companionIdentityPayload(manifest) {
  return {
    schema_version: manifest.schema_version,
    subject_type: manifest.subject_type,
    companion_id: manifest.companion_id,
    role: manifest.role,
    platform: manifest.platform,
    entrypoint: {
      path: normalizeRelativePath(manifest.entrypoint.path),
      sha256: manifest.entrypoint.sha256,
    },
    bundle_members: normalizedMemberIdentities(manifest),
    runtime_dependency_closure: manifest.runtime_dependency_closure,
    provenance: manifest.provenance,
    build_configuration: manifest.build_configuration,
    distribution: {
      mode: manifest.distribution.mode,
      packaged_locator: normalizeRelativePath(manifest.distribution.packaged_locator),
      resolver_mode: manifest.distribution.resolver_mode,
      system_path_fallback: manifest.distribution.system_path_fallback,
      external_os_prerequisite_allowlist: manifest.distribution.external_os_prerequisite_allowlist,
    },
    retention: manifest.retention,
  };
}

export function companionIdentityHash(manifest) {
  return hashCanonical(companionIdentityPayload(manifest));
}

/** Convert a manifest path to one portable, root-relative representation. */
export function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('bundle path must be a non-empty string');
  }
  if (value.includes('\0')) throw new Error(`bundle path contains NUL: ${value}`);
  const portable = value.replaceAll('\\', '/');
  if (portable.startsWith('/') || portable.startsWith('//') || WINDOWS_DRIVE.test(portable)) {
    throw new Error(`absolute bundle path is forbidden: ${value}`);
  }
  const parts = portable.split('/');
  const normalized = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new Error(`path traversal is forbidden: ${value}`);
    normalized.push(part);
  }
  if (normalized.length === 0) throw new Error(`bundle path resolves to root: ${value}`);
  return normalized.join('/');
}

function formatAjvErrors() {
  return (validateSchema.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function assertEqual(left, right, label) {
  if (JSON.stringify(canonicalJson(left)) !== JSON.stringify(canonicalJson(right))) {
    throw new Error(`${label} mismatch`);
  }
}

function assertExpectedBindings(manifest, expected = {}) {
  const provenance = manifest.provenance;
  const source = expected.expectedSourceBinding ?? expected.expectedProvenance;
  if (source) {
    for (const key of [
      'upstream_project',
      'upstream_release',
      'upstream_tag',
      'upstream_commit',
      'source_archive_identity',
      'source_archive_sha256',
    ]) {
      if (source[key] !== undefined && provenance[key] !== source[key]) {
        throw new Error(`source provenance ${key} mismatch`);
      }
    }
  }
  const bindingChecks = [
    ['expectedBuildRecipe', 'build_recipe_id', 'build_recipe_sha256', 'build recipe'],
    [
      'expectedEnvironmentDescriptor',
      'build_environment_descriptor_id',
      'build_environment_descriptor_sha256',
      'build environment descriptor',
    ],
    ['expectedBuildContext', 'build_context_id', 'build_context_sha256', 'build context'],
  ];
  for (const [option, idKey, hashKey, label] of bindingChecks) {
    const expectedValue = expected[option];
    if (!expectedValue) continue;
    const expectedId = typeof expectedValue === 'string' ? expectedValue : expectedValue.id;
    const expectedHash = typeof expectedValue === 'string' ? undefined : expectedValue.sha256;
    if (expectedId !== undefined && provenance[idKey] !== expectedId)
      throw new Error(`${label} id mismatch`);
    if (expectedHash !== undefined && provenance[hashKey] !== expectedHash)
      throw new Error(`${label} hash mismatch`);
  }
  const expectedPlatform = expected.expectedPlatform ?? expected.platform;
  if (expectedPlatform) assertEqual(manifest.platform, expectedPlatform, 'platform');
  if (expected.expectedBuildConfiguration) {
    assertEqual(
      manifest.build_configuration,
      expected.expectedBuildConfiguration,
      'build configuration',
    );
  }
  if (
    expected.expectedIdentitySha256 &&
    manifest.companion_identity_sha256 !== expected.expectedIdentitySha256
  ) {
    throw new Error('approved companion identity mismatch');
  }
}

function assertManifestSemantics(manifest) {
  const normalizedMembers = normalizedMemberIdentities(manifest);
  const seen = new Set();
  const seenWindows = new Set();
  for (const originalMember of manifest.bundle_members) {
    const normalizedPath = normalizeRelativePath(originalMember.path);
    if (originalMember.path !== normalizedPath)
      throw new Error(`bundle member must use normalized relative path: ${originalMember.path}`);
  }
  for (const member of normalizedMembers) {
    if (seen.has(member.path))
      throw new Error(`duplicate normalized bundle member: ${member.path}`);
    seen.add(member.path);
    if (manifest.platform.os === 'windows') {
      const folded = member.path.toLocaleLowerCase('en-US');
      if (seenWindows.has(folded)) throw new Error(`Windows case collision: ${member.path}`);
      seenWindows.add(folded);
    }
    if (member.kind === 'SYMLINK') {
      if (!member.link_target)
        throw new Error(`declared symlink has no link_target: ${member.path}`);
      if (member.link_target === member.path)
        throw new Error(`self-referential symlink is forbidden: ${member.path}`);
    } else if (member.link_target) {
      throw new Error(`non-symlink member has link_target: ${member.path}`);
    }
  }

  const entrypointPath = normalizeRelativePath(manifest.entrypoint.path);
  if (entrypointPath !== manifest.entrypoint.path)
    throw new Error(`entrypoint must use normalized relative path: ${manifest.entrypoint.path}`);
  const entrypointMember = normalizedMembers.find((member) => member.path === entrypointPath);
  if (!entrypointMember) throw new Error('entrypoint is outside declared bundle members');
  if (entrypointMember.kind !== 'EXECUTABLE')
    throw new Error('entrypoint member must be EXECUTABLE');
  if (entrypointMember.sha256 !== manifest.entrypoint.sha256)
    throw new Error('entrypoint sha256 does not match declared member');

  if (manifest.provenance.target_platform !== manifest.platform.os)
    throw new Error('provenance target platform mismatch');
  if (manifest.provenance.target_architecture !== manifest.platform.architecture)
    throw new Error('provenance target architecture mismatch');

  const runtimeMembers = manifest.runtime_dependency_closure.members;
  const runtimePaths = new Set();
  const runtimeNames = new Set();
  for (const runtimeMember of runtimeMembers) {
    if (runtimeNames.has(runtimeMember.name))
      throw new Error(`duplicate runtime dependency: ${runtimeMember.name}`);
    runtimeNames.add(runtimeMember.name);
    if (runtimeMember.classification === 'INTERNAL_COMPANION_MEMBER') {
      if (!runtimeMember.member_path)
        throw new Error(`internal runtime dependency lacks member_path: ${runtimeMember.name}`);
      const path = normalizeRelativePath(runtimeMember.member_path);
      if (path !== runtimeMember.member_path)
        throw new Error(
          `runtime dependency must use normalized member_path: ${runtimeMember.name}`,
        );
      if (!seen.has(path)) throw new Error(`runtime dependency is not a declared member: ${path}`);
      if (runtimeMember.loader_scope !== 'COMPANION_BUNDLE_ONLY')
        throw new Error(
          `internal runtime dependency must use bundle-only loader scope: ${runtimeMember.name}`,
        );
      runtimePaths.add(path);
    } else if (runtimeMember.member_path !== undefined) {
      throw new Error(
        `external OS prerequisite cannot claim a bundle member: ${runtimeMember.name}`,
      );
    }
  }
  const allowlist = new Set(manifest.distribution.external_os_prerequisite_allowlist);
  const prerequisites = new Set();
  for (const prerequisite of manifest.runtime_dependency_closure.external_os_prerequisites) {
    if (!prerequisite.allowlisted)
      throw new Error(`external prerequisite is not allowlisted: ${prerequisite.name}`);
    prerequisites.add(prerequisite.id);
    prerequisites.add(prerequisite.name);
    if (!allowlist.has(prerequisite.id) && !allowlist.has(prerequisite.name))
      throw new Error(`external prerequisite is absent from allowlist: ${prerequisite.name}`);
  }
  for (const runtimeMember of runtimeMembers) {
    if (
      runtimeMember.classification === 'EXTERNAL_OS_PREREQUISITE' &&
      !prerequisites.has(runtimeMember.name) &&
      !allowlist.has(runtimeMember.name)
    ) {
      throw new Error(
        `external runtime prerequisite is not declared and allowlisted: ${runtimeMember.name}`,
      );
    }
  }
  if (manifest.runtime_dependency_closure.unresolved_count !== 0)
    throw new Error('runtime dependency closure contains unresolved dependencies');

  for (const member of normalizedMembers) {
    if (member.kind === 'DYNAMIC_LIBRARY' && !runtimePaths.has(member.path)) {
      throw new Error(`dynamic library is not declared in runtime closure: ${member.path}`);
    }
  }
  const locator = normalizeRelativePath(manifest.distribution.packaged_locator);
  if (locator !== manifest.distribution.packaged_locator)
    throw new Error('packaged locator must use normalized relative path');
  if (locator !== entrypointPath)
    throw new Error('packaged locator must resolve to declared entrypoint');
  if (manifest.distribution.system_path_fallback !== false)
    throw new Error('system PATH fallback must be false');
}

export function validateCompanionManifest(manifest, expected = {}) {
  if (!manifest || typeof manifest !== 'object' || !validateSchema(manifest)) {
    throw new Error(`native runtime companion schema invalid: ${formatAjvErrors()}`);
  }
  assertManifestSemantics(manifest);
  if (
    !SHA256.test(manifest.manifest_sha256) ||
    manifest.manifest_sha256 !== manifestHash(manifest)
  ) {
    throw new Error('manifest_sha256 does not match canonical manifest bytes');
  }
  if (
    !SHA256.test(manifest.companion_identity_sha256) ||
    manifest.companion_identity_sha256 !== companionIdentityHash(manifest)
  ) {
    throw new Error('companion_identity_sha256 does not match canonical bundle identity');
  }
  assertExpectedBindings(manifest, expected);
  return {
    manifest_sha256: manifest.manifest_sha256,
    companion_identity_sha256: manifest.companion_identity_sha256,
  };
}

function isInside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === '' ||
    (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !fromRoot.startsWith(sep))
  );
}

function walkBundle(root, current = '', output = []) {
  const directory = join(root, current);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name;
    const candidate = join(root, relativePath);
    const stat = lstatSync(candidate);
    if (stat.isDirectory()) {
      walkBundle(root, relativePath, output);
    } else if (stat.isSymbolicLink()) {
      output.push({ path: relativePath, type: 'symlink' });
    } else if (stat.isFile()) {
      output.push({ path: relativePath, type: 'file' });
    } else {
      throw new Error(`unsupported bundle filesystem member: ${relativePath}`);
    }
  }
  return output;
}

function hashMember(fullPath, type) {
  if (type === 'symlink') return sha256Bytes(readlinkSync(fullPath));
  return sha256Bytes(readFileSync(fullPath));
}

export function verifyCompanionBundle({
  manifest,
  bundleRoot,
  resolvedLocator,
  observedRuntimeDependencies,
  ...expected
}) {
  validateCompanionManifest(manifest, expected);
  if (typeof bundleRoot !== 'string' || bundleRoot.length === 0)
    throw new Error('bundleRoot is required');
  const root = resolve(bundleRoot);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory()) throw new Error('bundleRoot must be a directory');
  if (expected.approvedBundleRoot && !isInside(resolve(expected.approvedBundleRoot), root))
    throw new Error('bundle root is outside approved root');

  const members = new Map(
    manifest.bundle_members.map((member) => [normalizeRelativePath(member.path), member]),
  );
  for (const actual of walkBundle(root)) {
    const normalized = normalizeRelativePath(actual.path);
    if (!members.has(normalized))
      throw new Error(`undeclared packaged bundle member: ${normalized}`);
  }
  for (const [memberPath, member] of members) {
    const fullPath = resolve(root, memberPath);
    if (!isInside(root, fullPath)) throw new Error(`bundle member escapes root: ${memberPath}`);
    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      throw new Error(`missing bundle member: ${memberPath}`);
    }
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other';
    if (member.kind === 'SYMLINK') {
      if (type !== 'symlink') throw new Error(`declared symlink is not a symlink: ${memberPath}`);
      const actualTarget = normalizeRelativePath(readlinkSync(fullPath));
      if (actualTarget !== normalizeRelativePath(member.link_target))
        throw new Error(`symlink target mismatch: ${memberPath}`);
      const targetPath = resolve(root, actualTarget);
      if (!isInside(root, targetPath))
        throw new Error(`symlink target escapes bundle root: ${memberPath}`);
    } else if (type !== 'file') {
      throw new Error(`undeclared link or non-file member: ${memberPath}`);
    }
    if (hashMember(fullPath, type) !== member.sha256)
      throw new Error(`bundle member sha256 mismatch: ${memberPath}`);
  }

  const locator = resolvedLocator ?? manifest.distribution.packaged_locator;
  if (typeof locator !== 'string') throw new Error('resolved locator must be a relative path');
  const normalizedLocator = normalizeRelativePath(locator);
  if (normalizedLocator !== manifest.distribution.packaged_locator)
    throw new Error('PATH-resolved or unexpected runtime locator rejected');
  const resolvedExecutable = resolve(root, normalizedLocator);
  if (!isInside(root, resolvedExecutable))
    throw new Error('resolved executable is outside bundle root');
  const executableStat = lstatSync(resolvedExecutable);
  if (!executableStat.isFile() || executableStat.isSymbolicLink())
    throw new Error('resolved executable is not the declared regular entrypoint');
  if (normalizedLocator !== manifest.entrypoint.path)
    throw new Error('resolved executable is not declared entrypoint');
  if (hashMember(resolvedExecutable, 'file') !== manifest.entrypoint.sha256)
    throw new Error('resolved executable sha256 mismatch');

  if (observedRuntimeDependencies) {
    const declared = new Set(manifest.runtime_dependency_closure.members.map((item) => item.name));
    for (const observed of observedRuntimeDependencies) {
      const name = typeof observed === 'string' ? observed : observed?.name;
      if (!name || !declared.has(name))
        throw new Error(`undeclared dynamic runtime dependency: ${name ?? '<unknown>'}`);
    }
  }
  return {
    status: 'PASS',
    bundle_identity_sha256: manifest.companion_identity_sha256,
    entrypoint: manifest.entrypoint.path,
    member_count: manifest.bundle_members.length,
  };
}

export function loadCompanionManifest(path) {
  const resolved = resolve(repositoryRoot, path);
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

export const nativeRuntimeCompanionSchemaPath = schemaPath;
