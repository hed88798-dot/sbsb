import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../tools/native-runtime-companion/companion.mjs';

const reviewRoot = resolve(
  dirname(import.meta.filename),
  '../../compliance/runtime-dependency-intake/ffprobe-v2/review-v2',
);

const files = {
  artifactLinux: 'FFPROBE_RUNTIME_COMPANION_ARTIFACT_APPROVAL_LINUX_V2.json',
  artifactWindows: 'FFPROBE_RUNTIME_COMPANION_ARTIFACT_APPROVAL_WINDOWS_V2.json',
  obligationLinux: 'FFPROBE_RUNTIME_COMPANION_LICENSE_OBLIGATION_LINUX_V2.json',
  obligationWindows: 'FFPROBE_RUNTIME_COMPANION_LICENSE_OBLIGATION_WINDOWS_V2.json',
  licenseLinux: 'FFPROBE_RUNTIME_COMPANION_LICENSE_REVIEW_LINUX_V2.json',
  licenseWindows: 'FFPROBE_RUNTIME_COMPANION_LICENSE_REVIEW_WINDOWS_V2.json',
  aggregate: 'FFPROBE_RUNTIME_COMPANION_ARTIFACT_AND_LICENSE_REVIEW_BUNDLE_V2.json',
} as const;

function load(name: string) {
  return JSON.parse(readFileSync(resolve(reviewRoot, name), 'utf8')) as Record<string, unknown>;
}

function recordHash(record: Record<string, unknown>) {
  const withoutRecordHash = { ...record };
  delete withoutRecordHash.record_sha256;
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(withoutRecordHash)))
    .digest('hex');
}

function readRecordSha(name: string) {
  const record = load(name);
  expect(record.record_sha256).toBe(recordHash(record));
  return record.record_sha256 as string;
}

describe('FFprobe Packaging v2 review authority', () => {
  it('keeps every immutable record self-hashed and free of placeholders', () => {
    for (const name of Object.values(files)) {
      const record = load(name);
      expect(record).not.toHaveProperty('PENDING');
      expect(record.record_sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(record.record_sha256).toBe(recordHash(record));
    }
  });

  it('binds both artifact approvals to the exact packaging v2 identities', () => {
    const linux = load(files.artifactLinux);
    const windows = load(files.artifactWindows);
    expect(linux.decision).toBe('APPROVED');
    expect(windows.decision).toBe('APPROVED');
    expect((linux.subject as Record<string, unknown>).bundle_identity_sha256).toBe(
      '171a289b8ce7bcc443b448f75225469e192ca38dbc1cc8fa233b8f6c6463f1db',
    );
    expect((windows.subject as Record<string, unknown>).bundle_identity_sha256).toBe(
      '67f37171869f353712f6f02341a2beb5755c3ba1d2ae4702aa0effe0283856e8',
    );
    for (const record of [linux, windows]) {
      const packaging = record.packaging_issuance as Record<string, unknown>;
      expect(packaging.root_authority_manifest_present).toBe(true);
      expect(packaging.bundle_authority_manifest_absent).toBe(true);
      expect(record.identity_drift).toMatchObject({
        canonical_runtime_identity_drift: 'NONE',
        packaging_issuance_drift: 'PRESENT_EXPECTED',
        historical_rejected_packaging_issuance_acceptable_for_integration: false,
      });
    }
  });

  it('keeps license review separate and bound to its obligation authority', () => {
    const obligationLinuxSha = readRecordSha(files.obligationLinux);
    const obligationWindowsSha = readRecordSha(files.obligationWindows);
    const licenseLinux = load(files.licenseLinux);
    const licenseWindows = load(files.licenseWindows);
    expect(licenseLinux.decision).toBe('APPROVED');
    expect(licenseWindows.decision).toBe('APPROVED');
    expect((licenseLinux.obligation_set as Record<string, unknown>).sha256).toBe(
      obligationLinuxSha,
    );
    expect((licenseWindows.obligation_set as Record<string, unknown>).sha256).toBe(
      obligationWindowsSha,
    );
    expect(licenseLinux.reviewed_spdx_expression).toBe('LGPL-2.1-or-later');
    expect(licenseWindows.reviewed_spdx_expression).toBe('LGPL-2.1-or-later');
    expect(
      (licenseLinux.coverage as Record<string, unknown>).unaccounted_license_relevant_member_count,
    ).toBe(0);
    expect(
      (licenseWindows.coverage as Record<string, unknown>)
        .unaccounted_license_relevant_member_count,
    ).toBe(0);
  });

  it('keeps the aggregate authority internally consistent and downstream-only', () => {
    const aggregate = load(files.aggregate);
    const expectedArtifact = [files.artifactLinux, files.artifactWindows].map(readRecordSha);
    const expectedLicense = [files.licenseLinux, files.licenseWindows].map(readRecordSha);
    expect(
      (aggregate.artifact_approval_records as Array<Record<string, unknown>>).map(
        (x) => x.record_sha256,
      ),
    ).toEqual(expectedArtifact);
    expect(
      (aggregate.license_review_records as Array<Record<string, unknown>>).map(
        (x) => x.record_sha256,
      ),
    ).toEqual(expectedLicense);
    expect(aggregate.stable_release_license_gate).toBe('BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION');
    expect(aggregate.code_c_ffprobe_runtime_companion_integration).toBe('READY_NOT_RUN');
    expect(aggregate.code_c_notification).toBe('NOT_SENT');
  });
});
