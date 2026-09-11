import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson, hashFile, sha256 } from '@app/domain-media-index';
import { RenderPolicyRepository, RenderPreparationRepository, openDatabase } from '@app/local-db';
import {
  buildExecutionSnapshotV1,
  parseLogicalRenderPlanV1,
  parseRenderExecutionSnapshotV1,
  parseRenderPolicyV1,
  renderRuntimeIdentityV1Schema,
  type LogicalRenderPlanV1,
  type RenderAcceptedTimelineRequestV1,
  type RenderExecutionSnapshotV1,
  type RenderPolicyV1,
} from '@app/render';

interface PortableFileV1 {
  relative_path: string;
  role: 'AUTHORITY' | 'SOURCE' | 'NARRATION';
  sha256: string;
  size_bytes: number;
}

interface PortableSourceBindingV1 {
  relative_path: string;
  authority_sha256: string;
  size_bytes: number;
  segment_ids: string[];
}

interface PortableNarrationBindingV1 {
  relative_path: string;
  authority_sha256: string;
  size_bytes: number;
}

interface PortableAuthorityV1 {
  schema_version: '1.0';
  authority_mode: 'HISTORICAL_ACCEPTED_CHAIN';
  job_id: string;
  request: RenderAcceptedTimelineRequestV1;
  logical_plan: LogicalRenderPlanV1;
  render_policy: RenderPolicyV1;
  original_execution_snapshot_hash: string;
  original_execution_platform: string;
  original_execution_architecture: string;
  source_bindings: PortableSourceBindingV1[];
  narration_binding: PortableNarrationBindingV1;
}

interface SmokeBundleManifestV1 {
  schema_version: '1.0';
  manifest_kind: 'CODE_G_R1B_HISTORICAL_SMOKE_BUNDLE';
  authority_mode: 'HISTORICAL_ACCEPTED_CHAIN';
  job_id: string;
  timeline_id: string;
  timeline_version: number;
  timeline_commit_receipt_hash: string;
  logical_render_hash: string;
  original_execution_snapshot_hash: string;
  render_policy_id: string;
  render_policy_version: number;
  render_policy_hash: string;
  original_runtime_profile_hash: string;
  runtime_requirement_id: 'CODE_G_R1B_ROTATION_CAPABLE_RUNTIME_V2';
  files: PortableFileV1[];
  manifest_hash: string;
  bundle_hash: string;
}

function safeRelativePath(value: string): string {
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.includes('\u0000') ||
    value.split(/[\\/]/u).some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new Error('R1B_SMOKE_BUNDLE_PATH_INVALID');
  }
  return value.replaceAll('\\', '/');
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string,
) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    throw new Error(code);
  }
}

async function exactRegularFile(path: string, code: string): Promise<string> {
  const facts = await lstat(path);
  if (!facts.isFile() || facts.isSymbolicLink()) throw new Error(code);
  return realpath(path);
}

async function assertNoSymlinkComponents(root: string, relativePath: string): Promise<void> {
  let current = root;
  for (const component of safeRelativePath(relativePath).split('/')) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('R1B_SMOKE_BUNDLE_SYMLINK_FORBIDDEN');
    }
  }
}

async function freshDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  const requestedFacts = await lstat(path);
  if (!requestedFacts.isDirectory() || requestedFacts.isSymbolicLink()) {
    throw new Error('R1B_SMOKE_BUNDLE_DESTINATION_INVALID');
  }
  const resolved = await realpath(path);
  const facts = await lstat(resolved);
  if (!facts.isDirectory() || facts.isSymbolicLink() || (await readdir(resolved)).length !== 0) {
    throw new Error('R1B_SMOKE_BUNDLE_DESTINATION_NOT_EMPTY');
  }
  return resolved;
}

function manifestPreimage(
  value: Omit<SmokeBundleManifestV1, 'manifest_hash' | 'bundle_hash'>,
): Omit<SmokeBundleManifestV1, 'manifest_hash' | 'bundle_hash'> {
  return value;
}

function completeManifest(
  value: Omit<SmokeBundleManifestV1, 'manifest_hash' | 'bundle_hash'>,
): SmokeBundleManifestV1 {
  const manifestHash = sha256(canonicalJson(manifestPreimage(value)));
  return {
    ...value,
    manifest_hash: manifestHash,
    bundle_hash: sha256(canonicalJson({ manifest_hash: manifestHash, files: value.files })),
  };
}

function parseManifest(value: unknown): SmokeBundleManifestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('R1B_SMOKE_BUNDLE_MANIFEST_INVALID');
  }
  const manifest = value as unknown as SmokeBundleManifestV1;
  assertExactKeys(
    value as Record<string, unknown>,
    [
      'schema_version',
      'manifest_kind',
      'authority_mode',
      'job_id',
      'timeline_id',
      'timeline_version',
      'timeline_commit_receipt_hash',
      'logical_render_hash',
      'original_execution_snapshot_hash',
      'render_policy_id',
      'render_policy_version',
      'render_policy_hash',
      'original_runtime_profile_hash',
      'runtime_requirement_id',
      'files',
      'manifest_hash',
      'bundle_hash',
    ],
    'R1B_SMOKE_BUNDLE_MANIFEST_KEYS_INVALID',
  );
  if (
    manifest.schema_version !== '1.0' ||
    manifest.manifest_kind !== 'CODE_G_R1B_HISTORICAL_SMOKE_BUNDLE' ||
    manifest.authority_mode !== 'HISTORICAL_ACCEPTED_CHAIN' ||
    manifest.runtime_requirement_id !== 'CODE_G_R1B_ROTATION_CAPABLE_RUNTIME_V2' ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error('R1B_SMOKE_BUNDLE_MANIFEST_INVALID');
  }
  for (const file of manifest.files) {
    assertExactKeys(
      file as unknown as Record<string, unknown>,
      ['relative_path', 'role', 'sha256', 'size_bytes'],
      'R1B_SMOKE_BUNDLE_FILE_RECORD_KEYS_INVALID',
    );
    if (
      !file ||
      typeof file !== 'object' ||
      !['AUTHORITY', 'SOURCE', 'NARRATION'].includes(file.role) ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 1
    ) {
      throw new Error('R1B_SMOKE_BUNDLE_FILE_RECORD_INVALID');
    }
  }
  const { manifest_hash: manifestHash, bundle_hash: bundleHash, ...preimage } = manifest;
  const expected = completeManifest(preimage);
  if (manifestHash !== expected.manifest_hash || bundleHash !== expected.bundle_hash) {
    throw new Error('R1B_SMOKE_BUNDLE_HASH_MISMATCH');
  }
  return manifest;
}

function fileExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/u.test(extension) ? extension : '.bin';
}

export async function exportHistoricalR1BSmokeBundle(input: {
  preparations: RenderPreparationRepository;
  policies: RenderPolicyRepository;
  job_id: string;
  bundle_root: string;
}): Promise<{ manifest: SmokeBundleManifestV1; bundle_root: string }> {
  const prepared = input.preparations.require(input.job_id);
  const snapshotValue = input.preparations.getReadySnapshot(input.job_id);
  if (prepared.state !== 'READY_FOR_EXECUTION' || !prepared.logical_plan || !snapshotValue) {
    throw new Error('HISTORICAL_R1A_PRODUCT_FIXTURE_NOT_READY');
  }
  const plan = parseLogicalRenderPlanV1(prepared.logical_plan);
  const snapshot = parseRenderExecutionSnapshotV1(snapshotValue);
  const policy = input.policies.require(plan.render_policy_id, plan.render_policy_version);
  if (
    snapshot.logical_render_hash !== plan.logical_render_hash ||
    policy.policy_hash !== plan.render_policy_hash ||
    prepared.request.timeline_id !== plan.timeline_id ||
    prepared.request.timeline_version !== plan.timeline_version ||
    prepared.request.expected_timeline_commit_receipt_hash !== plan.timeline_commit_receipt_hash ||
    prepared.request.render_policy_id !== plan.render_policy_id ||
    prepared.request.render_policy_version !== plan.render_policy_version ||
    prepared.request.render_policy_hash !== plan.render_policy_hash
  ) {
    throw new Error('R1B_SMOKE_HISTORICAL_AUTHORITY_BINDING_MISMATCH');
  }
  const segmentArtifacts = new Map<string, RenderExecutionSnapshotV1['source_artifacts'][number]>();
  for (const artifact of snapshot.source_artifacts) {
    for (const segmentId of artifact.segment_ids) {
      if (segmentArtifacts.has(segmentId)) {
        throw new Error('R1B_SMOKE_SOURCE_BINDING_DUPLICATE');
      }
      segmentArtifacts.set(segmentId, artifact);
    }
  }
  if (
    segmentArtifacts.size !== plan.video_operations.length ||
    plan.video_operations.some(
      (operation) =>
        segmentArtifacts.get(operation.segment_id)?.authority_sha256 !==
        operation.verified_file_sha256,
    )
  ) {
    throw new Error('R1B_SMOKE_SOURCE_AUTHORITY_MISMATCH');
  }
  if (snapshot.narration_artifact.authority_sha256 !== plan.narration_operation.artifact_sha256) {
    throw new Error('R1B_SMOKE_NARRATION_AUTHORITY_MISMATCH');
  }
  const bundleRoot = await freshDirectory(input.bundle_root);
  const files: PortableFileV1[] = [];
  const sourceBindings: PortableSourceBindingV1[] = [];
  for (const [index, artifact] of snapshot.source_artifacts.entries()) {
    const source = await exactRegularFile(artifact.staged_path, 'R1B_SMOKE_SOURCE_INVALID');
    const relativePath = `media/source-${String(index).padStart(3, '0')}-${artifact.authority_sha256}${fileExtension(source)}`;
    const destination = join(bundleRoot, ...safeRelativePath(relativePath).split('/'));
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(source, destination);
    const facts = await lstat(destination);
    const copiedHash = await hashFile(destination);
    if (
      copiedHash !== artifact.authority_sha256 ||
      copiedHash !== artifact.staged_sha256 ||
      facts.size !== artifact.size_bytes
    ) {
      throw new Error('R1B_SMOKE_SOURCE_HASH_MISMATCH');
    }
    files.push({
      relative_path: relativePath,
      role: 'SOURCE',
      sha256: copiedHash,
      size_bytes: facts.size,
    });
    sourceBindings.push({
      relative_path: relativePath,
      authority_sha256: artifact.authority_sha256,
      size_bytes: facts.size,
      segment_ids: [...artifact.segment_ids],
    });
  }
  const narration = snapshot.narration_artifact;
  const narrationSource = await exactRegularFile(
    narration.staged_path,
    'R1B_SMOKE_NARRATION_INVALID',
  );
  const narrationRelative = `media/narration-${narration.authority_sha256}${fileExtension(narrationSource)}`;
  const narrationDestination = join(bundleRoot, ...safeRelativePath(narrationRelative).split('/'));
  await mkdir(resolve(narrationDestination, '..'), { recursive: true });
  await copyFile(narrationSource, narrationDestination);
  const narrationFacts = await lstat(narrationDestination);
  const narrationHash = await hashFile(narrationDestination);
  if (
    narrationHash !== narration.authority_sha256 ||
    narrationHash !== narration.staged_sha256 ||
    narrationFacts.size !== narration.size_bytes
  ) {
    throw new Error('R1B_SMOKE_NARRATION_HASH_MISMATCH');
  }
  files.push({
    relative_path: narrationRelative,
    role: 'NARRATION',
    sha256: narrationHash,
    size_bytes: narrationFacts.size,
  });
  const authority: PortableAuthorityV1 = {
    schema_version: '1.0',
    authority_mode: 'HISTORICAL_ACCEPTED_CHAIN',
    job_id: input.job_id,
    request: prepared.request,
    logical_plan: plan,
    render_policy: policy,
    original_execution_snapshot_hash: snapshot.execution_snapshot_hash,
    original_execution_platform: snapshot.platform,
    original_execution_architecture: snapshot.architecture,
    source_bindings: sourceBindings,
    narration_binding: {
      relative_path: narrationRelative,
      authority_sha256: narration.authority_sha256,
      size_bytes: narrationFacts.size,
    },
  };
  const authorityPath = join(bundleRoot, 'authority.json');
  await writeFile(authorityPath, `${canonicalJson(authority)}\n`, { flag: 'wx' });
  const authorityFacts = await lstat(authorityPath);
  files.push({
    relative_path: 'authority.json',
    role: 'AUTHORITY',
    sha256: await hashFile(authorityPath),
    size_bytes: authorityFacts.size,
  });
  files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  const manifest = completeManifest({
    schema_version: '1.0',
    manifest_kind: 'CODE_G_R1B_HISTORICAL_SMOKE_BUNDLE',
    authority_mode: 'HISTORICAL_ACCEPTED_CHAIN',
    job_id: input.job_id,
    timeline_id: plan.timeline_id,
    timeline_version: plan.timeline_version,
    timeline_commit_receipt_hash: plan.timeline_commit_receipt_hash,
    logical_render_hash: plan.logical_render_hash,
    original_execution_snapshot_hash: snapshot.execution_snapshot_hash,
    render_policy_id: policy.policy_id,
    render_policy_version: policy.policy_version,
    render_policy_hash: policy.policy_hash,
    original_runtime_profile_hash: snapshot.runtime_identity.capability_profile_hash,
    runtime_requirement_id: 'CODE_G_R1B_ROTATION_CAPABLE_RUNTIME_V2',
    files,
  });
  await writeFile(join(bundleRoot, 'manifest.json'), `${canonicalJson(manifest)}\n`, {
    flag: 'wx',
  });
  return { manifest, bundle_root: bundleRoot };
}

async function verifyBundleFiles(
  bundleRoot: string,
  manifest: SmokeBundleManifestV1,
): Promise<Map<string, string>> {
  const actualFiles: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('R1B_SMOKE_BUNDLE_SYMLINK_FORBIDDEN');
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        actualFiles.push(relative(bundleRoot, path).split(sep).join('/'));
      } else {
        throw new Error('R1B_SMOKE_BUNDLE_FILE_INVALID');
      }
    }
  };
  await visit(bundleRoot);
  const expectedFiles = [
    ...manifest.files.map((file) => file.relative_path),
    'manifest.json',
  ].sort();
  if (canonicalJson(actualFiles.sort()) !== canonicalJson(expectedFiles)) {
    throw new Error('R1B_SMOKE_BUNDLE_FILE_SET_MISMATCH');
  }
  const normalized = new Set<string>();
  const paths = new Map<string, string>();
  for (const file of manifest.files) {
    const relativePath = safeRelativePath(file.relative_path);
    const collisionKey = relativePath.toLowerCase();
    if (normalized.has(collisionKey)) throw new Error('R1B_SMOKE_BUNDLE_PATH_CONFLICT');
    normalized.add(collisionKey);
    await assertNoSymlinkComponents(bundleRoot, relativePath);
    const path = await exactRegularFile(
      join(bundleRoot, ...relativePath.split('/')),
      'R1B_SMOKE_BUNDLE_FILE_INVALID',
    );
    if (!relative(bundleRoot, path) || relative(bundleRoot, path).startsWith(`..${sep}`)) {
      throw new Error('R1B_SMOKE_BUNDLE_PATH_ESCAPE');
    }
    const facts = await lstat(path);
    if (facts.size !== file.size_bytes || (await hashFile(path)) !== file.sha256) {
      throw new Error('R1B_SMOKE_BUNDLE_FILE_HASH_MISMATCH');
    }
    paths.set(relativePath, path);
  }
  return paths;
}

export async function importHistoricalR1BSmokeBundle(input: {
  bundle_root: string;
  controlled_root: string;
  migrations_directory: string;
  runtime_root: string;
  runtime_identity_path: string;
  approval_receipt_path: string;
}): Promise<{
  manifest_hash: string;
  bundle_hash: string;
  job_id: string;
  db_path: string;
  smoke_config_path: string;
}> {
  const bundleRootFacts = await lstat(input.bundle_root);
  if (!bundleRootFacts.isDirectory() || bundleRootFacts.isSymbolicLink()) {
    throw new Error('R1B_SMOKE_BUNDLE_ROOT_INVALID');
  }
  const bundleRoot = await realpath(input.bundle_root);
  const manifestPath = await exactRegularFile(
    join(bundleRoot, 'manifest.json'),
    'R1B_SMOKE_BUNDLE_MANIFEST_INVALID',
  );
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
  const bundleFiles = await verifyBundleFiles(bundleRoot, manifest);
  const authorityPath = bundleFiles.get('authority.json');
  if (!authorityPath) throw new Error('R1B_SMOKE_BUNDLE_AUTHORITY_MISSING');
  const authority = JSON.parse(await readFile(authorityPath, 'utf8')) as PortableAuthorityV1;
  assertExactKeys(
    authority as unknown as Record<string, unknown>,
    [
      'schema_version',
      'authority_mode',
      'job_id',
      'request',
      'logical_plan',
      'render_policy',
      'original_execution_snapshot_hash',
      'original_execution_platform',
      'original_execution_architecture',
      'source_bindings',
      'narration_binding',
    ],
    'R1B_SMOKE_BUNDLE_AUTHORITY_KEYS_INVALID',
  );
  if (
    authority.schema_version !== '1.0' ||
    authority.authority_mode !== 'HISTORICAL_ACCEPTED_CHAIN' ||
    authority.job_id !== manifest.job_id
  ) {
    throw new Error('R1B_SMOKE_BUNDLE_AUTHORITY_INVALID');
  }
  const plan = parseLogicalRenderPlanV1(authority.logical_plan);
  const policy = parseRenderPolicyV1(authority.render_policy);
  if (
    plan.logical_render_hash !== manifest.logical_render_hash ||
    plan.timeline_id !== manifest.timeline_id ||
    plan.timeline_version !== manifest.timeline_version ||
    plan.timeline_commit_receipt_hash !== manifest.timeline_commit_receipt_hash ||
    policy.policy_hash !== manifest.render_policy_hash ||
    policy.policy_id !== manifest.render_policy_id ||
    policy.policy_version !== manifest.render_policy_version ||
    authority.original_execution_snapshot_hash !== manifest.original_execution_snapshot_hash ||
    authority.request.timeline_id !== plan.timeline_id ||
    authority.request.timeline_version !== plan.timeline_version ||
    authority.request.expected_timeline_commit_receipt_hash !== plan.timeline_commit_receipt_hash ||
    authority.request.render_policy_hash !== plan.render_policy_hash
  ) {
    throw new Error('R1B_SMOKE_BUNDLE_LOGICAL_AUTHORITY_MISMATCH');
  }
  const controlledRoot = await freshDirectory(input.controlled_root);
  const stagingRoot = join(controlledRoot, 'staging');
  const outputRoot = join(controlledRoot, 'output');
  await Promise.all([mkdir(stagingRoot), mkdir(outputRoot)]);
  const importedPaths = new Map<string, string>();
  for (const file of manifest.files.filter((item) => item.role !== 'AUTHORITY')) {
    const relativePath = safeRelativePath(file.relative_path);
    const source = bundleFiles.get(relativePath);
    if (!source) throw new Error('R1B_SMOKE_BUNDLE_FILE_MISSING');
    const destination = join(stagingRoot, ...relativePath.split('/'));
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(source, destination, 0);
    const facts = await lstat(destination);
    if (facts.size !== file.size_bytes || (await hashFile(destination)) !== file.sha256) {
      throw new Error('R1B_SMOKE_IMPORT_HASH_MISMATCH');
    }
    importedPaths.set(relativePath, destination);
  }
  const runtimeRoot = await realpath(input.runtime_root);
  const runtimeIdentityPath = await exactRegularFile(
    input.runtime_identity_path,
    'R1B_SMOKE_RUNTIME_IDENTITY_INVALID',
  );
  if (
    !relative(runtimeRoot, runtimeIdentityPath) ||
    relative(runtimeRoot, runtimeIdentityPath).startsWith(`..${sep}`)
  ) {
    throw new Error('R1B_SMOKE_RUNTIME_IDENTITY_PATH_ESCAPE');
  }
  const runtimeIdentity = renderRuntimeIdentityV1Schema.parse(
    JSON.parse(await readFile(runtimeIdentityPath, 'utf8')) as unknown,
  );
  if (
    runtimeIdentity.capability_profile_version < 2 ||
    runtimeIdentity.capability_profile_hash === manifest.original_runtime_profile_hash
  ) {
    throw new Error('R1B_SMOKE_ROTATION_RUNTIME_V2_REQUIRED');
  }
  const sourceArtifacts = authority.source_bindings.map((binding) => {
    const path = importedPaths.get(safeRelativePath(binding.relative_path));
    if (!path) throw new Error('R1B_SMOKE_SOURCE_BINDING_MISSING');
    return {
      authority_sha256: binding.authority_sha256,
      source_path: path,
      staged_path: path,
      staged_sha256: binding.authority_sha256,
      size_bytes: binding.size_bytes,
      segment_ids: [...binding.segment_ids],
    };
  });
  const narrationPath = importedPaths.get(
    safeRelativePath(authority.narration_binding.relative_path),
  );
  if (!narrationPath) throw new Error('R1B_SMOKE_NARRATION_BINDING_MISSING');
  const snapshot = buildExecutionSnapshotV1({
    logical_render_hash: plan.logical_render_hash,
    platform: 'win32',
    architecture: 'x64',
    staging_root: stagingRoot,
    output_root: outputRoot,
    source_artifacts: sourceArtifacts,
    narration_artifact: {
      authority_sha256: authority.narration_binding.authority_sha256,
      source_path: narrationPath,
      staged_path: narrationPath,
      staged_sha256: authority.narration_binding.authority_sha256,
      size_bytes: authority.narration_binding.size_bytes,
    },
    runtime_identity: runtimeIdentity,
  });
  const dbPath = join(controlledRoot, 'app.db');
  const { db } = await openDatabase({ dbPath, migrationsDirectory: input.migrations_directory });
  try {
    new RenderPolicyRepository(db).register(policy);
    if (!authority.job_id.startsWith('render_job_')) throw new Error('R1B_SMOKE_JOB_ID_INVALID');
    const preparations = new RenderPreparationRepository(db, {
      id: () => authority.job_id.slice('render_job_'.length),
    });
    let job = preparations.begin(authority.request);
    if (job.job_id !== authority.job_id) throw new Error('R1B_SMOKE_JOB_ID_MISMATCH');
    job = preparations.markEntryValidated(job.job_id);
    job = preparations.recordLogicalPlan(job.job_id, plan);
    job = preparations.markStaging(job.job_id);
    preparations.recordReady({
      job_id: job.job_id,
      snapshot,
      artifacts: [
        ...snapshot.source_artifacts.map((artifact, index) => ({
          artifact_record_id: `${job.job_id}:imported-source:${index}`,
          artifact_role: 'STAGED_SOURCE' as const,
          authority_sha256: artifact.authority_sha256,
          artifact_sha256: artifact.staged_sha256,
          size_bytes: artifact.size_bytes,
          managed_path: artifact.staged_path,
          artifact_json: canonicalJson(artifact),
        })),
        {
          artifact_record_id: `${job.job_id}:imported-narration`,
          artifact_role: 'STAGED_NARRATION' as const,
          authority_sha256: snapshot.narration_artifact.authority_sha256,
          artifact_sha256: snapshot.narration_artifact.staged_sha256,
          size_bytes: snapshot.narration_artifact.size_bytes,
          managed_path: snapshot.narration_artifact.staged_path,
          artifact_json: canonicalJson(snapshot.narration_artifact),
        },
      ],
    });
  } finally {
    db.close();
  }
  const smokeConfigPath = join(controlledRoot, 'smoke-config.json');
  await writeFile(
    smokeConfigPath,
    `${canonicalJson({
      schema_version: '1.0',
      authority_mode: 'HISTORICAL_ACCEPTED_CHAIN',
      job_id: authority.job_id,
      db_path: dbPath,
      migrations_directory: input.migrations_directory,
      staging_root: stagingRoot,
      output_root: outputRoot,
      runtime_root: input.runtime_root,
      approval_receipt_path: input.approval_receipt_path,
      expected_timeline_id: plan.timeline_id,
      expected_timeline_version: plan.timeline_version,
      expected_timeline_commit_receipt_hash: plan.timeline_commit_receipt_hash,
      expected_logical_render_hash: plan.logical_render_hash,
      smoke_bundle_manifest_hash: manifest.manifest_hash,
      smoke_bundle_hash: manifest.bundle_hash,
    })}\n`,
    { flag: 'wx' },
  );
  return {
    manifest_hash: manifest.manifest_hash,
    bundle_hash: manifest.bundle_hash,
    job_id: authority.job_id,
    db_path: dbPath,
    smoke_config_path: smokeConfigPath,
  };
}
