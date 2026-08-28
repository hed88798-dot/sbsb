import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spdxParserIdentity } from './spdx-parser.mjs';
import { evaluateBundledLicenseEvidence, loadBundledLicenseEvidence } from './bundled-license.mjs';

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const lockPath = resolve(
  repositoryRoot,
  'compliance/quality-tooling/npm/spdx-expression-policy.lock.json',
);

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function canonicalLicenseTextHash(path) {
  return createHash('sha256')
    .update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'))
    .digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

export function verifySpdxQualityTooling() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
  const pnpmLock = readFileSync(resolve(repositoryRoot, 'pnpm-lock.yaml'), 'utf8');
  const failures = [];
  if (lock.schema_version !== '1' || lock.scope !== 'QUALITY_TOOLING') {
    failures.push('SPDX quality-tool lock identity is invalid');
  }
  if (new Date(lock.vulnerability_review_expires_at) <= new Date()) {
    failures.push('SPDX quality-tool vulnerability review is expired');
  }
  const lockedByName = new Map(
    lock.components.map((component) => [component.package_name, component]),
  );
  for (const component of lock.components) {
    if (manifest.devDependencies[component.package_name] !== component.version) {
      failures.push(`${component.purl}: package.json is not exact-version pinned`);
    }
    const installedManifestPath = require.resolve(`${component.package_name}/package.json`);
    const installedManifest = JSON.parse(readFileSync(installedManifestPath, 'utf8'));
    if (installedManifest.version !== component.version) {
      failures.push(`${component.purl}: installed version differs from approved lock`);
    }
    if (!pnpmLock.includes(`${component.package_name}@${component.version}:`)) {
      failures.push(`${component.purl}: pnpm lock entry is missing`);
    }
    if (!pnpmLock.includes(component.pnpm_integrity)) {
      failures.push(`${component.purl}: pnpm integrity differs from approved lock`);
    }
    if (!/^[a-f0-9]{64}$/u.test(component.artifact_sha256)) {
      failures.push(`${component.purl}: registry tarball SHA-256 is invalid`);
    }
    if (
      !component.registry_url.startsWith('https://registry.npmjs.org/') ||
      !component.source.startsWith('https://github.com/')
    ) {
      failures.push(`${component.purl}: source/registry provenance is not approved HTTPS`);
    }
    const installedDependencyPurls = Object.keys(installedManifest.dependencies ?? {})
      .map((name) => lockedByName.get(name)?.purl ?? `UNLOCKED:${name}`)
      .sort();
    if (
      JSON.stringify(installedDependencyPurls) !==
      JSON.stringify([...component.dependencies].sort())
    ) {
      failures.push(`${component.purl}: installed dependency graph differs from approved lock`);
    }
    for (const evidence of component.license_evidence) {
      const evidencePath = resolve(installedManifestPath, '..', evidence.relative_path);
      if (hash(evidencePath) !== evidence.sha256) {
        failures.push(`${component.purl}: license evidence hash mismatch`);
      }
    }
    if (
      component.provenance_review_status !== 'APPROVED' ||
      component.license_review_status !== 'APPROVED' ||
      component.vulnerability_advisory_ids.length > 0
    ) {
      failures.push(`${component.purl}: supply-chain review is not approved/clean`);
    }
  }
  for (const dataset of Object.values(lock.datasets)) {
    const path = require.resolve(dataset.package_name);
    if (hash(path) !== dataset.sha256) {
      failures.push(`${dataset.package_name}: pinned SPDX dataset hash mismatch`);
    }
  }
  if (lock.datasets.license_list.spdx_license_list_version !== '3.28.0') {
    failures.push('SPDX License List version differs from parser contract');
  }
  if (lock.datasets.exception_list.spdx_exception_list_version !== '3.23') {
    failures.push('SPDX Exception List version differs from parser contract');
  }
  if (
    spdxParserIdentity.spdx_license_data_sha256 !== lock.datasets.license_list.sha256 ||
    spdxParserIdentity.spdx_exception_data_sha256 !== lock.datasets.exception_list.sha256
  ) {
    failures.push('runtime parser datasets differ from the approved dataset lock');
  }
  const policyPath = resolve(repositoryRoot, lock.license_policy.relative_path);
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  if (canonicalHash(policy) !== lock.license_policy.sha256) {
    failures.push('license policy canonical data changed without an explicit identity update');
  }
  if (policy.license_policy_version !== lock.license_policy.version) {
    failures.push('license policy version differs from the supply-chain lock');
  }
  for (const historical of lock.historical_policies ?? []) {
    const historicalPolicy = JSON.parse(
      readFileSync(resolve(repositoryRoot, historical.relative_path), 'utf8'),
    );
    if (
      historicalPolicy.license_policy_version !== historical.version ||
      canonicalHash(historicalPolicy) !== historical.sha256
    ) {
      failures.push(`${historical.version}: immutable historical policy identity mismatch`);
    }
  }
  for (const evidence of lock.rule_evidence ?? []) {
    const rule = policy.license_rules[evidence.spdx_id];
    if (
      !rule ||
      rule.rule_id !== evidence.rule_id ||
      rule.spdx_license_list_version !== evidence.spdx_license_list_version ||
      canonicalHash(rule.canonical_license_evidence) !==
        canonicalHash({
          source: evidence.source,
          source_artifact_sha256: evidence.source_artifact_sha256,
          canonical_license_text_sha256: evidence.canonical_license_text_sha256,
        })
    ) {
      failures.push(`${evidence.rule_id}: policy rule evidence identity mismatch`);
    }
  }
  for (const review of policy.artifact_bundled_license_reviews ?? []) {
    try {
      const scan = loadBundledLicenseEvidence(resolve(repositoryRoot, review.scan_relative_path));
      evaluateBundledLicenseEvidence(scan, {
        policy: { document: policy, sha256: lock.license_policy.sha256 },
      });
      if (
        canonicalLicenseTextHash(resolve(repositoryRoot, review.notice_text_relative_path)) !==
        review.license_evidence_materialized_text_sha256
      ) {
        failures.push(`${review.review_id}: materialized notice evidence hash mismatch`);
      }
    } catch (error) {
      failures.push(`${review.review_id}: ${error.message}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return {
    schema_version: '1',
    status: 'PASS',
    scope: lock.scope,
    parser: spdxParserIdentity,
    license_policy_version: lock.license_policy.version,
    license_policy_sha256: lock.license_policy.sha256,
    components: lock.components.map((component) => ({
      purl: component.purl,
      artifact_sha256: component.artifact_sha256,
      license_expression: component.license_expression,
      provenance_review_status: component.provenance_review_status,
      vulnerability_advisory_ids: component.vulnerability_advisory_ids,
    })),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = verifySpdxQualityTooling();
    console.log(
      `spdx-quality-tooling: PASS (${report.components.length} exact npm artifacts; verify-only)`,
    );
  } catch (error) {
    console.error(`spdx-quality-tooling: FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}
