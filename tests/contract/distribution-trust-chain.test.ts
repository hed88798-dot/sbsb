import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentHash, verifyTrustChain } from '../../tools/python-supply-chain/trust-chain.mjs';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceCommit = 'a'.repeat(40);
const sourceTree = 'b'.repeat(40);
const targetSha = digest('target');
const workerSha = digest('worker');
const carchiveSha = digest('carchive');
const archiveContainerSha = digest('archive-container');

function withSelfHash<T extends Record<string, unknown>>(document: T, field: string): T {
  return { ...document, [field]: documentHash(document, field) };
}

function writeBundle(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'distribution-trust-chain-'));
  const recipe = withSelfHash(
    {
      schema_version: '1',
      recipe_id: 'recipe-v1-linux',
      recipe_sha256: '',
      freeze_status: 'PRE_BUILD_FROZEN',
      frozen_before_build: true,
      source_identity: {
        repository_id: 'hed88798-dot/sbsb',
        commit_sha: sourceCommit,
        tree_sha: sourceTree,
        submodule_state: 'NONE',
        untracked_build_input_count: 0,
      },
      product_source: {
        repository_id: 'hed88798-dot/sbsb',
        source_commit_sha: sourceCommit,
        source_tree_sha: sourceTree,
        submodule_state: 'NONE',
        untracked_build_input_count: 0,
      },
      pyinstaller_spec: { path: 'sidecars/media-worker/worker.spec', sha256: digest('spec') },
      python_target: { descriptor_id: 'target-linux-cp313', descriptor_sha256: targetSha },
      cpython_exact_artifact_sha256: digest('cpython'),
      inventory_approved_subject_set_sha256: digest('inventory'),
      toolchain_approved_subject_set_sha256: digest('toolchain'),
      exact_build_dependency_artifacts: [
        {
          subject_id: 'cpython-3.13.15-linux',
          filename: 'python.tar.gz',
          sha256: digest('cpython'),
          role: 'RUNTIME',
        },
      ],
      pyinstaller_artifact: {
        subject_id: 'pyinstaller-6.22.2',
        filename: 'pyinstaller.whl',
        sha256: digest('pyinstaller'),
      },
      pyinstaller_hooks_contrib_artifact: {
        subject_id: 'hooks-2026.7',
        filename: 'hooks.whl',
        sha256: digest('hooks'),
      },
      build_command: 'python3.13',
      command_arguments: ['-m', 'PyInstaller', 'sidecars/media-worker/worker.spec'],
      working_directory_semantics: 'REPOSITORY_ROOT',
      environment_variable_allowlist: ['CI', 'SOURCE_DATE_EPOCH'],
      environment_variable_values: { CI: 'true', SOURCE_DATE_EPOCH: '0' },
      dependency_resolution_mode: 'LOCKFILE_EXACT_NO_NEW_RESOLUTION',
      network_policy: 'NO_NETWORK',
      sdist_build_policy: 'FORBIDDEN',
      unapproved_artifact_download_policy: 'FORBIDDEN',
      expected_output_layout: ['dist/media-worker', 'dist/media-worker.carchive'],
    },
    'recipe_sha256',
  );
  const environment = withSelfHash(
    {
      schema_version: '1',
      descriptor_id: 'environment-linux-2026-09',
      descriptor_sha256: '',
      descriptor_bytes_retained: true,
      platform: { os: 'linux', architecture: 'x86_64' },
      os: { name: 'linux', version: '24.04', build: 'ubuntu-24.04' },
      runtime_tools: { node: '24.19.0', pnpm: '11.19.0', python: '3.13.15', electron: '43.4.1' },
      python_executable: {
        identity: 'cpython-3.13.15-linux',
        version: '3.13.15',
        sha256: digest('python-executable'),
      },
      pyinstaller: {
        version: '6.22.2',
        artifact_id: 'pyinstaller-6.22.2',
        artifact_sha256: digest('pyinstaller'),
      },
      native_toolchain: {
        compiler: 'gcc',
        version: '13.3.0',
        sdk: 'ubuntu-24.04',
        identity: 'gcc-13.3.0',
      },
      locale: 'C.UTF-8',
      timezone: 'UTC',
      relevant_environment_variables: { CI: 'true', SOURCE_DATE_EPOCH: '0' },
      runner_image_identity: {
        provider: 'github-actions',
        image: 'ubuntu-24.04',
        image_digest: 'sha256:runner-image',
      },
      storage: {
        channel_class: 'PROJECT_CONTROLLED_LOCAL_COLD_ARCHIVE',
        portable_logical_locator: 'cold-archive://descriptors/environment-linux-2026-09',
      },
    },
    'descriptor_sha256',
  );
  const context = withSelfHash(
    {
      schema_version: '1',
      context_id: 'context-linux-2026-09',
      context_sha256: '',
      created_before_build: true,
      status: 'FROZEN_BEFORE_BUILD',
      source_identity: recipe.source_identity,
      build_recipe: { recipe_id: recipe.recipe_id, recipe_sha256: recipe.recipe_sha256 },
      environment_descriptor: {
        descriptor_id: environment.descriptor_id,
        descriptor_sha256: environment.descriptor_sha256,
      },
      inventory_approved_subject_set_sha256: recipe.inventory_approved_subject_set_sha256,
      toolchain_approved_subject_set_sha256: recipe.toolchain_approved_subject_set_sha256,
      target_descriptor: recipe.python_target,
      cpython_exact_artifact_sha256: recipe.cpython_exact_artifact_sha256,
      pyinstaller_spec: recipe.pyinstaller_spec,
      build_policy: {
        dependency_resolution: recipe.dependency_resolution_mode,
        network: recipe.network_policy,
        sdist_build: recipe.sdist_build_policy,
        unapproved_download: recipe.unapproved_artifact_download_policy,
      },
      created_at: '2026-09-03T00:00:00Z',
    },
    'context_sha256',
  );
  const candidate = withSelfHash(
    {
      schema_version: '1',
      candidate_id: 'candidate-linux-2026-09',
      candidate_sha256: '',
      platform: { os: 'linux', architecture: 'x86_64' },
      source_identity: recipe.source_identity,
      build_context: { context_id: context.context_id, context_sha256: context.context_sha256 },
      worker: { filename: 'media-worker', sha256: workerSha, size_bytes: 100 },
      carchive: { filename: 'media-worker.carchive', sha256: carchiveSha, size_bytes: 200 },
      archive_container: {
        filename: 'candidate.tar',
        sha256: archiveContainerSha,
        size_bytes: 300,
      },
      status: 'FROZEN_CANDIDATE',
      issued_at: '2026-09-03T00:01:00Z',
    },
    'candidate_sha256',
  );
  const retention = withSelfHash(
    {
      schema_version: '1',
      receipt_id: 'receipt-linux-2026-09',
      receipt_sha256: '',
      candidate_id: candidate.candidate_id,
      platform: candidate.platform,
      worker: { sha256: candidate.worker.sha256, size_bytes: candidate.worker.size_bytes },
      carchive: { sha256: candidate.carchive.sha256, size_bytes: candidate.carchive.size_bytes },
      build_recipe: { id: recipe.recipe_id, sha256: recipe.recipe_sha256 },
      environment_descriptor: {
        id: environment.descriptor_id,
        sha256: environment.descriptor_sha256,
      },
      build_context: { id: context.context_id, sha256: context.context_sha256 },
      storage_channel_class: 'PROJECT_CONTROLLED_LOCAL_COLD_ARCHIVE',
      primary_copy: {
        copy_id: 'primary-linux-2026-09',
        storage_locator: 'cold-archive://frozen-candidates/candidate-linux-2026-09/linux/primary',
        storage_location_identity: 'external-disk-a',
        archived_object_sha256: archiveContainerSha,
        availability_status: 'AVAILABLE',
      },
      secondary_copy: {
        copy_id: 'secondary-linux-2026-09',
        storage_locator: 'cold-archive://frozen-candidates/candidate-linux-2026-09/linux/secondary',
        storage_location_identity: 'external-disk-b',
        archived_object_sha256: archiveContainerSha,
        availability_status: 'AVAILABLE',
      },
      archived_at: '2026-09-03T00:02:00Z',
      retention_state: 'FROZEN_CANDIDATE',
      recovery_procedure_version: '1',
      availability_verification_timestamp: '2026-09-03T00:03:00Z',
    },
    'receipt_sha256',
  );
  const recovery = withSelfHash(
    {
      schema_version: '1',
      drill_id: 'drill-linux-2026-09',
      drill_sha256: '',
      candidate_id: candidate.candidate_id,
      retention_receipt_id: retention.receipt_id,
      procedure_version: '1',
      recovery_location: 'cold-archive://recovery-drills/candidate-linux-2026-09',
      primary_recovery: {
        source_copy_id: retention.primary_copy.copy_id,
        worker_sha256: workerSha,
        carchive_sha256: carchiveSha,
        status: 'PASS',
      },
      secondary_availability: {
        copy_id: retention.secondary_copy.copy_id,
        status: 'PASS',
        verified_at: '2026-09-03T00:03:00Z',
      },
      status: 'PASS',
      verified_at: '2026-09-03T00:03:00Z',
    },
    'drill_sha256',
  );
  const records = { recipe, environment, context, candidate, retention, recovery };
  for (const [name, value] of Object.entries({ ...records, ...overrides })) {
    writeFileSync(join(root, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }
  return Object.fromEntries(Object.keys(records).map((name) => [name, join(root, `${name}.json`)]));
}

describe('distribution trust-chain checkpoint', () => {
  it('accepts a pre-build-frozen candidate with independent retention and recovery evidence', () => {
    expect(() => verifyTrustChain(writeBundle())).not.toThrow();
  });

  it('fails closed when exact bytes were not recovered', () => {
    const paths = writeBundle();
    const recovery = JSON.parse(readFileSync(paths.recovery, 'utf8'));
    recovery.primary_recovery.worker_sha256 = digest('different-worker');
    writeFileSync(
      paths.recovery,
      `${JSON.stringify({ ...recovery, drill_sha256: documentHash(recovery, 'drill_sha256') }, null, 2)}\n`,
    );
    expect(() => verifyTrustChain(paths)).toThrow(/recovered Worker hash/);
  });

  it('fails closed when the two retention copies are not independent', () => {
    const paths = writeBundle();
    const retention = JSON.parse(readFileSync(paths.retention, 'utf8'));
    retention.secondary_copy.storage_locator = retention.primary_copy.storage_locator;
    retention.receipt_sha256 = documentHash(retention, 'receipt_sha256');
    writeFileSync(paths.retention, `${JSON.stringify(retention, null, 2)}\n`);
    expect(() => verifyTrustChain(paths)).toThrow(/locators must be independent/);
  });

  it('fails closed when descriptor bytes are not retained', () => {
    const paths = writeBundle();
    const environment = JSON.parse(readFileSync(paths.environment, 'utf8'));
    environment.descriptor_bytes_retained = false;
    environment.descriptor_sha256 = documentHash(environment, 'descriptor_sha256');
    writeFileSync(paths.environment, `${JSON.stringify(environment, null, 2)}\n`);
    expect(() => verifyTrustChain(paths)).toThrow(/schema invalid/);
  });
});
