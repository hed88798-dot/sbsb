import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { sha256File } from '../python-supply-chain/inventory.mjs';
import { writeCanonicalJson } from './canonical-evidence.mjs';
import {
  loadLicensePolicy,
  evaluateLicenseEvidence,
  licenseIdentityHash,
} from '../license-policy/evaluator.mjs';
import { validateArtifactLicenseEvidenceV3 } from '../license-policy/artifact-review.mjs';
import {
  assertLicenseBaselineBinding,
  containsCommit,
  MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE,
} from './license-baseline.mjs';
import { parseSpdxExpression } from '../license-policy/spdx-parser.mjs';
import {
  evaluateLicenseCoverage,
  validateBuildOnlyUsageBinding,
  validateUpstreamReleaseBinding,
} from '../license-policy/coverage.mjs';

const CLASSIFIER_EXPRESSIONS = new Map([
  ['License :: OSI Approved :: Apache Software License', 'Apache-2.0'],
  ['License :: OSI Approved :: MIT License', 'MIT'],
  ['License :: OSI Approved :: GNU General Public License v2 (GPLv2)', 'GPL-2.0-or-later'],
  ['License :: OSI Approved :: ISC License (ISCL)', 'ISC'],
  ['License :: OSI Approved :: Python Software Foundation License', 'PSF-2.0'],
]);

function currentValidationHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    shell: false,
  }).trim();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function compactText(value) {
  return value?.trim().replaceAll(/\s+/gu, ' ') ?? '';
}

function evidenceReferences(evidence) {
  const raw = evidence.raw_license_evidence;
  return [
    ...(raw.reported_license_expression ? ['raw:reported-license-expression'] : []),
    ...(raw.legacy_license_value ? ['raw:legacy-license'] : []),
    ...raw.classifiers.map((_, index) => `raw:license-classifier:${index}`),
    ...raw.license_files.map((entry) => `raw:${entry.kind.toLowerCase()}:${entry.relative_path}`),
  ];
}

function machineSuggestion(evidence) {
  const recorded = evidence.machine_suggestion?.suggested_spdx_expression;
  if (recorded) {
    return {
      expression: recorded,
      source: 'EXACT_ARTIFACT_ARCHIVE_BYTES',
      rationale: 'Suggestion was produced by the pinned exact-wheel evidence extractor.',
    };
  }
  const raw = evidence.raw_license_evidence;
  const legacy = compactText(raw.legacy_license_value);
  const lower = legacy.toLowerCase();
  const exactAliases = new Map([
    ['apache 2.0', 'Apache-2.0'],
    ['apache-2.0', 'Apache-2.0'],
    ['apache software license', 'Apache-2.0'],
    ['mit', 'MIT'],
    ['mit license', 'MIT'],
    ['bsd-3-clause', 'BSD-3-Clause'],
    ['3-clause bsd license', 'BSD-3-Clause'],
    ['bsd 3-clause license', 'BSD-3-Clause'],
    ['isc', 'ISC'],
    ['isc license (iscl)', 'ISC'],
    ['python software foundation license', 'PSF-2.0'],
  ]);
  if (legacy) {
    try {
      const parsed = parseSpdxExpression(legacy);
      return {
        expression: parsed.normalized_expression,
        source: 'EXACT_LEGACY_METADATA_SPDX_EXPRESSION',
        rationale: 'The exact wheel METADATA License field is a valid SPDX expression.',
      };
    } catch {
      // Continue through conservative aliases and legacy text signatures.
    }
  }
  if (exactAliases.has(lower)) {
    return {
      expression: exactAliases.get(lower),
      source: 'EXACT_LEGACY_METADATA_ALIAS',
      rationale: 'A deterministic generic alias normalized the exact legacy metadata value.',
    };
  }
  if (
    lower.includes('redistribution and use in source and binary forms') &&
    lower.includes('neither the name') &&
    lower.includes('all rights reserved')
  ) {
    return {
      expression: 'BSD-3-Clause',
      source: 'STANDARD_LICENSE_TEXT_SIGNATURE',
      rationale:
        'The artifact legacy metadata contains the standard three-clause BSD grant and non-endorsement clause.',
    };
  }
  if (
    lower.includes('gplv2-or-later') &&
    lower.includes('special exception') &&
    lower.includes('pyinstaller')
  ) {
    return {
      expression: 'GPL-2.0-or-later WITH Bootloader-exception',
      source: 'LEGACY_METADATA_EXCEPTION_SIGNATURE',
      rationale:
        'The artifact describes GPL v2-or-later plus the named bootloader distribution exception.',
    };
  }
  const classifierExpressions = [
    ...new Set(raw.classifiers.map((value) => CLASSIFIER_EXPRESSIONS.get(value)).filter(Boolean)),
  ].sort();
  if (classifierExpressions.length === 1) {
    return {
      expression: classifierExpressions[0],
      source: 'UNAMBIGUOUS_LICENSE_CLASSIFIER',
      rationale:
        'One recognized artifact-reported license classifier mapped to one SPDX expression.',
    };
  }
  if (classifierExpressions.length > 1) {
    return {
      expression: classifierExpressions.join(' AND '),
      source: 'MULTIPLE_LICENSE_CLASSIFIERS_CONJUNCTION',
      rationale:
        'Every recognized artifact-reported license classifier was retained as a conjunctive machine suggestion.',
    };
  }
  return null;
}

function roleDecision(artifact, expression, use, status, extra = {}) {
  return evaluateLicenseEvidence({
    artifact_sha256: artifact.sha256,
    package: artifact.package,
    version: artifact.version,
    artifact_type: 'PYTHON_WHEEL',
    artifact_role: use.artifact_role,
    distribution_role: use.distribution_role,
    detected_license_expression: expression,
    evidence_status: status,
    evidence_sources: [],
    exception_evidence: extra.exceptionEvidence ?? [],
  });
}

function loadSpecializedEvidence(artifact) {
  const directory = resolve('compliance/license-evidence/pyinstaller-6.22.2');
  const matches = [];
  for (const name of readdirSync(directory).filter((value) => value.endsWith('.scan.json'))) {
    const path = join(directory, name);
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (
      value.schema_version === '2' &&
      value.evidence_status === 'PASS' &&
      value.artifact.sha256 === artifact.sha256 &&
      value.artifact.filename === artifact.filename
    ) {
      matches.push({ path, value });
    }
  }
  if (matches.length > 1) throw new Error(`${artifact.sha256}: ambiguous specialized evidence`);
  return matches[0] ?? null;
}

function specializedDecision(artifact, expression, use, specialized) {
  if (!specialized || specialized.value.package_license.expression !== expression) return null;
  const sources = specialized.value.package_license.evidence_sources;
  return evaluateLicenseEvidence({
    artifact_sha256: artifact.sha256,
    package: artifact.package,
    version: artifact.version,
    artifact_type: 'PYTHON_WHEEL',
    artifact_role: 'PYINSTALLER_BUILD_TOOL',
    distribution_role: use.distribution_role,
    detected_license_expression: expression,
    evidence_status: 'PASS',
    evidence_sources: sources,
    exception_evidence: sources,
  });
}

function requiredReviewRecord({ artifact, evidence, uses, suggestion, decisions }) {
  return {
    request_schema_version: '1',
    requested_review_contract: 'Artifact License Review v1',
    requested_action: 'APPROVE',
    package: artifact.package,
    version: artifact.version,
    filename: artifact.filename,
    sha256: artifact.sha256,
    purl: artifact.purl,
    targets: [...new Set(uses.map((use) => use.target))].sort(),
    scopes: [...new Set(uses.map((use) => use.scope))].sort(),
    artifact_roles: [...new Set(uses.map((use) => use.artifact_role))].sort(),
    dependency_paths: uses.map((use) => ({
      target: use.target,
      scope: use.scope,
      inventory_id: use.inventory_id,
      paths: use.dependency_paths,
    })),
    raw_license: evidence.raw_license_evidence.legacy_license_value,
    reported_license_expression: evidence.raw_license_evidence.reported_license_expression,
    classifier_evidence: evidence.raw_license_evidence.classifiers,
    bundled_license_evidence: evidence.raw_license_evidence.license_files,
    suggested_spdx_expression: suggestion?.expression ?? null,
    suggestion_source: suggestion?.source ?? 'ARTIFACT_REPORTED_VALID_SPDX',
    suggestion_rationale:
      suggestion?.rationale ??
      'The exact artifact expression is valid but its policy result requires authorized review.',
    suggestion_status: suggestion ? 'MACHINE_SUGGESTION_NOT_APPROVAL' : 'ARTIFACT_EXPRESSION',
    evidence_references: evidenceReferences(evidence),
    evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
    projected_policy_decisions: decisions,
    review_status: 'PENDING',
  };
}

function usageEvaluation(artifact, use, decision, disposition, reason) {
  return {
    package: artifact.package,
    version: artifact.version,
    artifact_filename: artifact.filename,
    artifact_sha256: artifact.sha256,
    target: use.target,
    scope: use.scope,
    usage_binding_id: use.usage_binding_id ?? use.inventory_id ?? null,
    usage_binding_sha256: use.usage_binding_sha256 ?? null,
    inventory_id: use.inventory_id,
    usage_role: use.artifact_role,
    distribution_role: use.distribution_role,
    disposition,
    policy_result: decision?.policy_result ?? null,
    reason: decision?.reason ?? reason,
  };
}

function hardBlock(
  artifact,
  evidence,
  uses,
  reason,
  requiredNextAction,
  policyDecisions = [],
  evidenceClassification = 'L3',
  usageEvaluations = [],
) {
  return {
    package: artifact.package,
    version: artifact.version,
    filename: artifact.filename,
    sha256: artifact.sha256,
    targets: [...new Set(uses.map((use) => use.target))].sort(),
    scopes: [...new Set(uses.map((use) => use.scope))].sort(),
    raw_license: evidence.raw_license_evidence,
    evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
    evidence_classification: evidenceClassification,
    artifact_license_evidence_id: `artifact-license-evidence-v3:${evidence.evidence_snapshot_sha256}`,
    artifact_license_evidence_sha256: evidence.evidence_snapshot_sha256,
    block_reason: reason,
    required_next_action: requiredNextAction,
    policy_decisions: policyDecisions,
    usage_evaluations: usageEvaluations,
  };
}

function sameCoverageArtifact(left, right) {
  return ['package', 'version', 'filename', 'sha256', 'artifact_type'].every(
    (key) =>
      (left?.[key] ?? (key === 'artifact_type' ? 'PYTHON_WHEEL' : undefined)) === right?.[key],
  );
}

function loadCoverageRevalidation(coverageRoot, artifactsByHash) {
  const fixtureNames = [
    'sentencepiece-linux',
    'sentencepiece-windows',
    'pyinstaller-hooks-contrib',
  ];
  const fixtures = fixtureNames.map((name) => {
    const fixtureRoot = resolve(coverageRoot, name);
    const manifestPath = resolve(fixtureRoot, 'manifest.json');
    const artifactPath = resolve(fixtureRoot, 'artifact.json');
    const membersPath = resolve(fixtureRoot, 'members.json');
    const coveragePath = resolve(fixtureRoot, 'coverage.json');
    if (![manifestPath, artifactPath, membersPath, coveragePath].every(existsSync)) {
      throw new Error(`${name}: incomplete License Coverage v1 fixture`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.fixture_scope !== 'REGRESSION_ONLY_NOT_RELEASE_APPROVAL') {
      throw new Error(`${name}: fixture is not explicitly regression-only`);
    }
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const members = JSON.parse(readFileSync(membersPath, 'utf8'));
    const records = JSON.parse(readFileSync(coveragePath, 'utf8'));
    const bindingPath = resolve(fixtureRoot, 'upstream-binding.json');
    const usageBindingPath = resolve(fixtureRoot, 'usage-binding.json');
    const upstreamBinding = existsSync(bindingPath)
      ? JSON.parse(readFileSync(bindingPath, 'utf8'))
      : null;
    const usageBinding = existsSync(usageBindingPath)
      ? JSON.parse(readFileSync(usageBindingPath, 'utf8'))
      : null;
    let evaluation = null;
    let error = null;
    try {
      evaluation = evaluateLicenseCoverage({
        artifact,
        members,
        records,
        upstreamBinding,
        expectedRelease: manifest.expected_upstream_release ?? null,
      });
      if (usageBinding) validateBuildOnlyUsageBinding(usageBinding);
      if (upstreamBinding) validateUpstreamReleaseBinding(upstreamBinding);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const productionEntry = artifactsByHash.get(artifact.sha256);
    const exactArtifactMatch = Boolean(
      productionEntry && sameCoverageArtifact(productionEntry.artifact, artifact),
    );
    const productionIdentity = productionEntry
      ? {
          package: productionEntry.artifact.package,
          version: productionEntry.artifact.version,
          filename: productionEntry.artifact.filename,
          sha256: productionEntry.artifact.sha256,
          artifact_type: 'PYTHON_WHEEL',
        }
      : null;
    return {
      fixture_id: manifest.fixture_id,
      fixture_name: name,
      fixture_scope: manifest.fixture_scope,
      artifact,
      production_identity: productionIdentity,
      exact_artifact_match: exactArtifactMatch,
      identity_mismatch_fields: productionEntry
        ? ['package', 'version', 'filename', 'sha256', 'artifact_type'].filter(
            (key) =>
              (productionEntry.artifact[key] ??
                (key === 'artifact_type' ? 'PYTHON_WHEEL' : undefined)) !== artifact[key],
          )
        : ['artifact_not_present_in_current_license_graph'],
      status: error ? 'FAIL' : evaluation.status,
      error,
      coverage_record_sha256: records.map((record) => record.coverage_record_sha256),
      upstream_binding_id: upstreamBinding?.binding_id ?? null,
      upstream_binding_record_sha256: upstreamBinding?.binding_record_sha256 ?? null,
      upstream_binding_method: upstreamBinding?.binding_method ?? null,
      upstream_binding_assurance: upstreamBinding?.binding_assurance ?? null,
      review_statuses: [
        ...new Set(records.map((record) => record.review_provenance.review_status)),
      ],
      effective_license_expressions: [
        ...new Set(records.map((record) => record.license_assertion.spdx_expression)),
      ],
      usage_binding_status: usageBinding ? 'PASS' : 'NOT_APPLICABLE',
      member_manifest_sha256: evaluation?.member_manifest_sha256 ?? null,
      member_count: evaluation?.member_count ?? null,
      covered_member_count: evaluation?.covered_member_count ?? null,
    };
  });
  return {
    contract_status: fixtures.every((fixture) => fixture.status === 'PASS') ? 'PASS' : 'FAIL',
    production_approval_used: false,
    fixtures,
  };
}

function coverageRequiredReviewRecord({ artifact, uses, coverage }) {
  const coverageIdentity = licenseIdentityHash({
    fixture_id: coverage.fixture_id,
    coverage_record_sha256: coverage.coverage_record_sha256,
    upstream_binding_id: coverage.upstream_binding_id,
    upstream_binding_record_sha256: coverage.upstream_binding_record_sha256,
    member_manifest_sha256: coverage.member_manifest_sha256,
  });
  return {
    request_schema_version: '1',
    requested_review_contract: 'Artifact License Review v1',
    requested_action: 'APPROVE',
    package: artifact.package,
    version: artifact.version,
    filename: artifact.filename,
    sha256: artifact.sha256,
    purl: artifact.purl,
    targets: [...new Set(uses.map((use) => use.target))].sort(),
    scopes: [...new Set(uses.map((use) => use.scope))].sort(),
    artifact_roles: [...new Set(uses.map((use) => use.artifact_role))].sort(),
    dependency_paths: uses.map((use) => ({
      target: use.target,
      scope: use.scope,
      inventory_id: use.inventory_id,
      paths: use.dependency_paths,
    })),
    raw_license: null,
    reported_license_expression: null,
    classifier_evidence: [],
    bundled_license_evidence: [],
    suggested_spdx_expression: coverage.effective_license_expressions[0] ?? null,
    suggestion_source: 'LICENSE_COVERAGE_V1_UPSTREAM_RELEASE',
    suggestion_rationale:
      'Whole-artifact License Coverage v1 and Upstream Release Binding v1 account for the exact artifact; commercial-policy approval remains pending.',
    suggestion_status: 'MACHINE_SUGGESTION_NOT_APPROVAL',
    evidence_references: [
      `license-coverage-fixture:${coverage.fixture_id}`,
      ...coverage.coverage_record_sha256.map((sha256) => `coverage-record:${sha256}`),
      ...(coverage.upstream_binding_id ? [`upstream-binding:${coverage.upstream_binding_id}`] : []),
    ],
    evidence_snapshot_sha256: coverageIdentity,
    projected_policy_decisions: [],
    review_status: 'PENDING',
    coverage_evidence: {
      contract: 'License Coverage v1 / Upstream Release Binding v1',
      coverage_record_sha256: coverage.coverage_record_sha256,
      upstream_binding_record_sha256: coverage.upstream_binding_record_sha256,
      upstream_binding_assurance: coverage.upstream_binding_assurance,
      member_manifest_sha256: coverage.member_manifest_sha256,
      coverage_status: coverage.status,
      commercial_policy_decision: 'NOT_PROVIDED_BY_COVERAGE_CONTRACT',
    },
  };
}

async function main() {
  const inputRoot = resolve(argument('--input-root'));
  const outputRoot = resolve(argument('--output-root'));
  const coverageRootArgument = optionalArgument('--coverage-root');
  const coverageRoot = coverageRootArgument ? resolve(coverageRootArgument) : null;
  const requestedBaseline = optionalArgument('--current-main-quality-baseline');
  const requestedEvaluatorHead = optionalArgument('--current-license-evaluator-head');
  const targets = ['linux', 'windows'].map((target) =>
    JSON.parse(readFileSync(resolve(inputRoot, target, 'target-license-evidence.json'), 'utf8')),
  );
  const headSet = new Set(targets.map((target) => target.code_c_head_sha));
  if (headSet.size !== 1) throw new Error('target graphs were not produced from one Code C HEAD');
  const head = [...headSet][0];
  const baselineSet = new Set(targets.map((target) => target.main_quality_baseline_sha));
  if (baselineSet.size !== 1) {
    throw new Error('target graphs were not produced from one current main quality baseline');
  }
  const targetGraphBaseline = [...baselineSet][0];
  const mainBaseline = requestedBaseline ?? targetGraphBaseline;
  const evaluationHead = requestedEvaluatorHead ?? currentValidationHead();
  if (requestedBaseline && targetGraphBaseline !== requestedBaseline) {
    if (!containsCommit(targetGraphBaseline, requestedBaseline)) {
      throw new Error(
        `target graph baseline ${targetGraphBaseline} is not an ancestor of requested current main baseline ${requestedBaseline}`,
      );
    }
  }
  assertLicenseBaselineBinding({
    minimumBaseline: MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE,
    currentMainBaseline: mainBaseline,
    validationHead: evaluationHead,
  });
  for (const target of targets) {
    if (target.pyinstaller_worker_build_license?.status !== 'PASS') {
      throw new Error(`${target.target}: PyInstaller Worker-Build License was not revalidated`);
    }
  }

  const artifactsByHash = new Map();
  for (const target of targets) {
    const inventoryHashes = new Map(
      (target.inventories ?? []).map((inventory) => [
        inventory.inventory_id,
        inventory.inventory_sha256,
      ]),
    );
    for (const artifact of target.artifacts) {
      const evidence = validateArtifactLicenseEvidenceV3(
        JSON.parse(readFileSync(resolve(artifact.evidence_path), 'utf8')),
      );
      const existing = artifactsByHash.get(artifact.sha256);
      if (existing) {
        if (
          existing.artifact.filename !== artifact.filename ||
          existing.evidence.evidence_snapshot_sha256 !== evidence.evidence_snapshot_sha256
        ) {
          throw new Error(`${artifact.sha256}: cross-target exact artifact evidence mismatch`);
        }
        existing.uses.push(
          ...artifact.uses.map((use) => ({
            ...use,
            usage_binding_id: use.usage_binding_id ?? use.inventory_id ?? null,
            usage_binding_sha256:
              use.usage_binding_sha256 ?? inventoryHashes.get(use.inventory_id) ?? null,
          })),
        );
      } else {
        artifactsByHash.set(artifact.sha256, {
          artifact,
          evidence,
          uses: artifact.uses.map((use) => ({
            ...use,
            usage_binding_id: use.usage_binding_id ?? use.inventory_id ?? null,
            usage_binding_sha256:
              use.usage_binding_sha256 ?? inventoryHashes.get(use.inventory_id) ?? null,
          })),
        });
      }
    }
  }

  const policy = loadLicensePolicy();
  const autoApproved = [];
  const requiredReview = [];
  const hardBlocked = [];
  const usageEvaluations = [];
  const coverageRevalidation = coverageRoot
    ? loadCoverageRevalidation(coverageRoot, artifactsByHash)
    : {
        contract_status: 'NOT_RUN',
        production_approval_used: false,
        fixtures: [],
      };
  const bundleEvidenceRoot = resolve(outputRoot, 'evidence-v3');
  mkdirSync(bundleEvidenceRoot, { recursive: true });
  for (const entry of [...artifactsByHash.values()].sort((left, right) =>
    left.artifact.sha256.localeCompare(right.artifact.sha256),
  )) {
    const { artifact, uses } = entry;
    const evidence = structuredClone(entry.evidence);
    const rawExpression = evidence.raw_license_evidence.reported_license_expression;
    if (evidence.evidence_status === 'PASS' && rawExpression) {
      const decisions = uses.map((use) => roleDecision(artifact, rawExpression, use, 'PASS'));
      usageEvaluations.push(
        ...decisions.map((decision, index) =>
          usageEvaluation(
            artifact,
            uses[index],
            decision,
            decision.policy_result === 'PASS'
              ? 'AUTO_POLICY_PASS'
              : decision.policy_result === 'MANUAL_REVIEW'
                ? 'NEW_REQUIRED_REVIEW'
                : 'HARD_BLOCKED',
            'exact artifact expression evaluated by the pinned policy',
          ),
        ),
      );
      if (decisions.every((decision) => decision.policy_result === 'PASS')) {
        autoApproved.push({
          package: artifact.package,
          version: artifact.version,
          filename: artifact.filename,
          sha256: artifact.sha256,
          targets: [...new Set(uses.map((use) => use.target))].sort(),
          scopes: [...new Set(uses.map((use) => use.scope))].sort(),
          decision_source: 'ARTIFACT_REPORTED_VALID_SPDX',
          reported_expression: rawExpression,
          evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
          policy_version: policy.document.license_policy_version,
          policy_sha256: policy.sha256,
          policy_result: 'PASS',
          policy_decisions: decisions,
        });
      } else if (decisions.every((decision) => decision.policy_result !== 'FAIL')) {
        requiredReview.push(requiredReviewRecord({ artifact, evidence, uses, decisions }));
      } else {
        hardBlocked.push(
          hardBlock(
            artifact,
            evidence,
            uses,
            'ARTIFACT_REPORTED_SPDX_NOT_APPROVED_BY_CURRENT_PROJECT_POLICY',
            decisions.some((decision) => decision.policy_result === 'MANUAL_REVIEW')
              ? 'MANUAL_LEGAL_OR_PROJECT_POLICY_REVIEW_REQUIRED'
              : 'REPLACE_ARTIFACT_OR_USE_A_SEPARATELY_APPROVED_POLICY_CHANGE',
            decisions,
            'L3',
            decisions.map((decision, index) =>
              usageEvaluation(
                artifact,
                uses[index],
                decision,
                'HARD_BLOCKED',
                'exact artifact expression is rejected by current policy',
              ),
            ),
          ),
        );
      }
    } else if (evidence.evidence_status === 'MANUAL_REVIEW') {
      const suggestion = machineSuggestion(evidence);
      if (!suggestion) {
        usageEvaluations.push(
          ...uses.map((use) =>
            usageEvaluation(
              artifact,
              use,
              null,
              'HARD_BLOCKED',
              'exact artifact evidence has no deterministic normalization',
            ),
          ),
        );
        hardBlocked.push(
          hardBlock(
            artifact,
            evidence,
            uses,
            'RAW_ARTIFACT_EVIDENCE_CANNOT_BE_NORMALIZED_UNAMBIGUOUSLY',
            'MANUAL_LEGAL_FACT_REVIEW_OR_REPLACE_ARTIFACT',
            [],
            'L3',
            uses.map((use) =>
              usageEvaluation(
                artifact,
                use,
                null,
                'HARD_BLOCKED',
                'exact artifact evidence has no deterministic normalization',
              ),
            ),
          ),
        );
      } else {
        evidence.machine_suggestion ??= {
          status: 'UNAPPROVED_MACHINE_SUGGESTION',
          suggested_spdx_expression: suggestion.expression,
          generator: 'code-c-exact-artifact-evidence-normalizer/v1',
        };
        validateArtifactLicenseEvidenceV3(evidence);
        const specialized = loadSpecializedEvidence(artifact);
        const decisions = uses.map(
          (use) =>
            specializedDecision(artifact, suggestion.expression, use, specialized) ??
            roleDecision(artifact, suggestion.expression, use, 'PASS'),
        );
        usageEvaluations.push(
          ...decisions.map((decision, index) =>
            usageEvaluation(
              artifact,
              uses[index],
              decision,
              decision.policy_result === 'PASS'
                ? 'NEW_REQUIRED_REVIEW'
                : decision.policy_result === 'MANUAL_REVIEW'
                  ? 'NEW_REQUIRED_REVIEW'
                  : 'HARD_BLOCKED',
              'suggested exact-artifact license fact evaluated by the pinned policy',
            ),
          ),
        );
        if (decisions.every((decision) => decision.policy_result !== 'FAIL')) {
          const request = requiredReviewRecord({ artifact, evidence, uses, suggestion, decisions });
          request.specialized_existing_evidence = specialized
            ? {
                schema_version: specialized.value.schema_version,
                path: specialized.path,
                sha256: await sha256File(specialized.path),
                expression: specialized.value.package_license.expression,
                context_bound_usage_gate_still_required: true,
              }
            : null;
          requiredReview.push(request);
        } else {
          hardBlocked.push(
            hardBlock(
              artifact,
              evidence,
              uses,
              decisions.some((decision) => decision.policy_result === 'FAIL')
                ? 'SUGGESTED_LICENSE_FACT_IS_REJECTED_BY_CURRENT_PROJECT_POLICY'
                : 'SUGGESTED_LICENSE_FACT_REQUIRES_MANUAL_LEGAL_OR_PROJECT_POLICY_REVIEW',
              'FACT_REVIEW_MAY_CLARIFY_THE_LICENSE_BUT_CANNOT_OVERRIDE_PROJECT_POLICY',
              decisions,
              'L3',
              decisions.map((decision, index) =>
                usageEvaluation(
                  artifact,
                  uses[index],
                  decision,
                  'HARD_BLOCKED',
                  'suggested exact-artifact license fact is rejected by current policy',
                ),
              ),
            ),
          );
        }
      }
    } else {
      usageEvaluations.push(
        ...uses.map((use) =>
          usageEvaluation(
            artifact,
            use,
            null,
            'HARD_BLOCKED',
            evidence.evidence_status === 'FAIL'
              ? 'exact wheel has no artifact-contained license evidence'
              : 'exact wheel license evidence is internally conflicting',
          ),
        ),
      );
      hardBlocked.push(
        hardBlock(
          artifact,
          evidence,
          uses,
          evidence.evidence_status === 'FAIL'
            ? 'INSUFFICIENT_EXACT_ARTIFACT_LICENSE_EVIDENCE'
            : 'CONFLICTING_EXACT_ARTIFACT_LICENSE_EVIDENCE',
          'REPLACE_ARTIFACT_OR_ADD_FORMALLY_SUPPORTED_NON_WHEEL_LICENSE_EVIDENCE',
          [],
          'L3',
          uses.map((use) =>
            usageEvaluation(
              artifact,
              use,
              null,
              'HARD_BLOCKED',
              evidence.evidence_status === 'FAIL'
                ? 'exact wheel has no artifact-contained license evidence'
                : 'exact wheel license evidence is internally conflicting',
            ),
          ),
        ),
      );
    }
    writeCanonicalJson(resolve(bundleEvidenceRoot, `${artifact.sha256}.json`), evidence);
  }

  // Coverage evidence can replace the old "no exact license evidence" blocker
  // only when the v1 record binds to the exact production artifact identity.
  // Regression fixtures with a filename or other identity mismatch stay hard
  // blocked; no basename or SHA-only inference is allowed here.
  if (coverageRoot) {
    for (let index = hardBlocked.length - 1; index >= 0; index -= 1) {
      const blocked = hardBlocked[index];
      if (blocked.package !== 'sentencepiece') continue;
      const coverage = coverageRevalidation.fixtures.find(
        (fixture) =>
          fixture.artifact.sha256 === blocked.sha256 &&
          fixture.fixture_name ===
            (blocked.targets.includes('windows') ? 'sentencepiece-windows' : 'sentencepiece-linux'),
      );
      if (!coverage || coverage.status !== 'PASS') continue;
      if (!coverage.exact_artifact_match) {
        blocked.block_reason = 'LICENSE_COVERAGE_NOT_BOUND_TO_CURRENT_EXACT_ARTIFACT';
        blocked.required_next_action =
          'REISSUE_OR_BIND_COVERAGE_TO_CURRENT_EXACT_ARTIFACT_IDENTITY';
        blocked.coverage_evidence = {
          fixture_id: coverage.fixture_id,
          coverage_status: coverage.status,
          exact_artifact_match: coverage.exact_artifact_match,
          identity_mismatch_fields: coverage.identity_mismatch_fields,
          coverage_record_sha256: coverage.coverage_record_sha256,
          upstream_binding_record_sha256: coverage.upstream_binding_record_sha256,
        };
        continue;
      }
      if (!coverage.review_statuses.includes('REQUIRES_REVIEW')) continue;
      const artifactEntry = artifactsByHash.get(blocked.sha256);
      if (!artifactEntry) throw new Error(`${blocked.sha256}: coverage artifact disappeared`);
      const reviewRecord = coverageRequiredReviewRecord({
        artifact: artifactEntry.artifact,
        uses: artifactEntry.uses,
        coverage,
      });
      requiredReview.push(reviewRecord);
      const blockedUsageKeys = new Set(
        blocked.usage_evaluations.map(
          (usage) => `${usage.target}\0${usage.scope}\0${usage.inventory_id}`,
        ),
      );
      for (const usage of usageEvaluations) {
        const key = `${usage.target}\0${usage.scope}\0${usage.inventory_id}`;
        if (usage.artifact_sha256 === blocked.sha256 && blockedUsageKeys.has(key)) {
          usage.disposition = 'NEW_REQUIRED_REVIEW';
          usage.policy_result = null;
          usage.reason =
            'exact artifact is covered by License Coverage v1; authorized Artifact License Review remains pending';
        }
      }
      hardBlocked.splice(index, 1);
    }
  }
  requiredReview.sort((left, right) => left.sha256.localeCompare(right.sha256));

  const total = artifactsByHash.size;
  if (autoApproved.length + requiredReview.length + hardBlocked.length !== total) {
    throw new Error('license classification is not complete and exclusive');
  }
  const dispositionCounts = {
    AUTO_POLICY_PASS: usageEvaluations.filter((entry) => entry.disposition === 'AUTO_POLICY_PASS')
      .length,
    HISTORICAL_LICENSE_REVIEW_REUSE: usageEvaluations.filter(
      (entry) => entry.disposition === 'HISTORICAL_LICENSE_REVIEW_REUSE',
    ).length,
    NEW_REQUIRED_REVIEW: usageEvaluations.filter(
      (entry) => entry.disposition === 'NEW_REQUIRED_REVIEW',
    ).length,
    HARD_BLOCKED: usageEvaluations.filter((entry) => entry.disposition === 'HARD_BLOCKED').length,
  };
  const usageCount = [...artifactsByHash.values()].reduce(
    (count, entry) => count + entry.uses.length,
    0,
  );
  if (
    usageEvaluations.length !== usageCount ||
    Object.values(dispositionCounts).reduce((sum, count) => sum + count, 0) !== usageCount
  ) {
    throw new Error('license usage disposition partition is incomplete or non-exclusive');
  }
  const evidenceGeneratorPath = resolve('tools/python-supply-chain/inspect-wheel.py');
  const evidenceGeneratorSha256 = await sha256File(evidenceGeneratorPath);
  const licenseSubjectClosureSha256 = licenseIdentityHash({
    policy_version: policy.document.license_policy_version,
    policy_sha256: policy.sha256,
    evidence_generator: {
      id: 'inspect-wheel.py/exact-license-evidence/v1',
      sha256: evidenceGeneratorSha256,
    },
    artifacts: [...artifactsByHash.values()].map(({ artifact, evidence, uses }) => ({
      package: artifact.package,
      version: artifact.version,
      filename: artifact.filename,
      sha256: artifact.sha256,
      evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
      uses,
    })),
    usage_evaluations: usageEvaluations,
  });
  const sentencepieceArtifacts = [...artifactsByHash.values()].filter(
    ({ artifact }) => artifact.package === 'sentencepiece',
  );
  const pyinstallerHooksUses = [...artifactsByHash.values()]
    .filter(({ artifact }) => artifact.package === 'pyinstaller-hooks-contrib')
    .flatMap(({ uses }) => uses);
  const currentSubjectSets = targets.map((target) => target.license_target_subject_set);
  if (currentSubjectSets.every(Boolean)) {
    for (const [index, subjectSet] of currentSubjectSets.entries()) {
      if (
        subjectSet.discovery_model !== 'ACTIVE_EXACT_SUBJECT_APPROVALS' ||
        subjectSet.filesystem_filename_is_subject_authority !== false ||
        subjectSet.approval_discovery_index_is_authority !== false ||
        subjectSet.inventories?.length !== 4 ||
        subjectSet.toolchains?.length !== 2
      ) {
        throw new Error(
          `${targets[index].target}: current License Target subject set binding is invalid`,
        );
      }
    }
  }
  const graphBinding = {
    code_c_head_sha: evaluationHead,
    main_quality_baseline_sha: mainBaseline,
    minimum_required_license_contract_baseline: MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE,
    baseline_semantics: 'MINIMUM_CAPABILITY_FLOOR',
    windows_graph_id: targets.find((target) => target.target === 'windows').graph_id,
    linux_graph_id: targets.find((target) => target.target === 'linux').graph_id,
    windows_artifact_set_sha256: targets.find((target) => target.target === 'windows')
      .artifact_set_sha256,
    linux_artifact_set_sha256: targets.find((target) => target.target === 'linux')
      .artifact_set_sha256,
  };
  if (currentSubjectSets.every(Boolean)) {
    graphBinding.license_target_subject_sets = targets.map((target) => ({
      target: target.target,
      subject_set_sha256: target.license_target_subject_set.subject_set_sha256,
      approval_subject_set_sha256: target.license_target_subject_set.approval_subject_set_sha256,
      inventories: target.license_target_subject_set.inventories,
      toolchains: target.license_target_subject_set.toolchains,
      worker_build_context_sha256: target.license_target_subject_set.worker_build_context_sha256,
      license_evaluator: target.license_target_subject_set.license_evaluator,
    }));
  }
  const identity = licenseIdentityHash({
    graph_binding: graphBinding,
    auto_approved_artifacts: autoApproved,
    required_review_artifacts: requiredReview,
    hard_blocked_artifacts: hardBlocked,
  });
  const document = {
    schema_version: '1',
    document_type: 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE',
    license_review_bundle_id: `code-c-artifact-license-review-${identity.slice(0, 24)}`,
    bundle_identity_sha256: identity,
    bundle_semantics: 'REVIEW_REQUEST_CONTAINER_NOT_BLANKET_APPROVAL',
    graph_binding: graphBinding,
    contracts: {
      artifact_license_evidence: 'v3',
      artifact_license_review: 'v1',
      license_coverage: 'v1',
      upstream_release_binding: 'v1',
    },
    policy: {
      version: policy.document.license_policy_version,
      sha256: policy.sha256,
    },
    counts: {
      total_unique_wheel_artifacts: total,
      auto_approved_by_evidence: autoApproved.length,
      required_review: requiredReview.length,
      hard_blocked: hardBlocked.length,
    },
    count_domains: {
      unique_license_artifact_count: total,
      license_usage_evaluation_count: usageCount,
      auto_policy_pass_usage_count: dispositionCounts.AUTO_POLICY_PASS,
      historical_license_review_reuse_usage_count:
        dispositionCounts.HISTORICAL_LICENSE_REVIEW_REUSE,
      new_required_review_usage_count: dispositionCounts.NEW_REQUIRED_REVIEW,
      new_required_review_unique_artifact_count: requiredReview.length,
      hard_blocked_usage_count: dispositionCounts.HARD_BLOCKED,
      hard_blocked_unique_artifact_count: hardBlocked.length,
    },
    license_disposition_partition: {
      status: 'PASS',
      invariant:
        'license_usage_evaluation_count = auto_policy_pass_usage_count + historical_license_review_reuse_usage_count + new_required_review_usage_count + hard_blocked_usage_count',
      usage_evaluations: usageEvaluations,
    },
    license_evidence_authority: {
      extraction_source: 'EXACT_ARTIFACT_ARCHIVE_BYTES',
      artifact_sha_binding: 'PASS',
      installed_site_packages_metadata_used_as_license_authority: 'NO',
      approved_artifact_bytes_mutated_for_license_evidence: 'NO',
      wheel_repacked_for_license_evidence: 'NO',
      approved_artifact_sha_changed: 'NO',
    },
    license_evidence_generator: {
      id: 'inspect-wheel.py/exact-license-evidence/v1',
      sha256: evidenceGeneratorSha256,
    },
    license_subject_closure_sha256: licenseSubjectClosureSha256,
    diagnostics: {
      sentencepiece_unique_artifact_count: sentencepieceArtifacts.length,
      sentencepiece_usage_evaluation_count: usageEvaluations.filter(
        (entry) => entry.package === 'sentencepiece',
      ).length,
      pyinstaller_hooks_contrib_role: pyinstallerHooksUses.map((use) => ({
        artifact_role: use.artifact_role,
        distribution_role: use.distribution_role,
        target: use.target,
        scope: use.scope,
      })),
      hard_block_diagnostics: hardBlocked,
      license_coverage_revalidation: coverageRevalidation,
      license_closure_rebind: {
        target_evidence_code_c_head_sha: head,
        target_evidence_main_quality_baseline_sha: targetGraphBaseline,
        evaluator_head_sha: evaluationHead,
        current_main_quality_baseline_sha: mainBaseline,
        target_evidence_rebound_without_worker_rebuild: Boolean(
          requestedBaseline || requestedEvaluatorHead,
        ),
      },
    },
    classification_complete_and_exclusive: true,
    regression_fixture_used_as_production_approval: false,
    pyinstaller_worker_build_license: Object.fromEntries(
      targets.map((target) => [target.target, target.pyinstaller_worker_build_license]),
    ),
    auto_approved_artifacts: autoApproved,
    required_review_artifacts: requiredReview,
    hard_blocked_artifacts: hardBlocked,
    python_license_gate:
      hardBlocked.length > 0
        ? 'FAIL'
        : requiredReview.length > 0
          ? 'BLOCKED_PENDING_ARTIFACT_LICENSE_REVIEW'
          : 'PASS',
    f_license_review: requiredReview.length > 0 ? 'PENDING' : 'NOT_REQUIRED',
    license_review_bundle_status:
      hardBlocked.length > 0 ? 'DIAGNOSTIC_PRE_HARD_BLOCK_CLOSURE' : 'READY_FOR_CODE_F_REVIEW',
    license_review_graph_reconciliation: 'NOT_STARTED',
    stage_b: 'BLOCKED_NOT_RERUN',
  };
  mkdirSync(outputRoot, { recursive: true });
  const bundlePath = resolve(outputRoot, 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.json');
  writeCanonicalJson(bundlePath, document);
  const fileSha256 = await sha256File(bundlePath);
  writeFileSync(
    resolve(outputRoot, 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.sha256'),
    `${fileSha256}  ${bundlePath.split('/').at(-1)}\n`,
  );
  const summary = {
    schema_version: '1',
    status: 'PASS',
    license_review_bundle_id: document.license_review_bundle_id,
    license_review_bundle_sha256: fileSha256,
    ...graphBinding,
    ...document.counts,
    ...document.count_domains,
    license_disposition_partition: document.license_disposition_partition.status,
    license_evidence_generator: document.license_evidence_generator,
    license_subject_closure_sha256: document.license_subject_closure_sha256,
    python_license_gate: document.python_license_gate,
    f_license_review: document.f_license_review,
    license_review_bundle_status: document.license_review_bundle_status,
    license_review_graph_reconciliation: document.license_review_graph_reconciliation,
    stage_b: document.stage_b,
  };
  writeCanonicalJson(resolve(outputRoot, 'CODE_C_LICENSE_REVIEW_PREPARATION.json'), summary);
  console.log(
    `code-c-license-review-bundle: PASS (${document.license_review_bundle_id}; ${fileSha256}; ` +
      `${total} total, ${autoApproved.length} auto, ${requiredReview.length} review, ${hardBlocked.length} blocked)`,
  );
}

main().catch((error) => {
  console.error(`code-c-license-review-bundle: FAIL\n${error.message}`);
  process.exitCode = 1;
});
