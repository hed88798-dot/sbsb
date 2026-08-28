import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpdxExpression, renderSpdxAst, spdxParserIdentity } from './spdx-parser.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const defaultLicensePolicyPath = resolve(
  repositoryRoot,
  'compliance/license-policy/python-spdx-v1/policy.json',
);

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

export function canonicalLicenseJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function licenseIdentityHash(value) {
  return createHash('sha256').update(canonicalLicenseJson(value)).digest('hex');
}

export function loadLicensePolicy(path = defaultLicensePolicyPath) {
  const bytes = readFileSync(path);
  const document = JSON.parse(bytes);
  return {
    path,
    document,
    sha256: licenseIdentityHash(document),
  };
}

function unique(values) {
  return [...new Set(values)].sort();
}

function combineFlags(obligations) {
  const values = new Set(obligations);
  return {
    notice_required:
      values.has('PRESERVE_LICENSE_TEXT') ||
      values.has('PRESERVE_COPYRIGHT_NOTICE') ||
      values.has('PRESERVE_PERMISSION_NOTICE') ||
      values.has('PRESERVE_REQUIRED_NOTICES') ||
      values.has('PRESERVE_PYINSTALLER_LICENSE_AND_EXCEPTION_TEXT') ||
      values.has('RETAIN_NOTICE_IN_SUPPORTING_DOCUMENTATION_OR_DISTRIBUTION_MATERIAL'),
    attribution_required:
      values.has('PROVIDE_ATTRIBUTION') || values.has('PRESERVE_COPYRIGHT_NOTICE'),
    source_offer_required: values.has('PROVIDE_CORRESPONDING_SOURCE'),
    no_endorsement_required: values.has('NO_ENDORSEMENT'),
    no_publicity_name_use_without_permission: values.has(
      'NO_PUBLICITY_NAME_USE_WITHOUT_PERMISSION',
    ),
  };
}

function leafResult(node, context) {
  const expression = renderSpdxAst(node);
  if (node.identifier_status === 'CUSTOM_REFERENCE') {
    return {
      expression,
      policy_result: 'MANUAL_REVIEW',
      obligations: ['CUSTOM_LICENSE_REFERENCE_REQUIRES_EXPLICIT_APPROVAL'],
      acceptable_or_branches: [],
      branch_evaluations: [],
      exceptions: [],
      reason: 'LicenseRef/DocumentRef requires approved custom-license evidence and policy',
    };
  }
  if (node.identifier_status === 'UNKNOWN' || node.exception_status === 'UNKNOWN') {
    return {
      expression,
      policy_result: 'FAIL',
      obligations: [],
      acceptable_or_branches: [],
      branch_evaluations: [],
      exceptions: [],
      reason: 'identifier is not present in the pinned SPDX data',
    };
  }
  if (node.or_later) {
    return {
      expression,
      policy_result: 'MANUAL_REVIEW',
      obligations: ['DEPRECATED_PLUS_SYNTAX_REQUIRES_NORMALIZATION_REVIEW'],
      acceptable_or_branches: [],
      branch_evaluations: [],
      exceptions: [],
      reason: 'deprecated plus syntax is not silently mapped to a policy rule',
    };
  }
  if (node.exception_id) {
    const rule = context.policy.exception_rules.find(
      (candidate) =>
        candidate.base_license === node.license_id && candidate.exception === node.exception_id,
    );
    if (!rule) {
      return {
        expression,
        policy_result: 'MANUAL_REVIEW',
        obligations: ['UNREVIEWED_LICENSE_EXCEPTION'],
        acceptable_or_branches: [],
        branch_evaluations: [],
        exceptions: [],
        reason: 'the valid SPDX exception has no approved policy rule',
      };
    }
    const applicability = rule.applicability.find(
      (candidate) =>
        candidate.artifact_role === context.evidence.artifact_role &&
        candidate.distribution_role === context.evidence.distribution_role,
    );
    const exceptionEvidence = context.evidence.exception_evidence ?? [];
    const availableEvidence = new Set(exceptionEvidence.map((entry) => entry.evidence_type));
    const missingEvidence = rule.required_evidence_types.filter(
      (evidenceType) =>
        !availableEvidence.has(evidenceType) ||
        (evidenceType === 'EXCEPTION_SOURCE' &&
          !exceptionEvidence.some(
            (entry) =>
              entry.evidence_type === 'EXCEPTION_SOURCE' && entry.source === rule.exception_source,
          )),
    );
    const policyResult = !applicability
      ? 'FAIL'
      : missingEvidence.length > 0
        ? 'MANUAL_REVIEW'
        : applicability.policy_result;
    const obligations = unique([
      ...rule.retained_obligations,
      ...(applicability?.policy_result === 'MANUAL_REVIEW'
        ? ['EXCEPTION_APPLICABILITY_MANUAL_REVIEW_REQUIRED']
        : []),
    ]);
    return {
      expression,
      policy_result: policyResult,
      obligations,
      acceptable_or_branches: policyResult === 'PASS' ? [expression] : [],
      branch_evaluations: [],
      exceptions: [
        {
          base_license: node.license_id,
          exception: node.exception_id,
          full_expression: expression,
          artifact_role: context.evidence.artifact_role,
          distribution_role: context.evidence.distribution_role,
          exception_evidence: exceptionEvidence,
          exception_source: rule.exception_source,
          covered_obligations: rule.covered_obligations,
          retained_obligations: rule.retained_obligations,
          missing_evidence_types: missingEvidence,
          policy_result: policyResult,
        },
      ],
      reason: applicability
        ? missingEvidence.length > 0
          ? 'required exception evidence is incomplete'
          : 'exception rule matched artifact and distribution roles'
        : 'exception is not approved for this artifact/distribution role pair',
    };
  }
  const rule = context.policy.license_rules[node.license_id];
  if (!rule) {
    return {
      expression,
      policy_result: 'FAIL',
      obligations: [],
      acceptable_or_branches: [],
      branch_evaluations: [],
      exceptions: [],
      reason: 'SPDX identifier has no rule in the pinned commercial policy',
    };
  }
  return {
    expression,
    policy_result: rule.policy_result,
    obligations: unique(rule.obligations),
    policy_rule_id: rule.rule_id ?? null,
    commercial_use: rule.commercial_use ?? null,
    distribution: rule.distribution ?? null,
    copyright_holders: rule.copyright_holders ?? [],
    acceptable_or_branches: rule.policy_result === 'PASS' ? [expression] : [],
    branch_evaluations: [],
    exceptions: [],
    reason: 'matched versioned license policy rule',
  };
}

function conjunctionResult(node, context) {
  const left = evaluateNode(node.left, context);
  const right = evaluateNode(node.right, context);
  const branches = [left, right];
  const expression = renderSpdxAst(node);
  if (node.operator === 'AND') {
    const policyResult = branches.some((entry) => entry.policy_result === 'FAIL')
      ? 'FAIL'
      : branches.some((entry) => entry.policy_result === 'MANUAL_REVIEW')
        ? 'MANUAL_REVIEW'
        : 'PASS';
    return {
      expression,
      policy_result: policyResult,
      obligations: unique(branches.flatMap((entry) => entry.obligations)),
      acceptable_or_branches: [],
      branch_evaluations: branches.map(branchSummary),
      exceptions: branches.flatMap((entry) => entry.exceptions),
      reason: 'AND requires every branch and aggregates every obligation',
    };
  }

  const acceptable = branches.filter((entry) => entry.policy_result === 'PASS');
  const selected = context.selectedPolicyBranch
    ? acceptable.find((entry) => entry.expression === context.selectedPolicyBranch)
    : null;
  let policyResult;
  let obligations;
  if (context.selectedPolicyBranch && !selected) {
    policyResult = 'FAIL';
    obligations = ['SELECTED_OR_BRANCH_IS_NOT_ACCEPTABLE'];
  } else if (selected) {
    policyResult = 'PASS';
    obligations = selected.obligations;
  } else if (acceptable.length === 0) {
    policyResult = branches.some((entry) => entry.policy_result === 'MANUAL_REVIEW')
      ? 'MANUAL_REVIEW'
      : 'FAIL';
    obligations = unique(branches.flatMap((entry) => entry.obligations));
  } else if (context.policy.or_branch_selection_required) {
    policyResult = 'MANUAL_REVIEW';
    obligations = ['SELECT_ACCEPTABLE_POLICY_BRANCH'];
  } else {
    policyResult = 'PASS';
    obligations = unique([
      'FULFILL_ONE_ACCEPTABLE_POLICY_BRANCH',
      ...acceptable.flatMap((entry) => entry.obligations),
    ]);
  }
  return {
    expression,
    policy_result: policyResult,
    obligations: unique(obligations),
    acceptable_or_branches: acceptable.map((entry) => entry.expression).sort(),
    branch_evaluations: branches.map(branchSummary),
    exceptions: branches.flatMap((entry) => entry.exceptions),
    reason: 'OR records every branch; branch order never selects the licensing path',
  };
}

function branchSummary(result) {
  return {
    expression: result.expression,
    policy_result: result.policy_result,
    obligations: result.obligations,
  };
}

function evaluateNode(node, context) {
  return node.type === 'conjunction' ? conjunctionResult(node, context) : leafResult(node, context);
}

function failedEvaluation(evidence, policy, policyHash, policyInputHash, message) {
  return {
    artifact_sha256: evidence.artifact_sha256,
    package: evidence.package,
    version: evidence.version,
    artifact_type: evidence.artifact_type,
    artifact_role: evidence.artifact_role,
    distribution_role: evidence.distribution_role,
    detected_license_expression: evidence.detected_license_expression,
    normalized_expression: null,
    acceptable_or_branches: [],
    selected_policy_branch: null,
    branch_evaluations: [],
    exceptions: [],
    policy_result: 'FAIL',
    obligations: [],
    notice_required: false,
    attribution_required: false,
    source_offer_required: false,
    no_endorsement_required: false,
    no_publicity_name_use_without_permission: false,
    manual_review_required: false,
    evidence_status: evidence.evidence_status,
    evidence_sources: evidence.evidence_sources ?? [],
    parser_name: spdxParserIdentity.parser_name,
    parser_version: spdxParserIdentity.parser_version,
    spdx_license_list_version: spdxParserIdentity.spdx_license_list_version,
    spdx_exception_list_version: spdxParserIdentity.spdx_exception_list_version,
    license_policy_version: policy.license_policy_version,
    license_policy_sha256: policyHash,
    policy_input_hash: policyInputHash,
    reason: message,
  };
}

export function evaluateLicenseEvidence(
  evidence,
  { policy: loadedPolicy = loadLicensePolicy(), selectedPolicyBranch = null } = {},
) {
  const policy = loadedPolicy.document ?? loadedPolicy;
  const policyHash = loadedPolicy.sha256 ?? licenseIdentityHash(policy);
  const policyInputHash = licenseIdentityHash({
    evidence,
    selected_policy_branch: selectedPolicyBranch,
    license_policy_version: policy.license_policy_version,
    license_policy_sha256: policyHash,
    parser: spdxParserIdentity,
  });
  if (!policy.artifact_roles.includes(evidence.artifact_role)) {
    return failedEvaluation(
      evidence,
      policy,
      policyHash,
      policyInputHash,
      'unknown artifact role is fail closed',
    );
  }
  if (!policy.distribution_roles.includes(evidence.distribution_role)) {
    return failedEvaluation(
      evidence,
      policy,
      policyHash,
      policyInputHash,
      'unknown distribution role is fail closed',
    );
  }
  let parsed;
  try {
    parsed = parseSpdxExpression(evidence.detected_license_expression);
  } catch (error) {
    return failedEvaluation(
      evidence,
      policy,
      policyHash,
      policyInputHash,
      `SPDX parser rejected expression: ${error.message}`,
    );
  }
  const nodeResult = evaluateNode(parsed.ast, {
    policy,
    evidence,
    selectedPolicyBranch,
  });
  let policyResult = nodeResult.policy_result;
  let reason = nodeResult.reason;
  if (evidence.evidence_status === 'CONFLICT' || evidence.evidence_status === 'FAIL') {
    policyResult = 'FAIL';
    reason = 'artifact license evidence conflict/failure blocks the policy decision';
  } else if (evidence.evidence_status !== 'PASS' && policyResult === 'PASS') {
    policyResult = 'MANUAL_REVIEW';
    reason = 'artifact license evidence is incomplete and requires manual review';
  }
  const flags = combineFlags(nodeResult.obligations);
  return {
    artifact_sha256: evidence.artifact_sha256,
    package: evidence.package,
    version: evidence.version,
    artifact_type: evidence.artifact_type,
    artifact_role: evidence.artifact_role,
    distribution_role: evidence.distribution_role,
    detected_license_expression: evidence.detected_license_expression,
    normalized_expression: parsed.normalized_expression,
    acceptable_or_branches: nodeResult.acceptable_or_branches,
    selected_policy_branch: selectedPolicyBranch,
    branch_evaluations: nodeResult.branch_evaluations,
    exceptions: nodeResult.exceptions,
    policy_result: policyResult,
    obligations: nodeResult.obligations,
    policy_rule_id: nodeResult.policy_rule_id ?? null,
    commercial_use: nodeResult.commercial_use ?? null,
    distribution: nodeResult.distribution ?? null,
    copyright_holders: nodeResult.copyright_holders ?? [],
    ...flags,
    manual_review_required: policyResult === 'MANUAL_REVIEW',
    evidence_status: evidence.evidence_status,
    evidence_sources: evidence.evidence_sources ?? [],
    parser_name: spdxParserIdentity.parser_name,
    parser_version: spdxParserIdentity.parser_version,
    spdx_license_list_version: spdxParserIdentity.spdx_license_list_version,
    spdx_exception_list_version: spdxParserIdentity.spdx_exception_list_version,
    license_policy_version: policy.license_policy_version,
    license_policy_sha256: policyHash,
    policy_input_hash: policyInputHash,
    reason,
  };
}

export function evaluateLicenseCollection(evidences, options = {}) {
  const decisions = evidences.map((evidence) => evaluateLicenseEvidence(evidence, options));
  return {
    schema_version: '2',
    license_policy_version: decisions[0]?.license_policy_version ?? null,
    license_policy_sha256: decisions[0]?.license_policy_sha256 ?? null,
    parser: spdxParserIdentity,
    summary: {
      artifacts: decisions.length,
      passed: decisions.filter((entry) => entry.policy_result === 'PASS').length,
      manual_review: decisions.filter((entry) => entry.policy_result === 'MANUAL_REVIEW').length,
      failed: decisions.filter((entry) => entry.policy_result === 'FAIL').length,
    },
    decisions,
  };
}

export function compareLicenseDecisionReports(previous, current) {
  const previousByArtifact = new Map(
    (previous.decisions ?? previous.packages ?? []).map((entry) => [entry.artifact_sha256, entry]),
  );
  return current.decisions
    .map((entry) => {
      const prior = previousByArtifact.get(entry.artifact_sha256);
      if (!prior || prior.policy_result === entry.policy_result) return null;
      return {
        artifact_sha256: entry.artifact_sha256,
        previous_policy_result: prior.policy_result,
        current_policy_result: entry.policy_result,
        previous_license_policy_version: previous.license_policy_version ?? null,
        current_license_policy_version: current.license_policy_version,
      };
    })
    .filter(Boolean);
}
