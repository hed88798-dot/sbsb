import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { licenseIdentityHash, loadLicensePolicy } from '../../tools/license-policy/evaluator.mjs';
import {
  artifactEvidenceIdentity,
  buildProvenanceIdentity,
  buildUsageReachabilityRecords,
  evaluateArtifactUsageBinding,
  validateArtifactLicenseEvidenceV2,
  validateArtifactUsageBindingV1,
} from '../../tools/license-policy/usage-binding.mjs';
import { auditPythonLicenses } from '../../tools/python-supply-chain/license.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const evidenceRoot = join(repositoryRoot, 'compliance/license-evidence/pyinstaller-6.22.2');
const windowsEvidence = JSON.parse(
  readFileSync(join(evidenceRoot, 'windows-x86_64.scan.json'), 'utf8'),
);
const linuxEvidence = JSON.parse(
  readFileSync(join(evidenceRoot, 'linux-x86_64.scan.json'), 'utf8'),
);

function buildContext(evidence: typeof windowsEvidence, buildId = 'media-worker-windows-build-1') {
  const target = {
    os: evidence.artifact.filename.includes('win_amd64') ? 'windows' : 'linux',
    architecture: 'x86_64',
    python_version: '3.13.15',
  };
  return {
    schema_version: '1',
    build_id: buildId,
    build_commit_sha: 'a'.repeat(40),
    build_timestamp: '2026-08-29T00:00:00Z',
    run_identity: `test/${buildId}`,
    target,
    build_configuration: { path: 'workers/media-index-worker.spec', sha256: '1'.repeat(64) },
    inputs: {
      wheel_inventories: [
        {
          inventory_id: `${buildId}-wheels`,
          manifest_path: 'compliance/python-artifacts/test.json',
          manifest_sha256: '2'.repeat(64),
        },
      ],
      toolchain_inventory: {
        inventory_id: `${buildId}-toolchain`,
        manifest_path: 'compliance/python-artifacts/toolchain.json',
        manifest_sha256: '3'.repeat(64),
      },
      cpython_component_id: 'cpython-3.13.15',
      pyinstaller_component_id: 'pyinstaller-6.22.2',
      bootloader_component_id: 'pyinstaller-bootloader-6.22.2',
    },
    output_layers: {
      bootloader_sha256: '4'.repeat(64),
      archive_payload_sha256: '5'.repeat(64),
    },
    final_artifact: {
      artifact_type: 'PYINSTALLER_ONEFILE',
      filename: target.os === 'windows' ? 'media-worker.exe' : 'media-worker',
      artifact_path: target.os === 'windows' ? 'dist/media-worker.exe' : 'dist/media-worker',
      sha256: '6'.repeat(64),
    },
    bit_for_bit_reproducible_build_required: false,
  };
}

function toolchain(evidence: typeof windowsEvidence) {
  const target = buildContext(evidence).target;
  return {
    target,
    components: [
      {
        component_id: 'pyinstaller-6.22.2',
        component_kind: 'PYINSTALLER',
        platform: target.os,
        architecture: target.architecture,
        artifact: { sha256: evidence.artifact.sha256 },
      },
    ],
  };
}

function binding(
  evidence: typeof windowsEvidence,
  build = buildContext(evidence),
  overrides: Record<string, unknown> = {},
) {
  const policy = loadLicensePolicy();
  const hash = evidence.artifact.sha256;
  return {
    schema_version: '1',
    usage_binding_id: `${build.build_id}-pyinstaller-build-tool`,
    artifact_sha256: hash,
    artifact_references: {
      license_evidence_artifact_sha256: hash,
      toolchain_artifact_sha256: hash,
      build_sbom_artifact_sha256: hash,
    },
    build_context: {
      build_context_id: build.build_id,
      build_provenance_schema_version: '1',
      build_provenance_identity_sha256: buildProvenanceIdentity(build),
    },
    dependency_role: 'PYTHON_BUILD_DEPENDENCY',
    functional_role: 'PYINSTALLER_BUILD_TOOL',
    distribution_role: 'BUILD_ONLY',
    exception_binding: {
      artifact_sha256: hash,
      build_context_id: build.build_id,
      detected_license_expression: evidence.package_license.expression,
      functional_role: 'PYINSTALLER_BUILD_TOOL',
      distribution_role: 'BUILD_ONLY',
      license_policy_version: policy.document.license_policy_version,
      license_policy_sha256: policy.sha256,
      evidence_source_ids: ['copying-license-and-exception', 'pyinstaller-license-page'],
    },
    policy_binding: {
      license_policy_version: policy.document.license_policy_version,
      license_policy_sha256: policy.sha256,
    },
    reachability: {
      build_sbom: 'INCLUDED',
      runtime_sbom: 'EXCLUDED_BUILD_ONLY',
      internal_compliance: 'RETAINED',
      customer_notice: 'EXCLUDED_BUILD_ONLY',
    },
    ...overrides,
  };
}

function evaluate(
  evidence: typeof windowsEvidence,
  usage = binding(evidence),
  build = buildContext(evidence),
  inventory = toolchain(evidence),
) {
  return evaluateArtifactUsageBinding(evidence, usage, {
    buildProvenance: build,
    toolchainInventory: inventory,
  });
}

function withRecomputedEvidenceIdentity(evidence: typeof windowsEvidence) {
  evidence.scan.evidence_identity_sha256 = artifactEvidenceIdentity(evidence);
  return evidence;
}

describe('PyInstaller artifact identity and worker-build usage binding', () => {
  it.each([
    ['windows', windowsEvidence, 571, 12, 20, 3],
    ['linux', linuxEvidence, 567, 8, 20, 3],
  ])(
    'validates exact %s wheel bytes, package evidence and file-level scopes',
    (
      _platform,
      evidence,
      entryCount,
      bootloaderAndLoaderCount,
      runtimeHookCount,
      isolatedCount,
    ) => {
      expect(validateArtifactLicenseEvidenceV2(evidence)).toBe(evidence);
      expect(evidence.scan.wheel_entry_count).toBe(entryCount);
      expect(evidence.scan.license_candidate_paths).toEqual([
        'pyinstaller-6.22.2.dist-info/licenses/COPYING.txt',
      ]);
      expect(evidence.package_license).toMatchObject({
        expression: 'GPL-2.0-or-later WITH Bootloader-exception',
        metadata_status: 'LEGACY_DESCRIPTION_REVIEWED',
      });
      expect(
        evidence.file_level_license_evidence.map(
          (scope: { expression: string; files: unknown[] }) => [
            scope.expression,
            scope.files.length,
          ],
        ),
      ).toEqual([
        ['GPL-2.0-or-later WITH Bootloader-exception', bootloaderAndLoaderCount],
        ['Apache-2.0', runtimeHookCount],
        ['GPL-2.0-or-later OR MIT', isolatedCount],
      ]);
    },
  );

  it('retains platform-specific bootloader byte identities separately', () => {
    const windowsFiles = new Map(
      windowsEvidence.file_level_license_evidence[0].files.map(
        (entry: { relative_path: string; sha256: string }) => [entry.relative_path, entry.sha256],
      ),
    );
    const linuxFiles = new Map(
      linuxEvidence.file_level_license_evidence[0].files.map(
        (entry: { relative_path: string; sha256: string }) => [entry.relative_path, entry.sha256],
      ),
    );
    expect(windowsFiles.get('PyInstaller/bootloader/Windows-64bit-intel/run.exe')).toBe(
      '9f93091d097c7bca65e18e233b68886a017da65c9681efb1fcbfcc254e4fa1fd',
    );
    expect(linuxFiles.get('PyInstaller/bootloader/Linux-64bit-intel/run')).toBe(
      '4e7712dbbabe9bd98c1c8ecb9130fdac17706f805bbd5cb780af2c05f4050a42',
    );
  });

  it.each([
    ['windows', windowsEvidence, 'media-worker-windows-build-1'],
    ['linux', linuxEvidence, 'media-worker-linux-build-1'],
  ])('passes exact %s worker-build usage and exception binding', (_platform, evidence, buildId) => {
    const build = buildContext(evidence, buildId);
    const usage = binding(evidence, build);
    expect(validateArtifactUsageBindingV1(usage)).toBe(usage);
    const result = evaluate(evidence, usage, build);
    expect(result).toMatchObject({
      schema_version: '3',
      artifact_sha256: evidence.artifact.sha256,
      build_context_id: buildId,
      dependency_role: 'PYTHON_BUILD_DEPENDENCY',
      functional_role: 'PYINSTALLER_BUILD_TOOL',
      distribution_role: 'BUILD_ONLY',
      artifact_identity_reconciled: true,
      exception_binding_valid: true,
      policy_result: 'PASS',
      license_policy_version: '2026.08.29.1',
    });
    expect(
      result.scope_decisions.map((decision: { policy_result: string }) => decision.policy_result),
    ).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });

  it('fails closed for the same artifact under the wrong functional role', () => {
    const build = buildContext(windowsEvidence);
    const usage = binding(windowsEvidence, build, {
      functional_role: 'PRODUCT_RUNTIME_COMPONENT',
      distribution_role: 'PRODUCT_RUNTIME',
      exception_binding: {
        ...binding(windowsEvidence, build).exception_binding,
        functional_role: 'PRODUCT_RUNTIME_COMPONENT',
        distribution_role: 'PRODUCT_RUNTIME',
      },
      reachability: {
        build_sbom: 'INCLUDED',
        runtime_sbom: 'INCLUDED',
        internal_compliance: 'RETAINED',
        customer_notice: 'INCLUDED',
      },
    });
    expect(evaluate(windowsEvidence, usage, build)).toMatchObject({ policy_result: 'FAIL' });
  });

  it('fails closed for the same artifact under toolchain redistribution', () => {
    const build = buildContext(windowsEvidence);
    const usage = binding(windowsEvidence, build, {
      distribution_role: 'TOOLCHAIN_REDISTRIBUTION',
      exception_binding: {
        ...binding(windowsEvidence, build).exception_binding,
        distribution_role: 'TOOLCHAIN_REDISTRIBUTION',
      },
      reachability: {
        build_sbom: 'INCLUDED',
        runtime_sbom: 'INCLUDED',
        internal_compliance: 'RETAINED',
        customer_notice: 'INCLUDED',
      },
    });
    expect(evaluate(windowsEvidence, usage, build)).toMatchObject({ policy_result: 'FAIL' });
  });

  it('re-evaluates a fully rebound second build context and rejects a stale context', () => {
    const firstBuild = buildContext(windowsEvidence, 'media-worker-windows-build-a');
    const secondBuild = buildContext(windowsEvidence, 'media-worker-windows-build-b');
    const first = evaluate(windowsEvidence, binding(windowsEvidence, firstBuild), firstBuild);
    const second = evaluate(windowsEvidence, binding(windowsEvidence, secondBuild), secondBuild);
    expect(first.policy_result).toBe('PASS');
    expect(second.policy_result).toBe('PASS');
    expect(second.usage_binding_identity_sha256).not.toBe(first.usage_binding_identity_sha256);
    expect(
      evaluate(windowsEvidence, binding(windowsEvidence, firstBuild), secondBuild).reason,
    ).toContain('build context');
  });

  it('rejects exception artifact/context mismatch and cross-artifact propagation', () => {
    const build = buildContext(windowsEvidence);
    const exact = binding(windowsEvidence, build);
    expect(
      evaluate(
        windowsEvidence,
        {
          ...exact,
          exception_binding: { ...exact.exception_binding, artifact_sha256: 'b'.repeat(64) },
        },
        build,
      ),
    ).toMatchObject({ policy_result: 'FAIL', exception_binding_valid: false });
    expect(
      evaluate(
        windowsEvidence,
        {
          ...exact,
          exception_binding: {
            ...exact.exception_binding,
            build_context_id: 'another-worker-build-context',
          },
        },
        build,
      ),
    ).toMatchObject({ policy_result: 'FAIL', exception_binding_valid: false });

    const hooksEvidence = withRecomputedEvidenceIdentity({
      ...structuredClone(windowsEvidence),
      artifact: {
        ...windowsEvidence.artifact,
        artifact_id: `urn:sha256:${'c'.repeat(64)}`,
        sha256: 'c'.repeat(64),
        filename: 'pyinstaller_hooks_contrib-2026.0-py3-none-any.whl',
        package: 'pyinstaller-hooks-contrib',
      },
    });
    const hooksBuild = buildContext(hooksEvidence, 'hooks-build-context');
    const hooksUsage = binding(hooksEvidence, hooksBuild);
    const pyinstallerToolchain = toolchain(hooksEvidence);
    expect(
      evaluateArtifactUsageBinding(hooksEvidence, hooksUsage, {
        buildProvenance: hooksBuild,
        toolchainInventory: pyinstallerToolchain,
      }).policy_result,
    ).toBe('FAIL');
  });

  it('fails canonical identity reconciliation even when package/version match', () => {
    const build = buildContext(windowsEvidence);
    const exact = binding(windowsEvidence, build);
    const mismatched = {
      ...exact,
      artifact_references: {
        ...exact.artifact_references,
        build_sbom_artifact_sha256: 'd'.repeat(64),
      },
    };
    expect(evaluate(windowsEvidence, mismatched, build)).toMatchObject({
      policy_result: 'FAIL',
      artifact_identity_reconciled: false,
      reason: expect.stringContaining('canonical artifact identity'),
    });
  });

  it('keeps a bare GPL build dependency blocked', () => {
    const bare = withRecomputedEvidenceIdentity(structuredClone(windowsEvidence));
    bare.package_license.expression = 'GPL-2.0-or-later';
    bare.scan.evidence_identity_sha256 = artifactEvidenceIdentity(bare);
    const build = buildContext(bare);
    const usage = binding(bare, build);
    expect(evaluate(bare, usage, build).policy_result).toBe('FAIL');
  });

  it('separates build/runtime SBOM and internal/customer notice reachability', () => {
    const build = buildContext(windowsEvidence);
    const usage = binding(windowsEvidence, build);
    const evaluation = evaluate(windowsEvidence, usage, build);
    const records = buildUsageReachabilityRecords(windowsEvidence, usage, evaluation);
    expect(records.build_sbom_components).toHaveLength(1);
    expect(records.runtime_sbom_components).toEqual([]);
    expect(records.internal_compliance_evidence).toHaveLength(1);
    expect(records.customer_notice_components).toEqual([]);
    expect(records.internal_compliance_evidence[0]).toMatchObject({
      artifact_sha256: windowsEvidence.artifact.sha256,
      usage_binding_id: usage.usage_binding_id,
      build_context_id: build.build_id,
    });
  });

  it('lets the shared Python license gate consume v3 without erasing dependency role', () => {
    const build = buildContext(windowsEvidence);
    const usage = binding(windowsEvidence, build);
    const evaluation = evaluate(windowsEvidence, usage, build);
    const artifact = windowsEvidence.artifact;
    const verified = [
      {
        inventory: { scope: 'MODEL_EXPORT_BUILD' },
        artifact: {
          sha256: artifact.sha256,
          package_name: artifact.package,
          version: artifact.version,
          purl: `pkg:pypi/${artifact.package}@${artifact.version}`,
          source: 'https://github.com/pyinstaller/pyinstaller',
          source_index: 'https://pypi.org/simple',
          provenance: {
            download_url: artifact.download_url,
            supplier: artifact.supplier,
            review_status: 'APPROVED',
          },
          license_expression: windowsEvidence.package_license.expression,
          license_files: windowsEvidence.package_license.evidence_sources
            .filter((entry: { evidence_type: string }) => entry.evidence_type === 'LICENSE_FILE')
            .map((entry: { relative_path: string; sha256: string }) => ({
              relative_path: entry.relative_path,
              sha256: entry.sha256,
            })),
        },
        inspected: {
          license_expression: null,
          legacy_license:
            'GPLv2-or-later with a special exception which allows to use PyInstaller to build and distribute non-free programs (including commercial ones)',
        },
      },
    ];
    expect(() => auditPythonLicenses(verified)).toThrow(/FAIL/u);
    const report = auditPythonLicenses(verified, { usageEvaluations: [evaluation] });
    expect(report).toMatchObject({
      schema_version: '3',
      summary: { artifacts: 1, passed: 1, failed: 0 },
      decisions: [
        {
          artifact_role: 'PYTHON_BUILD_DEPENDENCY',
          functional_role: 'PYINSTALLER_BUILD_TOOL',
          usage_distribution_role: 'BUILD_ONLY',
          context_free_policy_result: 'FAIL',
          policy_result: 'PASS',
        },
      ],
    });
    expect(() =>
      auditPythonLicenses(verified, {
        usageEvaluations: [
          { ...evaluation, functional_role: 'PRODUCT_RUNTIME_COMPONENT', policy_result: 'PASS' },
        ],
      }),
    ).toThrow(/not an exact approved PyInstaller build-only binding/u);
  });

  it('binds evaluation identity to the policy without changing historical policy bytes', () => {
    const current = loadLicensePolicy();
    const old = JSON.parse(
      readFileSync(
        join(repositoryRoot, 'compliance/license-policy/python-spdx-v1/versions/2026.08.28.2.json'),
        'utf8',
      ),
    );
    expect(current.document.license_policy_version).toBe('2026.08.29.1');
    expect(old.license_policy_version).toBe('2026.08.28.2');
    expect(licenseIdentityHash(old)).toBe(
      '0d708d719c70a219f80961c9bc1be6162ee0a34cb9ca0cbca5acd56e4f8264ac',
    );
  });
});
