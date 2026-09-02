import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateLicenseEvidence,
  licenseIdentityHash,
  loadLicensePolicy,
} from '../../tools/license-policy/evaluator.mjs';
import { reEvaluateUsageUniverse } from '../../tools/license-policy/re-evaluate-usage-universe.mjs';
import {
  evaluateLicenseCoverage,
  validateBuildOnlyUsageBinding,
} from '../../tools/license-policy/coverage.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const hooksFixtureRoot = join(
  repositoryRoot,
  'tests/fixtures/license-coverage/pyinstaller-hooks-contrib',
);
const hooksArtifact = JSON.parse(readFileSync(join(hooksFixtureRoot, 'artifact.json'), 'utf8'));
const hooksMembers = JSON.parse(readFileSync(join(hooksFixtureRoot, 'members.json'), 'utf8'));
const hooksCoverage = JSON.parse(readFileSync(join(hooksFixtureRoot, 'coverage.json'), 'utf8'));
const hooksUsageBinding = JSON.parse(
  readFileSync(join(hooksFixtureRoot, 'usage-binding.json'), 'utf8'),
);
const currentUniverse = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'tests/fixtures/license-policy/current-universe-v1.json'),
    'utf8',
  ),
);

function evidence(packageName: string, distributionRole: string): Record<string, unknown> {
  return {
    artifact_sha256: hooksArtifact.sha256,
    package: packageName,
    version: hooksArtifact.version,
    artifact_type: hooksArtifact.artifact_type,
    artifact_role: 'PYTHON_BUILD_DEPENDENCY',
    distribution_role: distributionRole,
    detected_license_expression: 'GPL-2.0-or-later',
    evidence_status: 'PASS',
    source_provenance: {
      source: 'https://example.invalid/frozen-review',
      review_status: 'APPROVED',
    },
    evidence_sources: [
      { evidence_type: 'LICENSE_FILE', relative_path: 'COPYING', sha256: 'b'.repeat(64) },
    ],
  };
}

const approvedBuildOnlyContext = {
  BUILD_ONLY_USAGE_BINDING: 'PASS',
  GPL_COMPONENT_DISTRIBUTED: 'NO',
  GPL_COMPONENT_MEMBERS_IN_FINAL_ARTIFACT: 0,
  COMPONENT_COVERAGE: 'COMPLETE',
  FINAL_ARTIFACT_RECONCILIATION: 'PASS',
  GPL_COVERED_CODE_COPIED_OR_INJECTED_INTO_FINAL_OUTPUT: 'NO',
};

describe('GPL build-only policy review', () => {
  it('binds the exact hooks artifact and records complete build-only component coverage', () => {
    expect(hooksArtifact).toMatchObject({
      package: 'pyinstaller-hooks-contrib',
      version: '2026.7',
      sha256: '24257a04c7a5a7a034cf28e39dcee20fbeeb9f043076729480f2e1b69904408a',
    });
    expect(
      evaluateLicenseCoverage({
        artifact: hooksArtifact,
        members: hooksMembers,
        records: hooksCoverage,
        upstreamBinding: null,
        expectedRelease: null,
      }),
    ).toMatchObject({
      status: 'PASS',
      covered_member_count: 3,
      unaccounted_license_relevant_member_count: 0,
    });
    expect(validateBuildOnlyUsageBinding(hooksUsageBinding)).toMatchObject({
      artifact_role: 'PYTHON_BUILD_DEPENDENCY',
      distribution_role: 'BUILD_ONLY_USE',
      distributed_in_final_worker: false,
      gpl_component_used_in_current_build: true,
    });
  });

  it('allows a fully bound generic GPL build-only use with conditions', () => {
    const buildOnlyEvidence = evidence('pyinstaller-hooks-contrib', 'BUILD_ONLY_USE');
    buildOnlyEvidence.usage_policy_context = approvedBuildOnlyContext;
    const buildOnly = evaluateLicenseEvidence(buildOnlyEvidence);
    const distributed = evaluateLicenseEvidence(
      evidence('pyinstaller-hooks-contrib', 'RUNTIME_DISTRIBUTION'),
    );
    expect(buildOnly).toMatchObject({
      policy_result: 'PASS',
      policy_rule_id: 'COPYLEFT_BUILD_ONLY_USE-v1',
      policy_disposition: 'ALLOW_WITH_CONDITIONS',
    });
    expect(distributed.policy_result).toBe('FAIL');
    expect(buildOnly.distribution_role).toBe('BUILD_ONLY_USE');
    expect(distributed.distribution_role).toBe('RUNTIME_DISTRIBUTION');
    expect(buildOnly.policy_input_hash).not.toBe(distributed.policy_input_hash);
  });

  it('applies the same generic semantics across packages and does not inherit distribution', () => {
    const hooksEvidence = evidence('pyinstaller-hooks-contrib', 'BUILD_ONLY_USE');
    hooksEvidence.usage_policy_context = approvedBuildOnlyContext;
    const unrelatedEvidence = evidence('unrelated-package', 'BUILD_ONLY_USE');
    unrelatedEvidence.usage_policy_context = approvedBuildOnlyContext;
    const hooks = evaluateLicenseEvidence(hooksEvidence);
    const unrelatedPackage = evaluateLicenseEvidence(unrelatedEvidence);
    const futureDistributedUse = evaluateLicenseEvidence(
      evidence('pyinstaller-hooks-contrib', 'TOOL_REDISTRIBUTION'),
    );
    expect(unrelatedPackage.policy_result).toBe(hooks.policy_result);
    expect(unrelatedPackage.policy_rule_id).toBe('COPYLEFT_BUILD_ONLY_USE-v1');
    expect(futureDistributedUse.policy_result).toBe('FAIL');
    expect(futureDistributedUse.policy_input_hash).not.toBe(hooks.policy_input_hash);
  });

  it('fails closed for false build-only assertions, incomplete coverage and missing binding', () => {
    const markedDistributed = structuredClone(hooksMembers);
    markedDistributed[0].usage = 'DISTRIBUTED';
    expect(() =>
      evaluateLicenseCoverage({
        artifact: hooksArtifact,
        members: markedDistributed,
        records: hooksCoverage,
        upstreamBinding: null,
        expectedRelease: null,
      }),
    ).toThrow(/cannot be classified BUILD_ONLY_USE/u);
    expect(() =>
      evaluateLicenseCoverage({
        artifact: hooksArtifact,
        members: hooksMembers,
        records: [hooksCoverage[0]],
        upstreamBinding: null,
        expectedRelease: null,
      }),
    ).toThrow(/uncovered license-relevant/u);
    expect(() => validateBuildOnlyUsageBinding(undefined)).toThrow(
      /build-only usage binding is not fail-closed/u,
    );
  });

  it.each([
    [
      'GPL component distributed',
      { ...approvedBuildOnlyContext, GPL_COMPONENT_DISTRIBUTED: 'YES' },
    ],
    [
      'GPL member appears in final Worker',
      { ...approvedBuildOnlyContext, GPL_COMPONENT_MEMBERS_IN_FINAL_ARTIFACT: 1 },
    ],
    [
      'GPL-covered code copied or injected',
      { ...approvedBuildOnlyContext, GPL_COVERED_CODE_COPIED_OR_INJECTED_INTO_FINAL_OUTPUT: 'YES' },
    ],
    ['usage binding missing', { ...approvedBuildOnlyContext, BUILD_ONLY_USAGE_BINDING: null }],
    [
      'component coverage incomplete',
      { ...approvedBuildOnlyContext, COMPONENT_COVERAGE: 'PARTIAL' },
    ],
    [
      'final artifact reconciliation missing',
      { ...approvedBuildOnlyContext, FINAL_ARTIFACT_RECONCILIATION: 'FAIL' },
    ],
  ])('blocks when %s', (_label, context) => {
    const candidate = evidence('generic-package', 'BUILD_ONLY_USE');
    candidate.usage_policy_context = context;
    expect(evaluateLicenseEvidence(candidate)).toMatchObject({
      policy_result: 'FAIL',
      policy_rule_id: 'COPYLEFT_BUILD_ONLY_USE-v1',
    });
  });

  it('does not inherit build-only disposition when the same artifact becomes distributed', () => {
    const candidate = evidence('generic-package', 'BUILD_ONLY_USE');
    candidate.usage_policy_context = approvedBuildOnlyContext;
    const buildOnly = evaluateLicenseEvidence(candidate);
    const distributed = evaluateLicenseEvidence({
      ...candidate,
      distribution_role: 'TOOL_REDISTRIBUTION',
    });
    expect(buildOnly.policy_result).toBe('PASS');
    expect(distributed.policy_result).toBe('FAIL');
  });

  it('re-evaluates the full current 37-usage partition without non-target drift', () => {
    expect(reEvaluateUsageUniverse(currentUniverse)).toMatchObject({
      total_usage: 37,
      target_change_count: 2,
      non_target_policy_disposition_drift_count: 0,
      license_disposition_partition: 'PASS',
      full_current_license_universe_reevaluation: true,
    });
  });

  it('pins the unchanged policy identity for this review', () => {
    const policy = loadLicensePolicy();
    expect(policy.document.license_policy_version).toBe('2026.09.02.1');
    expect(policy.sha256).toBe('9239adf47e2607b9404dd60fd7266ab628dd3d27a4715885b20a9834d8494518');
    expect(licenseIdentityHash(policy.document)).toBe(policy.sha256);
  });
});
