import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateLicenseEvidence,
  licenseIdentityHash,
  loadLicensePolicy,
} from '../../tools/license-policy/evaluator.mjs';
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

function evidence(packageName: string, distributionRole: string) {
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

  it('keeps bare GPL hard-rejected in both build-only and distributed contexts', () => {
    const buildOnly = evaluateLicenseEvidence(
      evidence('pyinstaller-hooks-contrib', 'BUILD_ONLY_USE'),
    );
    const distributed = evaluateLicenseEvidence(
      evidence('pyinstaller-hooks-contrib', 'RUNTIME_DISTRIBUTION'),
    );
    expect(buildOnly.policy_result).toBe('FAIL');
    expect(distributed.policy_result).toBe('FAIL');
    expect(buildOnly.distribution_role).toBe('BUILD_ONLY_USE');
    expect(distributed.distribution_role).toBe('RUNTIME_DISTRIBUTION');
    expect(buildOnly.policy_input_hash).not.toBe(distributed.policy_input_hash);
  });

  it('does not create package-specific exceptions or cross-usage inheritance', () => {
    const hooks = evaluateLicenseEvidence(evidence('pyinstaller-hooks-contrib', 'BUILD_ONLY_USE'));
    const unrelatedPackage = evaluateLicenseEvidence(
      evidence('unrelated-package', 'BUILD_ONLY_USE'),
    );
    const futureDistributedUse = evaluateLicenseEvidence(
      evidence('pyinstaller-hooks-contrib', 'TOOL_REDISTRIBUTION'),
    );
    expect(unrelatedPackage.policy_result).toBe(hooks.policy_result);
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

  it('pins the unchanged policy identity for this review', () => {
    const policy = loadLicensePolicy();
    expect(policy.document.license_policy_version).toBe('2026.08.29.1');
    expect(policy.sha256).toBe('5ffff7b24c75801e1a75a888b9d4b5e40cf29e0641dcc6b5d2d2562acae4545a');
    expect(licenseIdentityHash(policy.document)).toBe(policy.sha256);
  });
});
