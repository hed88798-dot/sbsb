import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateExternalRuntimePrerequisite,
  externalRuntimeProviderIdentityHash,
  externalRuntimePrerequisiteHash,
  runtimeConsumerRequirementHash,
  validateExternalRuntimePrerequisite,
  validateRuntimeConsumerRequirement,
  validateWindowsRuntimeProviderProbe,
  windowsRuntimeProviderProbeHash,
} from '../../tools/runtime-prerequisite/runtime-prerequisite.mjs';

const root = resolve(import.meta.dirname, '../../compliance/runtime-prerequisites/msvc-v14-x64');
const requirementFixture = JSON.parse(
  readFileSync(resolve(root, 'application-requirement.v1.json'), 'utf8'),
);
const prerequisiteFixture = JSON.parse(
  readFileSync(resolve(root, 'external-prerequisite.v1.json'), 'utf8'),
);

function requirement(overrides: Record<string, unknown> = {}) {
  const value = structuredClone(requirementFixture);
  Object.assign(value, overrides);
  value.requirement_sha256 = runtimeConsumerRequirementHash(value);
  return value;
}

function prerequisite(
  requirementValue = requirement(),
  mutate: (value: typeof prerequisiteFixture) => void = () => {},
) {
  const value = structuredClone(prerequisiteFixture);
  value.consumer_requirement_id = requirementValue.requirement_id;
  value.provider_binding.consumer_requirement_sha256 = requirementValue.requirement_sha256;
  value.provider_binding.build_context_id = requirementValue.application_closure.build_context_id;
  value.provider_binding.build_context_sha256 =
    requirementValue.application_closure.build_context_sha256;
  value.provider_binding.analysis_toc_sha256 =
    requirementValue.application_closure.analysis_toc_sha256;
  mutate(value);
  value.provider_identity_sha256 = externalRuntimeProviderIdentityHash(value);
  value.manifest_sha256 = externalRuntimePrerequisiteHash(value);
  return value;
}

function approvedPrerequisite(requirementValue = requirement()) {
  return prerequisite(requirementValue, (value) => {
    value.provider.bootstrap_artifact.signature_status = 'PASS';
    value.provider.installation_probe = {
      status: 'PASS',
      evidence_id: 'windows-probe-fixture',
      workflow_run_id: 123456,
      installed_provider_version: value.provider.version,
      artifact_bound: true,
      probe_sha256: 'e'.repeat(64),
    };
    value.license_evidence.status = 'PASS';
    value.license_evidence.missing_evidence = null;
    value.approval.status = 'PASS';
    value.approval.expires_at = '2099-01-01T00:00:00Z';
    value.approval.blocking_reasons = [];
  });
}

describe('External Runtime Prerequisite v1', () => {
  it('accepts the exact Code C application closure while preserving rejected raw observations', () => {
    const value = validateRuntimeConsumerRequirement(requirementFixture);
    expect(value.application_closure).toMatchObject({
      status: 'PASS',
      code_commit_sha: '5ead2a171f57213de59ee5f1d416875a724d7418',
      build_context_id: 'code-c-pyinstaller-3222e456c74b30b8383350a13ebc5491',
      build_context_sha256: 'cf4a51739e73fb5d7d3d01df8864298408cd13ae0b737a3b6abc29cae95b4f65',
      analysis_toc_sha256: '9cfe8b2c9d6507872ed76e6a6d3bbb34873a9e0e85293d8cda2ec449ecaba5b8',
      selected_native_manifest_sha256:
        '4285c7025b88362652ff28c8cc276b91c05ede5e5986ce3e8932b8e7cdbd36db',
    });
    expect(value.required_capabilities).toEqual([
      'msvcp140.dll',
      'msvcp140_1.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
    ]);
    expect(value.raw_observations).toHaveLength(4);
    expect(
      value.raw_observations.every(
        (entry: Record<string, unknown>) => !entry.distribution_artifact,
      ),
    ).toBe(true);
    expect(value.raw_source_approval).toBe('NOT_IMPLIED_BY_PROVIDER_DISPOSITION');
  });

  it('passes a complete generic external provider binding without approving raw bytes', () => {
    const required = requirement();
    const external = approvedPrerequisite(required);
    const report = evaluateExternalRuntimePrerequisite(required, external, {
      requireApproved: true,
      materializedCapabilities: [],
      finalCapabilities: [],
      now: new Date('2026-08-30T00:00:00Z'),
    });
    expect(report).toMatchObject({
      status: 'PASS',
      target_disposition: 'EXTERNAL_PREREQUISITE',
      internal_capabilities: [],
      external_capabilities: required.required_capabilities,
      raw_selection_preserved: true,
      raw_source_approval_implied: false,
      provider_covers_required_dll_family: true,
      external_entries_not_materialized: true,
      external_entries_not_final: true,
    });
  });

  it('records the current exact provider but blocks release until license entitlement exists', () => {
    const value = validateExternalRuntimePrerequisite(prerequisiteFixture);
    expect(value.provider.bootstrap_artifact).toMatchObject({
      filename: 'VC_redist.x64.exe',
      version: '14.51.36247.0',
      sha256: '843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c',
      size: 18731856,
      source_status: 'PASS',
    });
    expect(
      evaluateExternalRuntimePrerequisite(requirementFixture, prerequisiteFixture),
    ).toMatchObject({ status: 'BLOCKED' });
    expect(() =>
      evaluateExternalRuntimePrerequisite(requirementFixture, prerequisiteFixture, {
        requireApproved: true,
      }),
    ).toThrow(/Authenticode|installation probe|license|approval/u);
  });

  it('binds Windows probe evidence to immutable provider identity rather than mutable approval state', () => {
    const prerequisiteValue = prerequisiteFixture;
    const bootstrap = prerequisiteValue.provider.bootstrap_artifact;
    const probe = {
      schema_version: '1',
      evidence_id: 'windows-provider-probe-fixture',
      prerequisite_id: prerequisiteValue.prerequisite_id,
      provider_identity_sha256: prerequisiteValue.provider_identity_sha256,
      captured_at: '2026-08-30T00:00:00Z',
      runner: {
        os: 'Windows',
        architecture: 'X64',
        image: 'windows-2022-fixture',
        workflow_run_id: 123456,
        workflow_run_attempt: 1,
      },
      bootstrap_artifact: {
        filename: bootstrap.filename,
        version: bootstrap.version,
        sha256: bootstrap.sha256,
        size: bootstrap.size,
        source: bootstrap.canonical_source,
        authenticode_status: 'Valid',
        signer_subject: bootstrap.expected_signer_subject,
        signer_certificate_sha256: bootstrap.expected_signer_certificate_sha256,
      },
      installation: {
        pre_probe_version: null,
        uninstall_exit_code: 0,
        install_exit_code: 0,
        mode: 'EXACT_BOOTSTRAP_UNINSTALL_THEN_INSTALL',
      },
      installed_runtime: {
        registry_key: 'HKLM/SOFTWARE/Microsoft/VisualStudio/14.0/VC/Runtimes/x64',
        installed: 1,
        version: prerequisiteValue.provider.version,
        minimum_version_satisfied: true,
      },
      provider_installed_required_capabilities:
        prerequisiteValue.provider.provided_capabilities.map((capability) => ({
          capability,
          installed_path: `%WINDIR%/System32/${capability}`,
          file_version: prerequisiteValue.provider.version,
          sha256: 'd'.repeat(64),
        })),
      runtime_provider_closure: 'PASS',
      provider_installation_artifact_bound: true,
      probe_sha256: '',
    };
    probe.probe_sha256 = windowsRuntimeProviderProbeHash(probe);
    const boundPrerequisite = structuredClone(prerequisiteValue);
    boundPrerequisite.provider.installation_probe = {
      status: 'PASS',
      evidence_id: probe.evidence_id,
      workflow_run_id: probe.runner.workflow_run_id,
      installed_provider_version: probe.installed_runtime.version,
      artifact_bound: true,
      probe_sha256: probe.probe_sha256,
    };
    boundPrerequisite.manifest_sha256 = externalRuntimePrerequisiteHash(boundPrerequisite);
    expect(
      validateWindowsRuntimeProviderProbe(probe, boundPrerequisite, { requireRecorded: true }),
    ).toBe(probe);

    const reviewUpdate = structuredClone(boundPrerequisite);
    reviewUpdate.approval.reviewed_at = '2026-08-31T00:00:00Z';
    reviewUpdate.manifest_sha256 = externalRuntimePrerequisiteHash(reviewUpdate);
    expect(
      validateWindowsRuntimeProviderProbe(probe, reviewUpdate, { requireRecorded: true }),
    ).toBe(probe);

    const providerChange = structuredClone(boundPrerequisite);
    providerChange.provider.version = '14.52.40000.0';
    providerChange.provider.bootstrap_artifact.version = '14.52.40000.0';
    providerChange.provider_identity_sha256 = externalRuntimeProviderIdentityHash(providerChange);
    providerChange.manifest_sha256 = externalRuntimePrerequisiteHash(providerChange);
    expect(() =>
      validateWindowsRuntimeProviderProbe(probe, providerChange, { requireRecorded: true }),
    ).toThrow(/provider probe identity binding mismatch/u);
  });

  it('fails closed on requirement, manifest, build-context, and Analysis TOC drift', () => {
    const badRequirement = structuredClone(requirementFixture);
    badRequirement.application_closure.analysis_toc_sha256 = 'a'.repeat(64);
    expect(() => validateRuntimeConsumerRequirement(badRequirement)).toThrow(
      /requirement hash mismatch/u,
    );

    const badManifest = structuredClone(prerequisiteFixture);
    badManifest.provider.version = '14.99.99999.0';
    expect(() => validateExternalRuntimePrerequisite(badManifest)).toThrow(
      /manifest hash mismatch/u,
    );

    const required = requirement();
    const wrongContext = prerequisite(required, (value) => {
      value.provider_binding.build_context_sha256 = 'b'.repeat(64);
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, wrongContext)).toThrow(
      /build context SHA-256 binding mismatch/u,
    );

    const wrongToc = prerequisite(required, (value) => {
      value.provider_binding.analysis_toc_sha256 = 'c'.repeat(64);
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, wrongToc)).toThrow(
      /Analysis TOC SHA-256 binding mismatch/u,
    );
  });

  it('fails closed for missing, invented, ambiguous, or uncovered provider dispositions', () => {
    const required = requirement();
    const missing = prerequisite(required, (value) => {
      value.provider_binding.capability_dispositions.pop();
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, missing)).toThrow(
      /partition is incomplete/u,
    );

    const invented = prerequisite(required, (value) => {
      value.provider_binding.capability_dispositions.push({
        capability: 'not-required.dll',
        disposition: 'EXTERNAL_PROVIDER',
        provider_id: value.provider.provider_id,
      });
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, invented)).toThrow(
      /partition is incomplete or invented/u,
    );

    const ambiguous = prerequisite(required, (value) => {
      value.provider_binding.capability_dispositions.push(
        structuredClone(value.provider_binding.capability_dispositions[0]),
      );
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, ambiguous)).toThrow(
      /duplicate identities/u,
    );

    const uncovered = prerequisite(required, (value) => {
      value.provider.provided_capabilities.pop();
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, uncovered)).toThrow(
      /provider does not cover/u,
    );
  });

  it('fails if an external capability is materialized or appears in the final package', () => {
    const required = requirement();
    const external = approvedPrerequisite(required);
    expect(() =>
      evaluateExternalRuntimePrerequisite(required, external, {
        materializedCapabilities: ['msvcp140.dll'],
      }),
    ).toThrow(/materialized internally/u);
    expect(() =>
      evaluateExternalRuntimePrerequisite(required, external, {
        finalCapabilities: ['vcruntime140.dll'],
      }),
    ).toThrow(/appears in final package/u);
  });

  it('keeps internal requirements on the existing materialized/final path', () => {
    const required = requirement();
    const mixed = prerequisite(required, (value) => {
      const internal = value.provider_binding.capability_dispositions[0];
      internal.disposition = 'INTERNAL_PROVIDER';
      internal.provider_id = null;
      value.provider_binding.internal_provider = true;
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, mixed)).toThrow(
      /internal requirement is not materialized/u,
    );
    expect(
      evaluateExternalRuntimePrerequisite(required, mixed, {
        materializedCapabilities: ['msvcp140.dll'],
        finalCapabilities: ['msvcp140.dll'],
      }).internal_capabilities,
    ).toEqual(['msvcp140.dll']);
  });

  it('invalidates revoked and expired approvals and rejects false PASS claims', () => {
    const required = requirement();
    const revoked = approvedPrerequisite(required);
    revoked.approval.revoked = true;
    revoked.manifest_sha256 = externalRuntimePrerequisiteHash(revoked);
    expect(() =>
      evaluateExternalRuntimePrerequisite(required, revoked, { requireApproved: true }),
    ).toThrow(/revoked|claims PASS/u);

    const expired = approvedPrerequisite(required);
    expired.approval.expires_at = '2026-08-29T00:00:00Z';
    expired.manifest_sha256 = externalRuntimePrerequisiteHash(expired);
    expect(() =>
      evaluateExternalRuntimePrerequisite(required, expired, {
        requireApproved: true,
        now: new Date('2026-08-30T00:00:00Z'),
      }),
    ).toThrow(/expired/u);

    const falsePass = prerequisite(required, (value) => {
      value.approval.status = 'PASS';
      value.approval.blocking_reasons = [];
    });
    expect(() => evaluateExternalRuntimePrerequisite(required, falsePass)).toThrow(/claims PASS/u);
  });

  it('is capability-driven rather than an MSVC basename allowlist', () => {
    const generic = requirement();
    generic.required_capabilities = ['generic-runtime-core.dll'];
    generic.raw_observations = [
      {
        ...generic.raw_observations[0],
        observation_id: 'generic-runtime-observation',
        capability: 'generic-runtime-core.dll',
      },
    ];
    generic.requirement_sha256 = runtimeConsumerRequirementHash(generic);
    const external = approvedPrerequisite(generic);
    external.provider.provided_capabilities = ['generic-runtime-core.dll'];
    external.provider_binding.capability_dispositions = [
      {
        capability: 'generic-runtime-core.dll',
        disposition: 'EXTERNAL_PROVIDER',
        provider_id: external.provider.provider_id,
      },
    ];
    external.provider_identity_sha256 = externalRuntimeProviderIdentityHash(external);
    external.manifest_sha256 = externalRuntimePrerequisiteHash(external);
    expect(
      evaluateExternalRuntimePrerequisite(generic, external, { requireApproved: true }).status,
    ).toBe('PASS');
  });
});
