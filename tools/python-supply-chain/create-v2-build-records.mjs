import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonical, documentHash } from './trust-chain.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const schemaRoot = resolve(repositoryRoot, 'schemas/compliance/distribution-trust-chain/v2');
const sha256Pattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9][a-z0-9._:-]{2,191}$/u;

function arg(values, name, fallback = null) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : fallback;
}

function required(values, name) {
  const value = arg(values, name);
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function absolute(value) {
  return resolve(repositoryRoot, value);
}

function readJson(path) {
  return JSON.parse(readFileSync(absolute(path), 'utf8'));
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function portablePath(path) {
  const value = relative(repositoryRoot, path).replaceAll('\\', '/');
  if (!value || value.startsWith('../') || value.startsWith('/')) {
    throw new Error(`build input is outside repository: ${path}`);
  }
  return value;
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRecord(path, record, hashField) {
  record[hashField] = documentHash(record, hashField);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return {
    path: portablePath(path),
    id: record.recipe_id || record.descriptor_id || record.context_id,
    sha256: record[hashField],
  };
}

function inventoryArtifacts(paths) {
  const artifacts = new Map();
  for (const [inventoryPath, role] of paths) {
    const inventory = readJson(inventoryPath);
    for (const packageEntry of inventory.packages ?? []) {
      const subjectId = `${packageEntry.package_name}-${packageEntry.version}`
        .toLowerCase()
        .replace(/[^a-z0-9._:-]+/gu, '-');
      const artifact = {
        subject_id: subjectId,
        filename: String(packageEntry.filename),
        sha256: String(packageEntry.sha256),
        role,
      };
      const previous = artifacts.get(subjectId);
      if (previous) {
        if (previous.filename !== artifact.filename || previous.sha256 !== artifact.sha256) {
          throw new Error(`conflicting approved build artifact: ${subjectId}`);
        }
        // An artifact used by both runtime and build scopes is represented once;
        // the runtime role is the stricter (and therefore authoritative) role.
        if (previous.role !== 'RUNTIME' && artifact.role === 'RUNTIME') previous.role = 'RUNTIME';
        continue;
      }
      artifacts.set(subjectId, artifact);
    }
  }
  return [...artifacts.values()].sort((left, right) =>
    left.subject_id.localeCompare(right.subject_id),
  );
}

function findWheel(root, filename) {
  const expected = filename.toLowerCase();
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.toLowerCase() === expected) return path;
    }
  }
  throw new Error(`approved wheel is missing from ${root}: ${filename}`);
}

function commandArguments(target, spec, workpath, distpath) {
  if (target === 'windows') {
    return [
      '-I',
      'tools/code-c-python-supply-chain/run_hermetic_pyinstaller.py',
      '--manifest',
      'artifacts/python-supply-chain/pyinstaller-build/windows/build-environment-manifest.json',
      '--build-context',
      'artifacts/python-supply-chain/pyinstaller-build/windows/build-context.json',
      '--build-log',
      'artifacts/python-supply-chain/pyinstaller-build/windows/raw/pyinstaller-build.log',
    ];
  }
  return [
    '-I',
    '-m',
    'PyInstaller',
    '--clean',
    '--noconfirm',
    '--workpath',
    workpath,
    '--distpath',
    distpath,
    spec,
  ];
}

function validate(records) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = {
    recipe: JSON.parse(readFileSync(join(schemaRoot, 'build-recipe.schema.json'), 'utf8')),
    environment: JSON.parse(
      readFileSync(join(schemaRoot, 'build-environment.schema.json'), 'utf8'),
    ),
    context: JSON.parse(readFileSync(join(schemaRoot, 'build-context.schema.json'), 'utf8')),
  };
  for (const [kind, record] of Object.entries(records)) {
    const valid = ajv.compile(schemas[kind])(record);
    if (!valid) {
      const detail = (ajv.errors ?? [])
        .map((error) => `${error.instancePath || '/'} ${error.message}`)
        .join('; ');
      throw new Error(`${kind} v2 schema validation failed: ${detail}`);
    }
    const hashField =
      kind === 'recipe'
        ? 'recipe_sha256'
        : kind === 'environment'
          ? 'descriptor_sha256'
          : 'context_sha256';
    if (record[hashField] !== documentHash(record, hashField)) {
      throw new Error(`${kind} hash does not match canonical record bytes`);
    }
  }
}

function main() {
  const values = process.argv.slice(2);
  const target = required(values, '--target');
  if (!['linux', 'windows'].includes(target)) throw new Error('--target must be linux or windows');
  const contextPath = absolute(required(values, '--context'));
  const targetPath = absolute(required(values, '--target-descriptor'));
  const runtimeInventoryPath = required(values, '--runtime-inventory');
  const workerInventoryPath = required(values, '--worker-build-inventory');
  const toolchainInventoryPath = required(values, '--toolchain-inventory');
  const specPath = absolute(required(values, '--spec'));
  const cpythonPath = absolute(required(values, '--cpython-distribution'));
  const pipPath = absolute(required(values, '--pip-wheel'));
  const pyinstallerPath = absolute(required(values, '--pyinstaller-wheel'));
  const wheelRoot = absolute(required(values, '--wheel-root'));
  const lockedPythonPath = absolute(required(values, '--locked-python'));
  const outputRoot = absolute(required(values, '--output-root'));

  for (const path of [
    contextPath,
    targetPath,
    specPath,
    cpythonPath,
    pipPath,
    pyinstallerPath,
    lockedPythonPath,
  ]) {
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error(`required build record input is missing: ${path}`);
  }
  const contextV1 = JSON.parse(readFileSync(contextPath, 'utf8'));
  const targetDescriptor = JSON.parse(readFileSync(targetPath, 'utf8'));
  if (
    targetDescriptor.os !== target ||
    targetDescriptor.architecture !== 'x86_64' ||
    targetDescriptor.python_version !== '3.13.15'
  ) {
    throw new Error(
      'approved target descriptor does not bind the requested CPython 3.13.15 x86-64 target',
    );
  }
  const sourceCommit = run('git', ['rev-parse', 'HEAD']);
  const sourceTree = run('git', ['rev-parse', 'HEAD^{tree}']);
  if (contextV1.inputs?.code_c_commit && contextV1.inputs.code_c_commit !== sourceCommit) {
    throw new Error('v1 build context source commit does not match current checkout');
  }
  if (
    contextV1.inputs?.target?.os &&
    (contextV1.inputs.target.os !== target || contextV1.inputs.target.architecture !== 'x86_64')
  ) {
    throw new Error('v1 build context target does not match the requested x86-64 target');
  }
  const submoduleState = (() => {
    try {
      return run('git', ['submodule', 'status']) || 'NONE';
    } catch {
      return 'NONE';
    }
  })();
  const sourceIdentity = {
    repository_id: process.env.GITHUB_REPOSITORY || 'local/ai-video-platform',
    commit_sha: sourceCommit,
    tree_sha: sourceTree,
    submodule_state: submoduleState,
    untracked_build_input_count: 0,
  };
  const targetHash = sha256File(targetPath);
  const targetId = `code-c-target-${targetHash.slice(0, 32)}`;
  if (!idPattern.test(targetId) || !sha256Pattern.test(targetHash))
    throw new Error('target descriptor identity is invalid');
  const runtimeInventory = readJson(runtimeInventoryPath);
  const workerInventory = readJson(workerInventoryPath);
  const toolchainInventory = readJson(toolchainInventoryPath);
  const runtimeInventoryHash = sha256File(absolute(runtimeInventoryPath));
  const workerInventoryHash = sha256File(absolute(workerInventoryPath));
  const toolchainInventoryHash = sha256File(absolute(toolchainInventoryPath));
  const inventorySetHash = createHash('sha256')
    .update(
      JSON.stringify(
        canonical([
          { inventory_id: runtimeInventory.inventory_id, sha256: runtimeInventoryHash },
          { inventory_id: workerInventory.inventory_id, sha256: workerInventoryHash },
        ]),
      ),
    )
    .digest('hex');
  const toolchainSetHash = createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          inventory_id:
            toolchainInventory.inventory_id ||
            toolchainInventory.toolchain_id ||
            basename(toolchainInventoryPath),
          sha256: toolchainInventoryHash,
        }),
      ),
    )
    .digest('hex');
  const pyinstallerFilename = basename(pyinstallerPath);
  const hooksFilename = (workerInventory.packages ?? []).find(
    (entry) =>
      String(entry.package_name).toLowerCase().replaceAll('_', '-') === 'pyinstaller-hooks-contrib',
  )?.filename;
  if (!hooksFilename)
    throw new Error('worker-build inventory does not contain pyinstaller-hooks-contrib');
  const hooksPath = findWheel(wheelRoot, hooksFilename);
  const pipFilename = basename(pipPath);
  const cpythonHash = contextV1.inputs?.cpython_artifact?.sha256 || sha256File(cpythonPath);
  const cpythonFilename = contextV1.inputs?.cpython_artifact?.filename || basename(cpythonPath);
  const specHash = sha256File(specPath);
  const recipeId = `code-c-recipe-${sourceCommit.slice(0, 32)}-${target}`;
  const environmentId = `code-c-environment-${sourceCommit.slice(0, 32)}-${target}`;
  const contextId = `code-c-context-${sourceCommit.slice(0, 32)}-${target}`;
  const environmentValues = {};
  for (const name of [
    'CI',
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_REPOSITORY',
    'RUNNER_OS',
    'RUNNER_ARCH',
    'ImageOS',
    'ImageVersion',
  ]) {
    if (process.env[name] !== undefined) environmentValues[name] = process.env[name];
  }
  const pythonVersion = run(lockedPythonPath, ['--version']);
  const nodeVersion = process.version;
  const pnpmVersion = (() => {
    try {
      return run('pnpm', ['--version']);
    } catch {
      return 'pnpm-unavailable';
    }
  })();
  const image = process.env.ImageOS || process.env.RUNNER_OS || target;
  const imageDigest = process.env.ImageVersion || process.env.RUNNER_IMAGE_DIGEST || image;
  const nativeCompiler = target === 'windows' ? 'MSVC' : 'gcc';
  const nativeVersion =
    target === 'windows'
      ? process.env.VCToolsVersion ||
        process.env.WindowsSdkVersion ||
        'GitHub-hosted-windows-toolchain'
      : (() => {
          try {
            return run('gcc', ['--version']).split('\n')[0];
          } catch {
            return 'GitHub-hosted-linux-toolchain';
          }
        })();
  const recipe = {
    schema_version: '2',
    recipe_id: recipeId,
    recipe_sha256: '',
    freeze_status: 'PRE_BUILD_FROZEN',
    frozen_before_build: true,
    source_identity: sourceIdentity,
    product_source: {
      repository_id: sourceIdentity.repository_id,
      source_commit_sha: sourceCommit,
      source_tree_sha: sourceTree,
      submodule_state: submoduleState,
      untracked_build_input_count: 0,
    },
    pyinstaller_spec: { path: portablePath(specPath), sha256: specHash },
    python_target: { descriptor_id: targetId, descriptor_sha256: targetHash },
    cpython_exact_artifact_sha256: cpythonHash,
    inventory_approved_subject_set_sha256: inventorySetHash,
    toolchain_approved_subject_set_sha256: toolchainSetHash,
    exact_build_dependency_artifacts: [
      {
        subject_id: `cpython-${target}-3.13.15`,
        filename: cpythonFilename,
        sha256: cpythonHash,
        role: 'RUNTIME',
      },
      ...inventoryArtifacts([
        [runtimeInventoryPath, 'RUNTIME'],
        [workerInventoryPath, 'BUILD_TOOLCHAIN'],
      ]),
      {
        subject_id: `pip-${basename(pipPath).replace(/[^a-z0-9._:-]+/giu, '-')}`,
        filename: pipFilename,
        sha256: sha256File(pipPath),
        role: 'BUILD_TOOLCHAIN',
      },
    ],
    pyinstaller_artifact: {
      subject_id: `pyinstaller-${contextV1.inputs?.pyinstaller_artifact?.version || '6.22.2'}`,
      filename: pyinstallerFilename,
      sha256: sha256File(pyinstallerPath),
    },
    pyinstaller_hooks_contrib_artifact: {
      subject_id: `pyinstaller-hooks-contrib-${workerInventory.packages.find((entry) => entry.filename === hooksFilename)?.version || 'unknown'}`,
      filename: hooksFilename,
      sha256: sha256File(hooksPath),
    },
    // Keep authority-bearing records portable; the exact executable bytes are
    // bound separately by environment.python_executable.sha256.
    build_command: 'locked-python',
    command_arguments: commandArguments(
      target,
      portablePath(specPath),
      `artifacts/python-supply-chain/pyinstaller-build/${target}/work`,
      `artifacts/python-supply-chain/pyinstaller-build/${target}/dist`,
    ),
    working_directory_semantics: 'REPOSITORY_ROOT',
    environment_variable_allowlist: Object.keys(environmentValues).sort(),
    environment_variable_values: environmentValues,
    dependency_resolution_mode: 'LOCKFILE_EXACT_NO_NEW_RESOLUTION',
    network_policy: 'DECLARED_READ_ONLY_ALLOWLIST',
    sdist_build_policy: 'FORBIDDEN',
    unapproved_artifact_download_policy: 'FORBIDDEN',
    expected_output_layout: [
      `artifacts/python-supply-chain/pyinstaller-build/${target}/dist/`,
      `artifacts/python-supply-chain/pyinstaller-build/${target}/work/`,
    ],
  };
  const environment = {
    schema_version: '2',
    descriptor_id: environmentId,
    descriptor_sha256: '',
    descriptor_bytes_retained: true,
    platform: { os: target, architecture: 'x86_64' },
    os: {
      name: target,
      version: process.env.ImageVersion || process.env.RUNNER_OS || target,
      build: process.env.ImageVersion || process.env.RUNNER_OS || target,
    },
    runtime_tools: {
      node: nodeVersion,
      pnpm: pnpmVersion,
      python: pythonVersion,
      electron: 'NOT_USED_FOR_WORKER_BUILD',
    },
    python_executable: {
      identity: basename(lockedPythonPath),
      version: pythonVersion,
      sha256: sha256File(lockedPythonPath),
    },
    pyinstaller: {
      version: contextV1.inputs?.pyinstaller_artifact?.version || '6.22.2',
      artifact_id: recipe.pyinstaller_artifact.subject_id,
      artifact_sha256: recipe.pyinstaller_artifact.sha256,
    },
    native_toolchain: {
      compiler: nativeCompiler,
      version: nativeVersion,
      sdk:
        target === 'windows'
          ? process.env.WindowsSdkVersion || 'GitHub-hosted-windows-sdk'
          : process.env.ImageVersion || 'GitHub-hosted-linux-sdk',
      identity: `${nativeCompiler}:${nativeVersion}`,
    },
    locale: process.env.LC_ALL || process.env.LANG || 'C.UTF-8',
    timezone: process.env.TZ || 'UTC',
    relevant_environment_variables: environmentValues,
    runner_image_identity: { provider: 'github-actions', image, image_digest: imageDigest },
    storage: {
      channel_class: 'PROJECT_CONTROLLED_LOCAL_COLD_ARCHIVE',
      portable_logical_locator: `cold-archive://frozen-candidates/${sourceCommit.slice(0, 32)}/${target}`,
    },
  };
  const context = {
    schema_version: '2',
    context_id: contextId,
    context_sha256: '',
    created_before_build: true,
    status: 'FROZEN_BEFORE_BUILD',
    source_identity: sourceIdentity,
    build_recipe: { recipe_id: recipeId, recipe_sha256: '' },
    environment_descriptor: { descriptor_id: environmentId, descriptor_sha256: '' },
    inventory_approved_subject_set_sha256: inventorySetHash,
    toolchain_approved_subject_set_sha256: toolchainSetHash,
    target_descriptor: { descriptor_id: targetId, descriptor_sha256: targetHash },
    cpython_exact_artifact_sha256: cpythonHash,
    pyinstaller_spec: { path: portablePath(specPath), sha256: specHash },
    build_policy: {
      dependency_resolution: 'LOCKFILE_EXACT_NO_NEW_RESOLUTION',
      network: 'DECLARED_READ_ONLY_ALLOWLIST',
      sdist_build: 'FORBIDDEN',
      unapproved_download: 'FORBIDDEN',
    },
    created_at: new Date().toISOString(),
  };
  recipe.recipe_sha256 = documentHash(recipe, 'recipe_sha256');
  environment.descriptor_sha256 = documentHash(environment, 'descriptor_sha256');
  context.build_recipe.recipe_sha256 = recipe.recipe_sha256;
  context.environment_descriptor.descriptor_sha256 = environment.descriptor_sha256;
  context.context_sha256 = documentHash(context, 'context_sha256');
  validate({ recipe, environment, context });
  const targetRoot = join(outputRoot, target);
  const recipeRecord = writeRecord(join(targetRoot, 'build-recipe.json'), recipe, 'recipe_sha256');
  const environmentRecord = writeRecord(
    join(targetRoot, 'build-environment.json'),
    environment,
    'descriptor_sha256',
  );
  const contextRecord = writeRecord(
    join(targetRoot, 'build-context.json'),
    context,
    'context_sha256',
  );
  writeFileSync(
    join(targetRoot, 'records-summary.json'),
    `${JSON.stringify({ schema_version: '2', target, recipe: recipeRecord, environment: environmentRecord, context: contextRecord }, null, 2)}\n`,
    'utf8',
  );
  console.log(`distribution-trust-chain-records: PASS (${target}; ${contextId})`);
}

try {
  main();
} catch (error) {
  console.error(`distribution-trust-chain-records: FAIL\n${error.message}`);
  process.exitCode = 1;
}
