import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  dependencyPaths,
  loadInventories,
  normalizePythonName,
  sha256File,
  verifyArtifactInventories,
} from '../python-supply-chain/inventory.mjs';
import { writeCanonicalJson } from './canonical-evidence.mjs';
import {
  createArtifactLicenseEvidenceV3,
  validateArtifactLicenseEvidenceV3,
} from '../license-policy/artifact-review.mjs';
import { evaluateLicenseEvidence, licenseIdentityHash } from '../license-policy/evaluator.mjs';

const REQUIRED_BASELINE = 'd1348c50e36b725bfcbf9bec17343392cf0412c7';

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', shell: false }).trim();
}

function scopeRole(scope) {
  return scope === 'PRODUCTION_WORKER_RUNTIME'
    ? { artifact_role: 'RUNTIME_WHEEL', distribution_role: 'RUNTIME_DISTRIBUTION' }
    : { artifact_role: 'PYTHON_BUILD_DEPENDENCY', distribution_role: 'BUILD_ONLY_USE' };
}

function relativeRepositoryPath(path) {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

function inventoryScopeName(path) {
  const name = basename(path);
  if (!name.endsWith('.v2.json')) throw new Error(`unexpected inventory filename: ${name}`);
  return name.slice(0, -'.v2.json'.length);
}

function evidenceStatus(inspected) {
  if (inspected.license_expression?.trim()) return 'PASS';
  if (
    inspected.legacy_license?.trim() ||
    inspected.license_classifiers.length > 0 ||
    inspected.license_files.length > 0
  ) {
    return 'MANUAL_REVIEW';
  }
  return 'FAIL';
}

function canonicalArtifact(artifact) {
  return {
    package: normalizePythonName(artifact.package_name),
    version: artifact.version,
    filename: artifact.filename,
    sha256: artifact.sha256,
    purl: artifact.purl,
  };
}

async function main() {
  const target = argument('--target');
  if (!['linux', 'windows'].includes(target)) throw new Error(`unsupported target: ${target}`);
  const inventoryRoot = resolve(argument('--inventory-root'));
  const artifactRoot = resolve(argument('--artifact-root'));
  const resolutionRoot = resolve(argument('--resolution-root'));
  const buildContextPath = resolve(argument('--build-context'));
  const outputRoot = resolve(argument('--output-root'));
  const mainBaseline = argument('--main-quality-baseline');
  if (mainBaseline !== REQUIRED_BASELINE) {
    throw new Error(`main quality baseline must be ${REQUIRED_BASELINE}`);
  }
  git('merge-base', '--is-ancestor', mainBaseline, 'HEAD');
  const head = git('rev-parse', 'HEAD');
  // Avoid shell globbing so paths with spaces behave the same on both targets.
  const paths = readdirSync(inventoryRoot)
    .filter((name) => name.endsWith('.v2.json'))
    .map((name) => resolve(inventoryRoot, name));
  paths.sort();
  const loaded = loadInventories(paths);
  const verified = await verifyArtifactInventories(loaded, artifactRoot);
  const byHash = new Map();
  for (const item of verified) {
    const existing = byHash.get(item.artifact.sha256);
    if (existing) {
      if (
        existing.artifact.filename !== item.artifact.filename ||
        existing.artifact.purl !== item.artifact.purl
      ) {
        throw new Error(`${item.artifact.sha256}: exact wheel identity is ambiguous`);
      }
      existing.uses.push({ inventory: item.inventory, artifact: item.artifact });
      continue;
    }
    byHash.set(item.artifact.sha256, {
      artifact: item.artifact,
      inspected: item.inspected,
      wheelPath: item.wheelPath,
      uses: [{ inventory: item.inventory, artifact: item.artifact }],
    });
  }

  const evidenceDirectory = resolve(outputRoot, 'evidence-v3');
  mkdirSync(evidenceDirectory, { recursive: true });
  const artifacts = [];
  for (const item of [...byHash.values()].sort((left, right) =>
    left.artifact.sha256.localeCompare(right.artifact.sha256),
  )) {
    if ((await sha256File(item.wheelPath)) !== item.artifact.sha256) {
      throw new Error(`${item.artifact.filename}: wheel hash drift after inventory verification`);
    }
    const artifact = canonicalArtifact(item.artifact);
    const evidence = createArtifactLicenseEvidenceV3({
      artifact,
      inspected: item.inspected,
      evidenceStatus: evidenceStatus(item.inspected),
    });
    validateArtifactLicenseEvidenceV3(evidence);
    const evidencePath = resolve(evidenceDirectory, `${artifact.sha256}.json`);
    writeCanonicalJson(evidencePath, evidence);
    const uses = item.uses
      .map(({ inventory, artifact: usedArtifact }) => ({
        target,
        scope: inventory.scope,
        inventory_id: inventory.inventory_id,
        artifact_role: scopeRole(inventory.scope).artifact_role,
        distribution_role: scopeRole(inventory.scope).distribution_role,
        dependency_paths: dependencyPaths(inventory, usedArtifact.purl),
      }))
      .sort((left, right) =>
        `${left.scope}\0${left.inventory_id}`.localeCompare(
          `${right.scope}\0${right.inventory_id}`,
        ),
      );
    artifacts.push({
      ...artifact,
      evidence_path: relativeRepositoryPath(evidencePath),
      evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
      uses,
    });
  }

  const inventories = [];
  for (const item of loaded) {
    const scopeName = inventoryScopeName(item.path);
    const resolutionPath = resolve(resolutionRoot, `${target}-${scopeName}.json`);
    const resolution = JSON.parse(readFileSync(resolutionPath, 'utf8'));
    if (resolution.target !== target || resolution.scope !== scopeName) {
      throw new Error(`${resolutionPath}: resolution target/scope mismatch`);
    }
    inventories.push({
      scope: item.document.scope,
      inventory_id: item.document.inventory_id,
      inventory_path: relativeRepositoryPath(item.path),
      inventory_sha256: await sha256File(item.path),
      resolution_path: relativeRepositoryPath(resolutionPath),
      resolution_sha256: await sha256File(resolutionPath),
    });
  }
  inventories.sort((left, right) => left.inventory_id.localeCompare(right.inventory_id));
  const artifactSet = artifacts.map(({ package: packageName, version, filename, sha256 }) => ({
    package: packageName,
    version,
    filename,
    sha256,
  }));
  const artifactSetSha256 = licenseIdentityHash(artifactSet);
  const buildContext = JSON.parse(readFileSync(buildContextPath, 'utf8'));
  if (
    buildContext.inputs.code_c_commit !== head ||
    buildContext.inputs.main_quality_baseline !== mainBaseline ||
    buildContext.inputs.target.os !== target
  ) {
    throw new Error(
      `${target}: PyInstaller Build Context is not bound to this graph HEAD/baseline`,
    );
  }
  const pyinstallerInput = buildContext.inputs.pyinstaller_artifact;
  const pyinstallerArtifact = artifacts.find(
    (artifact) =>
      artifact.sha256 === pyinstallerInput.sha256 &&
      artifact.filename === pyinstallerInput.filename,
  );
  if (!pyinstallerArtifact) {
    throw new Error(`${target}: Build Context PyInstaller artifact is absent from the exact graph`);
  }
  const pyinstallerEvidenceV3 = validateArtifactLicenseEvidenceV3(
    JSON.parse(readFileSync(resolve(pyinstallerArtifact.evidence_path), 'utf8')),
  );
  const specializedPath = resolve(
    `compliance/license-evidence/pyinstaller-6.22.2/${target}-x86_64.scan.json`,
  );
  const specialized = JSON.parse(readFileSync(specializedPath, 'utf8'));
  const legacySource = specialized.package_license.evidence_sources.find(
    (source) => source.evidence_type === 'METADATA_LICENSE_DESCRIPTION',
  );
  if (
    specialized.schema_version !== '2' ||
    specialized.evidence_status !== 'PASS' ||
    specialized.artifact.sha256 !== pyinstallerArtifact.sha256 ||
    specialized.artifact.filename !== pyinstallerArtifact.filename ||
    legacySource?.value !== pyinstallerEvidenceV3.raw_license_evidence.legacy_license_value
  ) {
    throw new Error(`${target}: exact PyInstaller v2/v3 artifact license evidence does not bind`);
  }
  const pyinstallerDecision = evaluateLicenseEvidence({
    artifact_sha256: pyinstallerArtifact.sha256,
    package: pyinstallerArtifact.package,
    version: pyinstallerArtifact.version,
    artifact_type: 'PYTHON_WHEEL',
    artifact_role: 'PYINSTALLER_BUILD_TOOL',
    distribution_role: 'BUILD_ONLY_USE',
    detected_license_expression: specialized.package_license.expression,
    evidence_status: 'PASS',
    evidence_sources: specialized.package_license.evidence_sources,
    exception_evidence: specialized.package_license.evidence_sources,
  });
  if (pyinstallerDecision.policy_result !== 'PASS') {
    throw new Error(`${target}: PyInstaller Worker-Build License failed current shared policy`);
  }
  const graphArtifacts = artifacts.map((artifact) => {
    const value = structuredClone(artifact);
    delete value.evidence_path;
    return value;
  });
  const graphIdentityInput = {
    target,
    code_c_head_sha: head,
    main_quality_baseline_sha: mainBaseline,
    inventories,
    artifact_set_sha256: artifactSetSha256,
    artifacts: graphArtifacts,
  };
  const graphSha256 = licenseIdentityHash(graphIdentityInput);
  const document = {
    schema_version: '1',
    document_type: 'CODE_C_EXACT_WHEEL_LICENSE_TARGET_EVIDENCE',
    target,
    code_c_head_sha: head,
    main_quality_baseline_sha: mainBaseline,
    graph_id: `code-c-license-graph-${target}-${graphSha256.slice(0, 24)}`,
    graph_sha256: graphSha256,
    artifact_set_sha256: artifactSetSha256,
    inventories,
    artifacts,
    pyinstaller_worker_build_license: {
      status: 'PASS',
      build_context_id: buildContext.build_context_id,
      build_context_sha256: await sha256File(buildContextPath),
      artifact_sha256: pyinstallerArtifact.sha256,
      exact_artifact_evidence_v2_path: relativeRepositoryPath(specializedPath),
      exact_artifact_evidence_v2_sha256: await sha256File(specializedPath),
      artifact_license_evidence_v3_snapshot_sha256: pyinstallerEvidenceV3.evidence_snapshot_sha256,
      policy_decision: pyinstallerDecision,
    },
    evidence_contract: 'Artifact License Evidence v3',
    review_contract: 'Artifact License Review v1',
    regression_fixture_used_as_production_approval: false,
  };
  mkdirSync(outputRoot, { recursive: true });
  const output = resolve(outputRoot, 'target-license-evidence.json');
  writeCanonicalJson(output, document);
  console.log(
    `code-c-license-target: PASS (${target}; ${document.graph_id}; ${artifacts.length} unique exact wheels)`,
  );
}

main().catch((error) => {
  console.error(`code-c-license-target: FAIL\n${error.message}`);
  process.exitCode = 1;
});
