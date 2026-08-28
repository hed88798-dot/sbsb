import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  canonicalJson,
  discoverInventoryPaths,
  loadInventories,
  repositoryRoot,
  verifyArtifactInventories,
} from './inventory.mjs';
import { auditPythonLicenses } from './license.mjs';
import { buildPackagedNativeInventory, reconcilePackagedNativeInventory } from './native.mjs';
import { auditPythonVulnerabilities } from './vulnerability.mjs';
import { assertTargetMatchesCurrent, currentTargetDescriptor } from './compatibility.mjs';

function parseArguments(values) {
  const options = { inventories: [], release: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--inventory') options.inventories.push(values[++index]);
    else if (value === '--artifact-root') options.artifactRoot = values[++index];
    else if (value === '--packaged-root') options.packagedRoot = values[++index];
    else if (value === '--packaged-inventory') options.packagedInventory = values[++index];
    else if (value === '--inventory-id') options.inventoryId = values[++index];
    else if (value === '--platform-tag') options.platformTag = values[++index];
    else if (value === '--python-tag') options.pythonTag = values[++index];
    else if (value === '--abi-tag') options.abiTag = values[++index];
    else if (value === '--target-os') options.targetOs = values[++index];
    else if (value === '--target-architecture') options.targetArchitecture = values[++index];
    else if (value === '--offline-osv') options.offlineOsv = values[++index];
    else if (value === '--report' || value === '--output') options.output = values[++index];
    else if (value === '--release') options.release = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (options.inventories.some((path) => !path)) throw new Error('--inventory requires a path');
  return options;
}

function inventoryPaths(options) {
  return options.inventories.length > 0
    ? options.inventories.map((path) => resolve(path))
    : discoverInventoryPaths(repositoryRoot);
}

function artifactRoot(options) {
  const value = options.artifactRoot ?? process.env.PYTHON_ARTIFACT_ROOT;
  if (!value)
    throw new Error('Python inventories exist but --artifact-root/PYTHON_ARTIFACT_ROOT is missing');
  return resolve(value);
}

function writeReport(path, value) {
  if (!path) return;
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, canonicalJson(value));
}

async function verify(options) {
  const loaded = loadInventories(inventoryPaths(options));
  if (loaded.length === 0) {
    console.log('python-inventory: PASS (0 declared Python scopes on this baseline)');
    return { loaded, verified: [] };
  }
  const verified = await verifyArtifactInventories(loaded, artifactRoot(options));
  console.log(
    `python-inventory: PASS (${loaded.length} inventories; ${verified.length} hash-verified wheels)`,
  );
  return { loaded, verified };
}

async function validate(options) {
  const loaded = loadInventories(inventoryPaths(options));
  console.log(`python-inventory-schema: PASS (${loaded.length} inventories)`);
  return loaded;
}

async function license(options) {
  const { verified } = await verify(options);
  const report = auditPythonLicenses(verified, { release: options.release });
  writeReport(options.output, report);
  console.log(
    `python-license: PASS (${report.summary.packages} wheels; ${report.summary.manual_review} manual review)`,
  );
  return report;
}

async function vulnerability(options) {
  const { loaded } = await verify(options);
  const offline = options.offlineOsv
    ? JSON.parse(readFileSync(resolve(options.offlineOsv), 'utf8'))
    : null;
  const report = await auditPythonVulnerabilities(loaded, offline);
  writeReport(options.output, report);
  if (report.findings.length > 0) {
    throw new Error(
      report.findings
        .map(
          (finding) =>
            `${finding.scope}:${finding.purl}: ${finding.advisory_id} (${JSON.stringify(finding.severity)})`,
        )
        .join('\n'),
    );
  }
  console.log(`python-vulnerability: PASS (${report.packages_scanned} artifacts; 0 findings)`);
  return report;
}

async function nativeInventory(options) {
  if (!options.packagedRoot) throw new Error('native-inventory requires --packaged-root');
  if (!options.inventoryId) throw new Error('native-inventory requires --inventory-id');
  const { loaded } = await verify(options);
  if (loaded.length === 0)
    throw new Error('native-inventory requires at least one locked inventory');
  const packaged = await buildPackagedNativeInventory(
    loaded,
    options.packagedRoot,
    options.inventoryId,
  );
  writeReport(options.output, packaged);
  console.log(
    `packaged-native-inventory: PASS (${packaged.native_artifacts.length} native artifacts inventoried)`,
  );
  return packaged;
}

async function reconcile(options) {
  if (!options.packagedInventory) throw new Error('reconcile requires --packaged-inventory');
  const { loaded } = await verify(options);
  const packaged = JSON.parse(readFileSync(resolve(options.packagedInventory), 'utf8'));
  const report = reconcilePackagedNativeInventory(loaded, packaged);
  writeReport(options.output, report);
  console.log(
    `packaged-native-reconcile: PASS (${report.packaged_native_artifacts} native artifacts)`,
  );
  return report;
}

async function repoVerify(options) {
  const paths = inventoryPaths(options);
  const loaded = loadInventories(paths);
  if (loaded.length === 0) {
    console.log('python-supply-chain: PASS (foundation active; 0 declared Python scopes)');
    return;
  }
  await license({
    ...options,
    inventories: paths,
    output: 'artifacts/compliance/PYTHON_LICENSE.json',
  });
  await vulnerability({
    ...options,
    inventories: paths,
    output: 'artifacts/compliance/PYTHON_VULNERABILITIES.json',
  });
  console.log(`python-supply-chain: PASS (${loaded.length} declared inventories)`);
}

async function repoNativeVerify(options) {
  const paths = inventoryPaths(options);
  let loaded = loadInventories(paths).filter(
    ({ document }) => document.scope === 'PRODUCTION_WORKER_RUNTIME',
  );
  if (loaded.length === 0) {
    console.log('packaged-native-reconcile: PASS (not applicable; no production worker inventory)');
    return;
  }
  const platformTag = options.platformTag ?? process.env.PYTHON_TARGET_PLATFORM_TAG;
  const pythonTag = options.pythonTag ?? process.env.PYTHON_TARGET_PYTHON_TAG;
  const abiTag = options.abiTag ?? process.env.PYTHON_TARGET_ABI_TAG;
  const targetOs = options.targetOs ?? process.env.PYTHON_TARGET_OS;
  const targetArchitecture = options.targetArchitecture ?? process.env.PYTHON_TARGET_ARCHITECTURE;
  if (platformTag || pythonTag || abiTag || targetOs || targetArchitecture) {
    loaded = loaded.filter(({ document }) =>
      document.schema_version === '1'
        ? (!platformTag || document.target.platform_tag === platformTag) &&
          (!pythonTag || document.target.python_tag === pythonTag) &&
          (!abiTag || document.target.abi_tag === abiTag) &&
          !targetOs &&
          !targetArchitecture
        : !platformTag &&
          !pythonTag &&
          !abiTag &&
          (!targetOs || document.target.os === targetOs) &&
          (!targetArchitecture || document.target.architecture === targetArchitecture),
    );
    if (loaded.length === 0)
      throw new Error('no production inventory matches selected target tags');
  } else if (loaded.length > 1) {
    throw new Error(
      'multiple production targets exist; select v1 tag variables or PYTHON_TARGET_OS/PYTHON_TARGET_ARCHITECTURE for v2',
    );
  }
  const packagedRoot = options.packagedRoot ?? process.env.PYTHON_PACKAGED_WORKER_ROOT;
  if (!packagedRoot) {
    throw new Error('production inventory exists but PYTHON_PACKAGED_WORKER_ROOT is missing');
  }
  const temporaryOutput = resolve('artifacts/compliance/PACKAGED_NATIVE_INVENTORY.json');
  const shared = {
    ...options,
    inventories: loaded.map(({ path }) => path),
    packagedRoot,
    inventoryId: 'packaged-worker-ci',
    output: temporaryOutput,
  };
  await nativeInventory(shared);
  await reconcile({ ...shared, packagedInventory: temporaryOutput });
}

async function repoTargetVerifyCurrent(options) {
  const productionV2 = loadInventories(inventoryPaths(options)).filter(
    ({ document }) =>
      document.schema_version === '2' && document.scope === 'PRODUCTION_WORKER_RUNTIME',
  );
  if (productionV2.length === 0) {
    console.log('python-target-current: PASS (not applicable; no v2 production inventory)');
    return;
  }
  if (!['win32', 'linux'].includes(process.platform)) {
    console.log(`python-target-current: PASS (not applicable on ${process.platform} host)`);
    return;
  }
  const current = currentTargetDescriptor();
  const matching = productionV2.filter(
    ({ document }) =>
      document.target.os === current.os && document.target.architecture === current.architecture,
  );
  if (matching.length === 0) {
    console.log(
      `python-target-current: PASS (not applicable; no ${current.os}/${current.architecture} production inventory)`,
    );
    return;
  }
  if (matching.length !== 1) {
    throw new Error('current target must match exactly one production inventory');
  }
  assertTargetMatchesCurrent(matching[0].document.target);
  console.log(
    `python-target-current: PASS (${current.os}/${current.architecture}; ${current.compatibility.compatible_tags.length} tags)`,
  );
}

async function main() {
  const [command = 'repo-verify', ...values] = process.argv.slice(2);
  const options = parseArguments(values);
  if (command === 'validate') await validate(options);
  else if (command === 'verify') await verify(options);
  else if (command === 'license') await license(options);
  else if (command === 'vulnerability') await vulnerability(options);
  else if (command === 'native-inventory') await nativeInventory(options);
  else if (command === 'reconcile') await reconcile(options);
  else if (command === 'repo-verify') await repoVerify(options);
  else if (command === 'repo-native-verify') await repoNativeVerify(options);
  else if (command === 'repo-target-verify-current') await repoTargetVerifyCurrent(options);
  else throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`python-supply-chain: FAIL\n${error.message}`);
  process.exitCode = 1;
});
