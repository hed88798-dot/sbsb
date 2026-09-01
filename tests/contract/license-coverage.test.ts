import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { licenseIdentityHash } from '../../tools/license-policy/evaluator.mjs';
import {
  evaluateLicenseCoverage,
  licenseCoverageRecordHash,
  upstreamReleaseBindingRecordHash,
  validateBuildOnlyUsageBinding,
  validateLicenseCoverageRecord,
  validateUpstreamReleaseBinding,
} from '../../tools/license-policy/coverage.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const fixtureRoot = join(repositoryRoot, 'tests/fixtures/license-coverage');

function fixture(name: string) {
  const root = join(fixtureRoot, name);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const artifact = JSON.parse(readFileSync(join(root, 'artifact.json'), 'utf8'));
  const members = JSON.parse(readFileSync(join(root, 'members.json'), 'utf8'));
  const records = JSON.parse(readFileSync(join(root, 'coverage.json'), 'utf8'));
  const binding = name.startsWith('sentencepiece-')
    ? JSON.parse(readFileSync(join(root, 'upstream-binding.json'), 'utf8'))
    : null;
  return { manifest, artifact, members, records, binding };
}

function refreshCoverage(record: Record<string, unknown>) {
  record.coverage_record_sha256 = licenseCoverageRecordHash(record);
  return record;
}

function refreshBinding(binding: Record<string, unknown>) {
  binding.binding_record_sha256 = upstreamReleaseBindingRecordHash(binding);
  return binding;
}

describe('generic upstream release and license coverage contract', () => {
  it('accepts Linux SLSA binding and records stronger build provenance assurance', () => {
    const current = fixture('sentencepiece-linux');
    const binding = validateUpstreamReleaseBinding(current.binding, {
      expectedRelease: current.manifest.expected_upstream_release,
    });
    const result = evaluateLicenseCoverage({
      ...current,
      upstreamBinding: binding,
      expectedRelease: current.manifest.expected_upstream_release,
    });
    expect(binding.binding_method).toBe('BUILD_PROVENANCE_ATTESTATION');
    expect(binding.attestation).toMatchObject({ integrity: 'PASS', subject_membership: 'PRESENT' });
    expect(binding.binding_assurance).toBe('BUILD_PROVENANCE_VERIFIED');
    expect(result).toMatchObject({ status: 'PASS', unaccounted_license_relevant_member_count: 0 });
  });

  it('accepts Windows exact official Release bytes without inventing an SLSA subject', () => {
    const current = fixture('sentencepiece-windows');
    const binding = validateUpstreamReleaseBinding(current.binding, {
      expectedRelease: current.manifest.expected_upstream_release,
    });
    evaluateLicenseCoverage({
      ...current,
      upstreamBinding: binding,
      expectedRelease: current.manifest.expected_upstream_release,
    });
    expect(binding.binding_method).toBe('OFFICIAL_RELEASE_ASSET_BYTE_IDENTITY');
    expect(binding.binding_assurance).toBe('OFFICIAL_PUBLICATION_EXACT_BYTES');
    expect(binding.attestation).toMatchObject({ integrity: 'PASS', subject_membership: 'ABSENT' });
  });

  it('covers hooks by deterministic component/path selectors and preserves build-only policy input', () => {
    const current = fixture('pyinstaller-hooks-contrib');
    const result = evaluateLicenseCoverage(current);
    expect(result.covered_member_count).toBe(3);
    expect(
      current.records.map(
        (entry: Record<string, unknown>) =>
          (entry.license_assertion as Record<string, unknown>).spdx_expression,
      ),
    ).toEqual(['GPL-2.0-or-later', 'Apache-2.0']);
    expect(
      validateBuildOnlyUsageBinding(
        JSON.parse(
          readFileSync(join(fixtureRoot, 'pyinstaller-hooks-contrib/usage-binding.json'), 'utf8'),
        ),
      ),
    ).toMatchObject({
      distribution_role: 'BUILD_ONLY_USE',
      distributed_in_final_worker: false,
    });
  });

  it.each([
    [
      'wrong repository',
      (binding: Record<string, unknown>) => {
        (binding.upstream_release as Record<string, unknown>).repository =
          'https://github.com/other/project';
      },
    ],
    [
      'wrong tag',
      (binding: Record<string, unknown>) => {
        (binding.upstream_release as Record<string, unknown>).release_tag = 'v0.2.0';
      },
    ],
    [
      'wrong commit',
      (binding: Record<string, unknown>) => {
        (binding.upstream_release as Record<string, unknown>).release_commit = '0'.repeat(40);
      },
    ],
  ])('blocks %s even when the altered binding is re-hashed', (_label, mutate) => {
    const current = fixture('sentencepiece-linux');
    const binding = structuredClone(current.binding);
    mutate(binding);
    const release = binding.upstream_release;
    release.release_membership_evidence_sha256 = licenseIdentityHash({
      repository: release.repository,
      release_tag: release.release_tag,
      release_commit: release.release_commit,
      release_asset_filename: release.release_asset_filename,
      release_asset_sha256: release.release_asset_sha256,
      release_membership: release.release_membership,
    });
    refreshBinding(binding);
    expect(() =>
      validateUpstreamReleaseBinding(binding, {
        expectedRelease: current.manifest.expected_upstream_release,
      }),
    ).toThrow(/approved identity/u);
  });

  it('fails closed for asset mismatch, tampered provenance, and a valid attestation with the wrong subject', () => {
    const current = fixture('sentencepiece-linux');
    const mismatchedAsset = structuredClone(current.binding);
    mismatchedAsset.upstream_release.release_asset_sha256 = 'f'.repeat(64);
    refreshBinding(mismatchedAsset);
    expect(() => validateUpstreamReleaseBinding(mismatchedAsset)).toThrow(
      /release membership evidence identity|release asset bytes/u,
    );

    const tampered = structuredClone(current.binding);
    tampered.attestation.provenance_sha256 = 'e'.repeat(64);
    expect(() => validateUpstreamReleaseBinding(tampered)).toThrow(/record hash mismatch/u);

    const wrongSubject = structuredClone(current.binding);
    wrongSubject.attestation.subject_membership = 'ABSENT';
    refreshBinding(wrongSubject);
    expect(() => validateUpstreamReleaseBinding(wrongSubject)).toThrow(/not fully verified/u);
  });

  it('blocks release-license evidence from another source release and a mismatched LICENSE hash', () => {
    const current = fixture('sentencepiece-linux');
    const otherRelease = structuredClone(current.binding);
    otherRelease.upstream_release.source_archive_sha256 = 'd'.repeat(64);
    refreshBinding(otherRelease);
    expect(() =>
      evaluateLicenseCoverage({
        ...current,
        upstreamBinding: otherRelease,
        expectedRelease: current.manifest.expected_upstream_release,
      }),
    ).toThrow(/source\/license evidence/u);

    const badLicense = structuredClone(current.records[0]);
    badLicense.evidence_source.license_sha256 = 'a'.repeat(64);
    refreshCoverage(badLicense);
    expect(() =>
      evaluateLicenseCoverage({
        ...current,
        records: [badLicense],
        upstreamBinding: current.binding,
      }),
    ).toThrow(/source\/license evidence|LICENSE file SHA-256/u);
  });

  it('blocks missing coverage, uncovered members, overlap, unknown paths, wrong artifact, and bad distribution role', () => {
    const current = fixture('pyinstaller-hooks-contrib');
    expect(() => evaluateLicenseCoverage({ ...current, records: [] })).toThrow(
      /uncovered license-relevant/u,
    );
    expect(() => evaluateLicenseCoverage({ ...current, records: [current.records[0]] })).toThrow(
      /uncovered license-relevant/u,
    );

    const overlap = structuredClone(current.records[0]);
    overlap.coverage_selector.include = ['_pyinstaller_hooks_contrib/**'];
    overlap.coverage_selector.exclude = [];
    refreshCoverage(overlap);
    expect(() =>
      evaluateLicenseCoverage({ ...current, records: [overlap, current.records[1]] }),
    ).toThrow(/overlapping coverage/u);

    const unknownPath = structuredClone(current.records[0]);
    unknownPath.coverage_selector.selector_type = 'EXACT_PATH';
    unknownPath.coverage_selector.include = ['does-not-exist.py'];
    unknownPath.coverage_selector.exclude = [];
    unknownPath.coverage_selector.explicit_member_paths = [];
    refreshCoverage(unknownPath);
    expect(() =>
      evaluateLicenseCoverage({ ...current, records: [unknownPath, current.records[1]] }),
    ).toThrow(/matches no existing member/u);

    const wrongArtifact = structuredClone(current.records[0]);
    wrongArtifact.covered_subject.sha256 = 'b'.repeat(64);
    refreshCoverage(wrongArtifact);
    expect(() =>
      evaluateLicenseCoverage({ ...current, records: [wrongArtifact, current.records[1]] }),
    ).toThrow(/another exact artifact/u);

    const badRole = structuredClone(current.members);
    badRole[0].usage = 'DISTRIBUTED';
    badRole[0].distribution_role = 'BUILD_ONLY_USE';
    expect(() => evaluateLicenseCoverage({ ...current, members: badRole })).toThrow(
      /cannot be classified BUILD_ONLY_USE/u,
    );
  });

  it('keeps coverage evidence separate from commercial policy disposition', () => {
    const current = fixture('sentencepiece-linux');
    const record = validateLicenseCoverageRecord(current.records[0]);
    const result = evaluateLicenseCoverage(current);
    expect(result.status).toBe('PASS');
    expect(record.review_provenance.review_status).toBe('REQUIRES_REVIEW');
    expect(record).not.toHaveProperty('commercial_use');
    expect(record).not.toHaveProperty('distribution_allowed');
  });
});
