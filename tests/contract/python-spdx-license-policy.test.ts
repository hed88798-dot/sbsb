import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  compareLicenseDecisionReports,
  evaluateLicenseCollection,
  evaluateLicenseEvidence,
  licenseIdentityHash,
  loadLicensePolicy,
} from '../../tools/license-policy/evaluator.mjs';
import {
  parseSpdxExpression,
  spdxParserIdentity,
} from '../../tools/license-policy/spdx-parser.mjs';
import {
  canonicalLicenseTextHash,
  verifySpdxQualityTooling,
} from '../../tools/license-policy/verify-quality-tooling.mjs';
import {
  auditGeneratedWorkerLicense,
  auditToolchainLicenses,
  buildToolchainLicenseEvidence,
} from '../../tools/python-supply-chain/provenance.mjs';
import { buildPythonSbomRecords } from '../../tools/python-supply-chain/sbom.mjs';
import { buildBundledLicenseSbomRecords } from '../../tools/python-supply-chain/sbom.mjs';
import { buildWheelLicenseEvidence } from '../../tools/python-supply-chain/license.mjs';
import {
  evaluateBundledLicenseEvidence,
  loadBundledLicenseEvidence,
} from '../../tools/license-policy/bundled-license.mjs';
import {
  buildThirdPartyNoticeBundle,
  materializeThirdPartyNotices,
  renderThirdPartyNotices,
  topLevelEvidenceFromScan,
} from '../../tools/license-policy/notices.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const pillowEvidenceRoot = join(repositoryRoot, 'compliance/license-evidence/pillow-12.3.0');

function evidence(
  expression: string,
  artifactRole = 'PYTHON_BUILD_DEPENDENCY',
  distributionRole = 'BUILD_ONLY_USE',
) {
  return {
    artifact_sha256: 'a'.repeat(64),
    package: 'synthetic-license-fixture',
    version: '1.0.0',
    artifact_type: 'PYTHON_WHEEL',
    artifact_role: artifactRole,
    distribution_role: distributionRole,
    detected_license_expression: expression,
    evidence_status: 'PASS',
    source_provenance: { source: 'https://example.invalid/source', review_status: 'APPROVED' },
    evidence_sources: [
      {
        evidence_type: 'LICENSE_FILE',
        relative_path: 'LICENSE',
        sha256: 'b'.repeat(64),
      },
    ],
    exception_evidence: [
      {
        evidence_type: 'LICENSE_FILE',
        relative_path: 'COPYING.txt',
        sha256: 'c'.repeat(64),
      },
      {
        evidence_type: 'EXCEPTION_SOURCE',
        source: 'https://pyinstaller.org/en/v6.22.0/license.html',
      },
    ],
  };
}

function toolchainComponent(id: string, kind: string, expression: string, usageScopes: string[]) {
  return {
    component_id: id,
    component_kind: kind,
    name: id,
    version: '1.0.0',
    usage_scopes: usageScopes,
    artifact: {
      artifact_type:
        kind === 'CPYTHON_DISTRIBUTION'
          ? 'distribution'
          : kind === 'PYINSTALLER_BOOTLOADER'
            ? 'bootloader'
            : 'wheel',
      sha256: id.charCodeAt(0).toString(16).padStart(2, '0').repeat(32),
      canonical_reference: `https://example.invalid/${id}`,
      canonical_source: 'https://example.invalid/source',
    },
    provenance: { supplier: 'Synthetic', review_status: 'APPROVED' },
    license: {
      expression,
      files: [{ relative_path: 'LICENSE', sha256: 'd'.repeat(64) }],
      review_status: 'APPROVED',
      redistribution_evidence: 'https://pyinstaller.org/en/v6.22.0/license.html',
    },
  };
}

describe('Python SPDX expression parser and commercial policy', () => {
  it('pins a mature parser and exact SPDX datasets as verify-only quality tooling', () => {
    expect(spdxParserIdentity).toMatchObject({
      parser_name: 'spdx-expression-parse',
      parser_version: '5.0.0',
      spdx_license_list_version: '3.28.0',
      spdx_exception_list_version: '3.23',
    });
    expect(verifySpdxQualityTooling()).toMatchObject({
      status: 'PASS',
      scope: 'QUALITY_TOOLING',
      license_policy_version: '2026.09.02.1',
    });
  });

  it('parses OR without changing evidence or silently selecting the first branch', () => {
    const original = evidence('Apache-2.0 OR BSD-2-Clause');
    const decision = evaluateLicenseEvidence(original);
    expect(decision).toMatchObject({
      detected_license_expression: 'Apache-2.0 OR BSD-2-Clause',
      normalized_expression: 'Apache-2.0 OR BSD-2-Clause',
      acceptable_or_branches: ['Apache-2.0', 'BSD-2-Clause'],
      selected_policy_branch: null,
      policy_result: 'PASS',
    });
    const selected = evaluateLicenseEvidence(original, { selectedPolicyBranch: 'BSD-2-Clause' });
    expect(selected.selected_policy_branch).toBe('BSD-2-Clause');
    expect(original).not.toHaveProperty('selected_policy_branch');
  });

  it('aggregates every AND obligation and blocks an allowed plus disallowed expression', () => {
    const blocked = evaluateLicenseEvidence(evidence('MIT AND GPL-2.0-or-later'));
    expect(blocked.policy_result).toBe('FAIL');
    expect(blocked.obligations).toEqual(
      expect.arrayContaining([
        'PRESERVE_LICENSE_TEXT',
        'COPYLEFT_SOURCE_DISTRIBUTION_REVIEW_REQUIRED',
      ]),
    );
    const allowed = evaluateLicenseEvidence(evidence('MIT AND Apache-2.0'));
    expect(allowed.policy_result).toBe('PASS');
    expect(allowed.obligations).toEqual(
      expect.arrayContaining(['PRESERVE_COPYRIGHT_NOTICE', 'PRESERVE_REQUIRED_NOTICES']),
    );
  });

  it('evaluates nested expressions from the parsed expression tree', () => {
    const parsed = parseSpdxExpression('MIT OR (Apache-2.0 AND BSD-2-Clause)');
    expect(parsed.ast).toMatchObject({
      type: 'conjunction',
      operator: 'OR',
      right: { type: 'conjunction', operator: 'AND' },
    });
    expect(evaluateLicenseEvidence(evidence(parsed.original_expression)).policy_result).toBe(
      'PASS',
    );
  });

  it.each([
    ['PYINSTALLER_BUILD_TOOL', 'BUILD_ONLY_USE'],
    ['PYINSTALLER_BOOTLOADER', 'BOOTLOADER_INCLUSION'],
    ['GENERATED_FINAL_WORKER', 'GENERATED_APPLICATION_DISTRIBUTION'],
  ])('binds the bootloader exception to %s / %s', (artifactRole, distributionRole) => {
    const decision = evaluateLicenseEvidence(
      evidence('GPL-2.0-or-later WITH Bootloader-exception', artifactRole, distributionRole),
    );
    expect(decision.policy_result).toBe('PASS');
    expect(decision.exceptions[0]).toMatchObject({
      base_license: 'GPL-2.0-or-later',
      exception: 'Bootloader-exception',
      artifact_role: artifactRole,
      distribution_role: distributionRole,
      policy_result: 'PASS',
    });
  });

  it('does not generalize the bootloader exception to tool or modified-source redistribution', () => {
    expect(
      evaluateLicenseEvidence(
        evidence(
          'GPL-2.0-or-later WITH Bootloader-exception',
          'PYINSTALLER_PACKAGE',
          'TOOL_REDISTRIBUTION',
        ),
      ).policy_result,
    ).toBe('MANUAL_REVIEW');
    expect(
      evaluateLicenseEvidence(
        evidence(
          'GPL-2.0-or-later WITH Bootloader-exception',
          'PYINSTALLER_BOOTLOADER',
          'MODIFIED_TOOLCHAIN_DISTRIBUTION',
        ),
      ).policy_result,
    ).toBe('MANUAL_REVIEW');
    const wrongSource = evidence(
      'GPL-2.0-or-later WITH Bootloader-exception',
      'PYINSTALLER_BOOTLOADER',
      'BOOTLOADER_INCLUSION',
    );
    wrongSource.exception_evidence[1].source = 'https://example.invalid/unapproved-exception';
    expect(evaluateLicenseEvidence(wrongSource).policy_result).toBe('MANUAL_REVIEW');
  });

  it('keeps bare GPL, malformed/unknown identifiers and unknown exceptions fail closed', () => {
    expect(evaluateLicenseEvidence(evidence('GPL-2.0-or-later')).policy_result).toBe('FAIL');
    expect(evaluateLicenseEvidence(evidence('Future-License-9.9')).policy_result).toBe('FAIL');
    expect(evaluateLicenseEvidence(evidence('MIT WITH Future-exception')).policy_result).toBe(
      'FAIL',
    );
    expect(evaluateLicenseEvidence(evidence('MIT OR')).policy_result).toBe('FAIL');
  });

  it('adds an identifier-level MIT-CMU rule without normalizing it to MIT', () => {
    const generic = {
      ...evidence('MIT-CMU'),
      package: 'generic-mit-cmu-fixture',
      artifact_sha256: '9'.repeat(64),
    };
    const decision = evaluateLicenseEvidence(generic);
    expect(decision).toMatchObject({
      detected_license_expression: 'MIT-CMU',
      normalized_expression: 'MIT-CMU',
      policy_result: 'PASS',
      policy_rule_id: 'MIT-CMU-commercial-v1',
      commercial_use: 'ALLOWED',
      distribution: 'ALLOWED_WITH_OBLIGATIONS',
      notice_required: true,
      no_endorsement_required: true,
      no_publicity_name_use_without_permission: true,
      copyright_holders: expect.arrayContaining(['Secret Labs AB']),
      spdx_license_list_version: '3.28.0',
      license_policy_version: '2026.09.02.1',
    });
    expect(decision.obligations).toEqual(
      expect.arrayContaining([
        'PRESERVE_COPYRIGHT_NOTICE',
        'PRESERVE_PERMISSION_NOTICE',
        'RETAIN_NOTICE_IN_SUPPORTING_DOCUMENTATION_OR_DISTRIBUTION_MATERIAL',
        'NO_ENDORSEMENT',
        'NO_PUBLICITY_NAME_USE_WITHOUT_PERMISSION',
      ]),
    );
    expect(
      evaluateLicenseEvidence({ ...generic, detected_license_expression: 'MIT' }),
    ).toMatchObject({ normalized_expression: 'MIT', policy_rule_id: null });
  });

  it('re-evaluates identical Pillow evidence under immutable old and new policies', () => {
    const scan = loadBundledLicenseEvidence(
      join(pillowEvidenceRoot, 'windows-cp313.scan.json'),
    ).document;
    const unchangedEvidence = topLevelEvidenceFromScan(scan);
    const oldPolicy = loadLicensePolicy(
      join(repositoryRoot, 'compliance/license-policy/python-spdx-v1/versions/2026.08.28.1.json'),
    );
    const oldDecision = evaluateLicenseEvidence(unchangedEvidence, { policy: oldPolicy });
    const newDecision = evaluateLicenseEvidence(unchangedEvidence);
    expect(oldDecision).toMatchObject({
      artifact_sha256: scan.artifact.sha256,
      detected_license_expression: 'MIT-CMU',
      policy_result: 'FAIL',
      license_policy_version: '2026.08.28.1',
      reason: 'SPDX identifier has no rule in the pinned commercial policy',
    });
    expect(newDecision).toMatchObject({
      artifact_sha256: scan.artifact.sha256,
      detected_license_expression: 'MIT-CMU',
      policy_result: 'PASS',
      license_policy_version: '2026.09.02.1',
    });
    expect(unchangedEvidence.artifact_sha256).toBe(scan.artifact.sha256);
    expect(
      compareLicenseDecisionReports(
        evaluateLicenseCollection([unchangedEvidence], { policy: oldPolicy }),
        evaluateLicenseCollection([unchangedEvidence]),
      ),
    ).toEqual([
      expect.objectContaining({
        artifact_sha256: scan.artifact.sha256,
        previous_policy_result: 'FAIL',
        current_policy_result: 'PASS',
      }),
    ]);
  });

  it.each([
    ['windows-cp313', '1cca606cd25738df4ed873d5ad46bbdb3d83b5cbca291f6b4ff13a4df6b0bbe8', 12],
    ['linux-cp313', '0847a763afefb695bc912d7c131e7e0632d4edc1d8698f58ddabec8e46b8b6d3', 22],
  ])(
    'validates exact %s Pillow evidence, bundled review, SBOM and notice assembly',
    (fixture, artifactHash, bundledCount) => {
      const scanPath = join(pillowEvidenceRoot, `${fixture}.scan.json`);
      const loaded = loadBundledLicenseEvidence(scanPath);
      const scan = loaded.document;
      const schema = JSON.parse(
        readFileSync(
          join(
            repositoryRoot,
            'schemas/compliance/bundled-license-evidence/v1/evidence.schema.json',
          ),
          'utf8',
        ),
      );
      const ajv = new Ajv2020({ strict: false });
      addFormats(ajv);
      expect(ajv.compile(schema)(scan)).toBe(true);
      expect(scan).toMatchObject({
        artifact: { sha256: artifactHash, license_expression: 'MIT-CMU' },
        metadata: { license_expression: 'MIT-CMU' },
        bundled_third_party_license_evidence: 'DETECTED_AND_SEPARATELY_RECORDED',
      });
      expect(scan.bundled_components).toHaveLength(bundledCount);

      const topLevel = evaluateLicenseEvidence(topLevelEvidenceFromScan(scan));
      const bundled = evaluateBundledLicenseEvidence(loaded);
      expect(topLevel).toMatchObject({
        artifact_sha256: artifactHash,
        policy_result: 'PASS',
        normalized_expression: 'MIT-CMU',
        notice_required: true,
        no_endorsement_required: true,
      });
      expect(bundled).toMatchObject({
        status: 'PASS',
        artifact_sha256: artifactHash,
        notice_materialization_required: true,
      });
      expect(bundled.decisions).toHaveLength(bundledCount);

      const sbom = buildBundledLicenseSbomRecords([scan], [bundled]);
      expect(sbom.components).toHaveLength(bundledCount);
      expect(
        sbom.components.every((component) => component.licenses[0].expression !== 'MIT-CMU'),
      ).toBe(true);
      expect(sbom.dependencies).toEqual([
        expect.objectContaining({ ref: `urn:python-wheel:sha256:${artifactHash}` }),
      ]);
      const topLevelSbom = buildPythonSbomRecords(
        [
          {
            path: scanPath,
            document: {
              schema_version: '1',
              inventory_id: `${fixture}-license-regression`,
              scope: 'PRODUCTION_WORKER_RUNTIME',
              packages: [
                {
                  package_name: 'pillow',
                  version: '12.3.0',
                  purl: 'pkg:pypi/pillow@12.3.0',
                  sha256: artifactHash,
                  filename: scan.artifact.filename,
                  source: scan.artifact.source,
                  source_index: scan.artifact.source_index,
                  provenance: {
                    download_url: scan.artifact.download_url,
                    supplier: scan.artifact.supplier,
                    review_status: scan.artifact.review_status,
                  },
                  python_version: '3.13.15',
                  python_tag: 'cp313',
                  abi_tag: 'cp313',
                  platform_tag: fixture.startsWith('windows') ? 'win_amd64' : 'manylinux_x86_64',
                  license_expression: 'MIT-CMU',
                  dependencies: [],
                  native_artifacts: [],
                },
              ],
            },
          },
        ],
        [],
        [topLevel],
      );
      expect(topLevelSbom.components[0]).toMatchObject({
        name: 'pillow',
        hashes: [{ alg: 'SHA-256', content: artifactHash }],
        licenses: [{ expression: 'MIT-CMU' }],
      });

      const licenseText = readFileSync(join(pillowEvidenceRoot, `${fixture}.LICENSE.txt`), 'utf8');
      const bundle = buildThirdPartyNoticeBundle(scan, topLevel, bundled, licenseText);
      const crlfBundle = buildThirdPartyNoticeBundle(
        scan,
        topLevel,
        bundled,
        licenseText.replaceAll('\n', '\r\n'),
      );
      expect(crlfBundle.notice_identity_sha256).toBe(bundle.notice_identity_sha256);
      expect(bundle.entries).toHaveLength(bundledCount + 1);
      expect(bundle.entries[0]).toMatchObject({
        parent_artifact_sha256: artifactHash,
        package: 'pillow',
        version: '12.3.0',
        license_expression: 'MIT-CMU',
      });
      expect(bundle.entries.every((entry) => entry.parent_artifact_sha256 === artifactHash)).toBe(
        true,
      );
      const rendered = renderThirdPartyNotices(bundle);
      expect(rendered).toContain(`Artifact SHA-256: ${artifactHash}`);
      expect(rendered).toContain('NO_PUBLICITY_NAME_USE_WITHOUT_PERMISSION');
      expect(rendered).toContain('By obtaining, using, and/or copying this software');

      const temporary = mkdtempSync(join(tmpdir(), 'mit-cmu-notice-'));
      try {
        const crlfEvidencePath = join(temporary, 'LICENSE.crlf.txt');
        writeFileSync(crlfEvidencePath, licenseText.replaceAll('\n', '\r\n'));
        expect(canonicalLicenseTextHash(crlfEvidencePath)).toBe(
          scan.license_evidence_files[0].materialized_text_sha256,
        );
        const materialized = materializeThirdPartyNotices(
          join(temporary, 'THIRD_PARTY_NOTICES.md'),
          bundle,
        );
        expect(materialized.bytes).toBeGreaterThan(licenseText.length);
        expect(materialized.sha256).toMatch(/^[a-f0-9]{64}$/u);
      } finally {
        rmSync(temporary, { force: true, recursive: true });
      }
    },
  );

  it('fails closed when an exact bundled-license evidence identity changes', () => {
    const scan = structuredClone(
      loadBundledLicenseEvidence(join(pillowEvidenceRoot, 'windows-cp313.scan.json')).document,
    );
    scan.bundled_components[0].license_expression = 'Future-License-9.9';
    expect(() => evaluateBundledLicenseEvidence(scan)).toThrow(/evidence identity|license fact/u);
  });

  it('recognizes LicenseRef as an explicit blocking manual-review path', () => {
    const decision = evaluateLicenseEvidence(evidence('LicenseRef-Commercial-Terms'));
    expect(decision.policy_result).toBe('MANUAL_REVIEW');
    expect(decision.manual_review_required).toBe(true);
  });

  it('blocks an artifact evidence conflict independently of an allowed policy rule', () => {
    const conflicting = { ...evidence('MIT'), evidence_status: 'CONFLICT' };
    const decision = evaluateLicenseEvidence(conflicting);
    expect(decision.policy_result).toBe('FAIL');
    expect(decision.reason).toContain('evidence conflict');
    const [wheelEvidence] = buildWheelLicenseEvidence([
      {
        inventory: { scope: 'PRODUCTION_WORKER_RUNTIME' },
        artifact: {
          sha256: '1'.repeat(64),
          package_name: 'conflicting-wheel',
          version: '1.0.0',
          filename: 'conflicting-wheel-1.0.0-py3-none-any.whl',
          purl: 'pkg:pypi/conflicting-wheel@1.0.0',
          source: 'https://example.invalid/source',
          source_index: 'https://example.invalid/index',
          provenance: {
            download_url: 'https://example.invalid/wheel',
            supplier: 'Synthetic',
            review_status: 'APPROVED',
          },
          license_expression: 'MIT',
          license_files: [{ relative_path: 'LICENSE', sha256: '2'.repeat(64) }],
        },
        inspected: {
          metadata_sha256: '3'.repeat(64),
          license_expression: 'Apache-2.0',
          legacy_license: null,
          license_classifiers: [],
          license_files: [
            {
              relative_path: 'LICENSE',
              kind: 'LICENSE',
              sha256: '2'.repeat(64),
              size: 1,
            },
          ],
        },
      },
    ]);
    expect(wheelEvidence.evidence_status).toBe('CONFLICT');
    expect(evaluateLicenseEvidence(wheelEvidence).policy_result).toBe('FAIL');
  });

  it('is deterministic and supports explicit historical policy re-evaluation diffs', () => {
    const input = evidence('MIT');
    expect(evaluateLicenseEvidence(input)).toEqual(evaluateLicenseEvidence(input));

    const current = evaluateLicenseCollection([input]);
    const currentPolicy = loadLicensePolicy().document;
    const crlfRoundTrip = JSON.parse(
      JSON.stringify(currentPolicy, null, 2).replaceAll('\n', '\r\n'),
    );
    expect(licenseIdentityHash(crlfRoundTrip)).toBe(licenseIdentityHash(currentPolicy));
    const changedPolicy = structuredClone(currentPolicy);
    changedPolicy.license_policy_version = '2026.08.29.1-test';
    changedPolicy.license_rules.MIT.policy_result = 'FAIL';
    const changed = evaluateLicenseCollection([input], {
      policy: { document: changedPolicy, sha256: licenseIdentityHash(changedPolicy) },
    });
    expect(compareLicenseDecisionReports(current, changed)).toEqual([
      expect.objectContaining({
        artifact_sha256: input.artifact_sha256,
        previous_policy_result: 'PASS',
        current_policy_result: 'FAIL',
      }),
    ]);
  });

  it('keeps CPython, pip, PyInstaller, bootloader and final-worker roles separate', () => {
    const toolchain = {
      components: [
        toolchainComponent('cpython', 'CPYTHON_DISTRIBUTION', 'PSF-2.0', [
          'PACKAGED_RUNTIME_COMPONENT',
        ]),
        toolchainComponent('pip', 'PIP', 'MIT', ['BUILD_TOOLCHAIN_COMPONENT']),
        toolchainComponent(
          'pyinstaller',
          'PYINSTALLER',
          'GPL-2.0-or-later WITH Bootloader-exception',
          ['BUILD_TOOLCHAIN_COMPONENT'],
        ),
        toolchainComponent(
          'bootloader',
          'PYINSTALLER_BOOTLOADER',
          'GPL-2.0-or-later WITH Bootloader-exception',
          ['PACKAGED_RUNTIME_COMPONENT'],
        ),
      ],
    };
    expect(buildToolchainLicenseEvidence(toolchain).map((entry) => entry.artifact_role)).toEqual([
      'CPYTHON_RUNTIME',
      'PIP_BUILD_TOOL',
      'PYINSTALLER_BUILD_TOOL',
      'PYINSTALLER_BOOTLOADER',
    ]);
    expect(auditToolchainLicenses(toolchain).status).toBe('PASS');
    const generated = auditGeneratedWorkerLicense(toolchain, {
      build_id: 'build-1',
      build_commit_sha: 'e'.repeat(40),
      inputs: {
        pyinstaller_component_id: 'pyinstaller',
        bootloader_component_id: 'bootloader',
      },
      final_artifact: { filename: 'media-worker.exe', sha256: 'f'.repeat(64) },
    });
    expect(generated).toMatchObject({
      artifact_type: 'FINAL_BUILD_ARTIFACT',
      artifact_role: 'GENERATED_FINAL_WORKER',
      policy_result: 'PASS',
    });
  });

  it('validates the v2 report contract and preserves SBOM expression/selection separately', () => {
    const input = evidence('Apache-2.0 OR BSD-2-Clause');
    const decision = evaluateLicenseEvidence(input, { selectedPolicyBranch: 'BSD-2-Clause' });
    const report = evaluateLicenseCollection([input]);
    const schema = JSON.parse(
      readFileSync(
        join(repositoryRoot, 'schemas/compliance/license-policy-evaluation/v2/report.schema.json'),
        'utf8',
      ),
    );
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    expect(ajv.compile(schema)(report)).toBe(true);

    const inventoryPath = join(
      repositoryRoot,
      'tests/fixtures/python-supply-chain/inventories/v2-mixed-tags.fixture.json',
    );
    const loaded = [
      { path: inventoryPath, document: JSON.parse(readFileSync(inventoryPath, 'utf8')) },
    ];
    const artifact = loaded[0].document.packages[0];
    const boundDecision = {
      ...decision,
      artifact_sha256: artifact.sha256,
      detected_license_expression: artifact.license_expression,
    };
    const records = buildPythonSbomRecords(loaded, [], [boundDecision]);
    const component = records.components.find((entry) => entry.purl === artifact.purl);
    expect(component.licenses).toEqual([{ expression: artifact.license_expression }]);
    expect(component.properties).toEqual(
      expect.arrayContaining([
        {
          name: 'com.company.license.declared_expression',
          value: artifact.license_expression,
        },
        {
          name: 'com.company.license.selected_policy_branch',
          value: 'BSD-2-Clause',
        },
      ]),
    );
  });
});
