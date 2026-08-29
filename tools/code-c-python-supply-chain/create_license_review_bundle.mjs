import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256File } from '../python-supply-chain/inventory.mjs';
import { writeCanonicalJson } from './canonical-evidence.mjs';
import {
  loadLicensePolicy,
  evaluateLicenseEvidence,
  licenseIdentityHash,
} from '../license-policy/evaluator.mjs';
import { validateArtifactLicenseEvidenceV3 } from '../license-policy/artifact-review.mjs';

const REQUIRED_BASELINE = 'd1348c50e36b725bfcbf9bec17343392cf0412c7';
const CLASSIFIER_EXPRESSIONS = new Map([
  ['License :: OSI Approved :: Apache Software License', 'Apache-2.0'],
  ['License :: OSI Approved :: MIT License', 'MIT'],
  ['License :: OSI Approved :: GNU General Public License v2 (GPLv2)', 'GPL-2.0-or-later'],
  ['License :: OSI Approved :: ISC License (ISCL)', 'ISC'],
  ['License :: OSI Approved :: Python Software Foundation License', 'PSF-2.0'],
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function hardBlock(artifact, evidence, uses, reason, requiredNextAction, policyDecisions = []) {
  return {
    package: artifact.package,
    version: artifact.version,
    filename: artifact.filename,
    sha256: artifact.sha256,
    targets: [...new Set(uses.map((use) => use.target))].sort(),
    scopes: [...new Set(uses.map((use) => use.scope))].sort(),
    raw_license: evidence.raw_license_evidence,
    evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
    block_reason: reason,
    required_next_action: requiredNextAction,
    policy_decisions: policyDecisions,
  };
}

async function main() {
  const inputRoot = resolve(argument('--input-root'));
  const outputRoot = resolve(argument('--output-root'));
  const targets = ['linux', 'windows'].map((target) =>
    JSON.parse(readFileSync(resolve(inputRoot, target, 'target-license-evidence.json'), 'utf8')),
  );
  const headSet = new Set(targets.map((target) => target.code_c_head_sha));
  if (headSet.size !== 1) throw new Error('target graphs were not produced from one Code C HEAD');
  const head = [...headSet][0];
  for (const target of targets) {
    if (target.main_quality_baseline_sha !== REQUIRED_BASELINE) {
      throw new Error(`${target.target}: required main quality baseline is not bound`);
    }
    if (target.pyinstaller_worker_build_license?.status !== 'PASS') {
      throw new Error(`${target.target}: PyInstaller Worker-Build License was not revalidated`);
    }
  }

  const artifactsByHash = new Map();
  for (const target of targets) {
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
        existing.uses.push(...artifact.uses);
      } else {
        artifactsByHash.set(artifact.sha256, { artifact, evidence, uses: [...artifact.uses] });
      }
    }
  }

  const policy = loadLicensePolicy();
  const autoApproved = [];
  const requiredReview = [];
  const hardBlocked = [];
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
          ),
        );
      }
    } else if (evidence.evidence_status === 'MANUAL_REVIEW') {
      const suggestion = machineSuggestion(evidence);
      if (!suggestion) {
        hardBlocked.push(
          hardBlock(
            artifact,
            evidence,
            uses,
            'RAW_ARTIFACT_EVIDENCE_CANNOT_BE_NORMALIZED_UNAMBIGUOUSLY',
            'MANUAL_LEGAL_FACT_REVIEW_OR_REPLACE_ARTIFACT',
          ),
        );
      } else {
        evidence.machine_suggestion = {
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
        if (decisions.every((decision) => decision.policy_result === 'PASS')) {
          requiredReview.push({
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
            suggested_spdx_expression: suggestion.expression,
            suggestion_source: suggestion.source,
            suggestion_rationale: suggestion.rationale,
            suggestion_status: 'MACHINE_SUGGESTION_NOT_APPROVAL',
            evidence_references: evidenceReferences(evidence),
            evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
            specialized_existing_evidence: specialized
              ? {
                  schema_version: specialized.value.schema_version,
                  path: specialized.path,
                  sha256: await sha256File(specialized.path),
                  expression: specialized.value.package_license.expression,
                  context_bound_usage_gate_still_required: true,
                }
              : null,
            projected_policy_decisions: decisions,
            review_status: 'PENDING',
          });
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
            ),
          );
        }
      }
    } else {
      hardBlocked.push(
        hardBlock(
          artifact,
          evidence,
          uses,
          evidence.evidence_status === 'FAIL'
            ? 'INSUFFICIENT_EXACT_ARTIFACT_LICENSE_EVIDENCE'
            : 'CONFLICTING_EXACT_ARTIFACT_LICENSE_EVIDENCE',
          'REPLACE_ARTIFACT_OR_ADD_FORMALLY_SUPPORTED_NON_WHEEL_LICENSE_EVIDENCE',
        ),
      );
    }
    writeCanonicalJson(resolve(bundleEvidenceRoot, `${artifact.sha256}.json`), evidence);
  }

  const total = artifactsByHash.size;
  if (autoApproved.length + requiredReview.length + hardBlocked.length !== total) {
    throw new Error('license classification is not complete and exclusive');
  }
  const graphBinding = {
    code_c_head_sha: head,
    main_quality_baseline_sha: REQUIRED_BASELINE,
    windows_graph_id: targets.find((target) => target.target === 'windows').graph_id,
    linux_graph_id: targets.find((target) => target.target === 'linux').graph_id,
    windows_artifact_set_sha256: targets.find((target) => target.target === 'windows')
      .artifact_set_sha256,
    linux_artifact_set_sha256: targets.find((target) => target.target === 'linux')
      .artifact_set_sha256,
  };
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
    python_license_gate: document.python_license_gate,
    f_license_review: document.f_license_review,
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
