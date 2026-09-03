import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const schemaRoots = {
  1: resolve(repositoryRoot, 'schemas/compliance/distribution-trust-chain/v1'),
  2: resolve(repositoryRoot, 'schemas/compliance/distribution-trust-chain/v2'),
};
const schemaFiles = {
  recipe: 'build-recipe.schema.json',
  environment: 'build-environment.schema.json',
  context: 'build-context.schema.json',
  candidate: 'candidate-identity.schema.json',
  retention: 'retention-receipt.schema.json',
  recovery: 'recovery-drill.schema.json',
  transferManifest: 'candidate-transfer-manifest.schema.json',
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = Object.fromEntries(
  Object.entries(schemaRoots).map(([version, root]) => [
    version,
    Object.fromEntries(
      Object.entries(schemaFiles)
        .filter(([, file]) => version === '2' || file !== schemaFiles.transferManifest)
        .map(([name, file]) => [
          name,
          ajv.compile(JSON.parse(readFileSync(resolve(root, file), 'utf8'))),
        ]),
    ),
  ]),
);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function documentHash(document, field) {
  const copy = { ...document };
  delete copy[field];
  return createHash('sha256')
    .update(JSON.stringify(canonical(copy)))
    .digest('hex');
}

function load(path, kind) {
  const resolved = resolve(repositoryRoot, path);
  const document = JSON.parse(readFileSync(resolved, 'utf8'));
  const version = document.schema_version;
  const validator = validators[version]?.[kind];
  if (!validator) throw new Error(`${kind} has unsupported schema_version: ${version}`);
  if (!validator(document)) {
    const detail = (validator.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
      .join('; ');
    throw new Error(`${kind} schema invalid (${resolved}): ${detail}`);
  }
  return { path: resolved, document, version };
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function assertPortable(document, label) {
  const forbidden = /(?:^|[\\/])(?:Users|home)(?:[\\/])|(?:^|\s)file:|^[A-Za-z]:[\\/]/iu;
  const violations = collectStrings(document).filter((value) => forbidden.test(value));
  if (violations.length > 0) {
    throw new Error(`${label} contains a non-portable authority-bearing path: ${violations[0]}`);
  }
}

function assertHash(document, field, label) {
  if (document[field] !== documentHash(document, field)) {
    throw new Error(`${label} ${field} does not match canonical bytes`);
  }
}

function same(left, right, label) {
  if (left !== right) throw new Error(`${label} mismatch: ${left} != ${right}`);
}

function verifyTrustChain({
  recipe,
  environment,
  context,
  candidate,
  retention,
  recovery,
  transferManifest,
}) {
  const loaded = {
    recipe: load(recipe, 'recipe'),
    environment: load(environment, 'environment'),
    context: load(context, 'context'),
    candidate: load(candidate, 'candidate'),
    retention: load(retention, 'retention'),
    recovery: load(recovery, 'recovery'),
  };
  const versions = new Set(Object.values(loaded).map(({ version }) => version));
  if (versions.size !== 1) {
    throw new Error(`trust-chain records must use one schema version: ${[...versions].join(', ')}`);
  }
  const version = loaded.recipe.version;
  if (version === '2') {
    if (!transferManifest) throw new Error('schema v2 requires --transfer-manifest');
    loaded.transferManifest = load(transferManifest, 'transferManifest');
    if (loaded.transferManifest.version !== version)
      throw new Error('transfer manifest schema version mismatch');
  } else if (transferManifest) {
    throw new Error('schema v1 does not accept a transfer manifest');
  }
  const r = loaded.recipe.document;
  const e = loaded.environment.document;
  const c = loaded.context.document;
  const n = loaded.candidate.document;
  const t = loaded.retention.document;
  const d = loaded.recovery.document;
  const m = loaded.transferManifest?.document;
  assertHash(r, 'recipe_sha256', 'Build Recipe');
  assertHash(e, 'descriptor_sha256', 'Environment Descriptor');
  assertHash(c, 'context_sha256', 'Build Context');
  assertHash(n, 'candidate_sha256', 'Candidate Identity');
  assertHash(t, 'receipt_sha256', 'Retention Receipt');
  assertHash(d, 'drill_sha256', 'Recovery Drill');
  for (const [label, document] of Object.entries({
    recipe: r,
    environment: e,
    context: c,
    candidate: n,
    retention: t,
    recovery: d,
    ...(m ? { transferManifest: m } : {}),
  })) {
    assertPortable(document, label);
  }

  same(c.build_recipe.recipe_id, r.recipe_id, 'context recipe id');
  same(c.build_recipe.recipe_sha256, r.recipe_sha256, 'context recipe hash');
  same(c.environment_descriptor.descriptor_id, e.descriptor_id, 'context environment id');
  same(c.environment_descriptor.descriptor_sha256, e.descriptor_sha256, 'context environment hash');
  same(c.source_identity.commit_sha, r.source_identity.commit_sha, 'source commit');
  same(c.source_identity.tree_sha, r.source_identity.tree_sha, 'source tree');
  same(c.source_identity.submodule_state, r.source_identity.submodule_state, 'submodule state');
  same(c.source_identity.untracked_build_input_count, 0, 'untracked build inputs');
  same(c.target_descriptor.descriptor_id, r.python_target.descriptor_id, 'target descriptor');
  same(
    c.target_descriptor.descriptor_sha256,
    r.python_target.descriptor_sha256,
    'target descriptor hash',
  );
  same(c.cpython_exact_artifact_sha256, r.cpython_exact_artifact_sha256, 'CPython artifact');
  same(c.pyinstaller_spec.path, r.pyinstaller_spec.path, 'PyInstaller spec path');
  same(c.pyinstaller_spec.sha256, r.pyinstaller_spec.sha256, 'PyInstaller spec hash');
  same(c.created_before_build, true, 'context pre-build freeze');
  same(r.frozen_before_build, true, 'recipe pre-build freeze');
  same(e.descriptor_bytes_retained, true, 'environment descriptor byte retention');

  same(n.build_context.context_id, c.context_id, 'candidate context id');
  same(n.build_context.context_sha256, c.context_sha256, 'candidate context hash');
  same(n.source_identity.commit_sha, c.source_identity.commit_sha, 'candidate source commit');
  same(n.source_identity.tree_sha, c.source_identity.tree_sha, 'candidate source tree');
  same(n.worker.sha256, t.worker.sha256, 'retention Worker hash');
  same(n.worker.size_bytes, t.worker.size_bytes, 'retention Worker size');
  same(n.carchive.sha256, t.carchive.sha256, 'retention CArchive hash');
  same(n.carchive.size_bytes, t.carchive.size_bytes, 'retention CArchive size');
  same(t.candidate_id, n.candidate_id, 'retention candidate id');
  same(d.candidate_id, n.candidate_id, 'recovery candidate id');
  same(d.retention_receipt_id, t.receipt_id, 'recovery receipt id');
  if (version === '1') {
    same(d.procedure_version, t.recovery_procedure_version, 'recovery procedure version');
    same(d.primary_recovery.source_copy_id, t.primary_copy.copy_id, 'primary recovery copy');
    same(d.secondary_availability.copy_id, t.secondary_copy.copy_id, 'secondary availability copy');
    same(d.primary_recovery.worker_sha256, n.worker.sha256, 'recovered Worker hash');
    same(d.primary_recovery.carchive_sha256, n.carchive.sha256, 'recovered CArchive hash');
    if (t.primary_copy.copy_id === t.secondary_copy.copy_id)
      throw new Error('retention copies must be independent');
    if (t.primary_copy.storage_locator === t.secondary_copy.storage_locator)
      throw new Error('retention locators must be independent');
    if (t.primary_copy.storage_location_identity === t.secondary_copy.storage_location_identity)
      throw new Error('retention storage locations must be independent');
    same(
      t.primary_copy.archived_object_sha256,
      n.archive_container.sha256,
      'primary archived object hash',
    );
    same(
      t.secondary_copy.archived_object_sha256,
      n.archive_container.sha256,
      'secondary archived object hash',
    );
  } else if (version === '2') {
    same(d.procedure_version, t.recovery_procedure_version, 'recovery procedure version');
    same(n.transfer_manifest.manifest_id, m.manifest_id, 'candidate transfer manifest id');
    same(
      n.transfer_manifest.manifest_sha256,
      m.manifest_sha256,
      'candidate transfer manifest hash',
    );
    same(m.candidate_id, n.candidate_id, 'transfer candidate id');
    same(m.platform.os, n.platform.os, 'transfer platform');
    same(m.platform.architecture, n.platform.architecture, 'transfer architecture');
    same(m.worker.filename, n.worker.filename, 'transfer Worker filename');
    same(m.worker.sha256, n.worker.sha256, 'transfer Worker hash');
    same(m.worker.size_bytes, n.worker.size_bytes, 'transfer Worker size');
    same(m.carchive.filename, n.carchive.filename, 'transfer CArchive filename');
    same(m.carchive.sha256, n.carchive.sha256, 'transfer CArchive hash');
    same(m.carchive.size_bytes, n.carchive.size_bytes, 'transfer CArchive size');
    same(m.build_recipe.id, r.recipe_id, 'transfer recipe id');
    same(m.build_recipe.sha256, r.recipe_sha256, 'transfer recipe hash');
    same(m.environment_descriptor.id, e.descriptor_id, 'transfer environment id');
    same(m.environment_descriptor.sha256, e.descriptor_sha256, 'transfer environment hash');
    same(m.build_context.id, c.context_id, 'transfer context id');
    same(m.build_context.sha256, c.context_sha256, 'transfer context hash');
    same(m.transfer_role, 'TRANSIENT_ACTIONS_TRANSFER', 'transfer role');
    same(m.actions_artifact.retention_days, 1, 'Actions artifact retention');
    same(m.actions_artifact.authority_role, 'TRANSPORT_ONLY', 'Actions artifact authority role');
    same(m.final_retention.channel, 'MAC_LOCAL_PROJECT_FOLDER', 'final retention channel');
    same(m.final_retention.logical_root, 'frozen-candidates/', 'final retention logical root');
    same(m.final_retention.secondary_copy_required, false, 'secondary retention requirement');
    same(t.storage_channel_class, 'MAC_LOCAL_PROJECT_FOLDER', 'retention channel');
    same(t.secondary_retention_copy_required, false, 'retention secondary requirement');
    same(t.local_copy.worker_sha256, n.worker.sha256, 'local retained Worker hash');
    same(t.local_copy.worker_size_bytes, n.worker.size_bytes, 'local retained Worker size');
    same(t.local_copy.carchive_sha256, n.carchive.sha256, 'local retained CArchive hash');
    same(t.local_copy.carchive_size_bytes, n.carchive.size_bytes, 'local retained CArchive size');
    same(
      t.local_copy.storage_locator,
      `frozen-candidates/${n.candidate_id}/${n.platform.os}/`,
      'local retention locator',
    );
    same(d.local_recovery.source_copy_id, t.local_copy.copy_id, 'local recovery copy');
    same(d.local_recovery.worker_sha256, n.worker.sha256, 'recovered Worker hash');
    same(d.local_recovery.worker_size_bytes, n.worker.size_bytes, 'recovered Worker size');
    same(d.local_recovery.carchive_sha256, n.carchive.sha256, 'recovered CArchive hash');
    same(d.local_recovery.carchive_size_bytes, n.carchive.size_bytes, 'recovered CArchive size');
  } else {
    throw new Error(`unsupported trust-chain schema version: ${version}`);
  }
  same(n.status, 'FROZEN_CANDIDATE', 'candidate status');
  same(t.retention_state, 'FROZEN_CANDIDATE', 'retention state');
  console.log(
    `distribution-trust-chain: PASS (v${version}; ${basename(loaded.candidate.path)}; ${dirname(loaded.candidate.path)})`,
  );
  return loaded;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    values[key] = argv[index + 1];
    index += 1;
  }
  return values;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArguments(process.argv.slice(2));
  if (args.verify !== undefined || args.recipe) {
    try {
      verifyTrustChain(args);
    } catch (error) {
      console.error(`distribution-trust-chain: FAIL\n${error.message}`);
      process.exitCode = 1;
    }
  } else {
    console.error(
      'usage: node tools/python-supply-chain/trust-chain.mjs --recipe ... --environment ... --context ... --candidate ... --retention ... --recovery ... [--transfer-manifest ...]',
    );
    process.exitCode = 2;
  }
}

export { canonical, documentHash, verifyTrustChain };
