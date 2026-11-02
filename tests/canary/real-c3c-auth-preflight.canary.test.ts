import { mkdtempSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openC3cAuthPreflight } from '../helpers/c3c-auth-preflight.js';

const enabled = process.env.REAL_C3C_AUTH_PREFLIGHT_CANARY === '1';
function required(suffix: string) {
  const value = process.env[`REAL_TEXT_PROVIDER_${suffix}`];
  if (!value) throw new Error(`Missing auth preflight environment: ${suffix}`);
  return value;
}

describe.skipIf(!enabled)('opt-in same-path C3C authentication preflight', () => {
  it('records one synthetic non-semantic request through the frozen authenticated route', async () => {
    let environment: Awaited<ReturnType<typeof openC3cAuthPreflight>> | undefined;
    let descriptor: number | undefined;
    try {
      const directory = mkdtempSync(join(tmpdir(), 'real-c3c-auth-preflight-'));
      // Reserve the evidence file before HTTP; never overwrite another run.
      descriptor = openSync(join(directory, 'auth-preflight-evidence.json'), 'wx', 0o600);
      environment = await openC3cAuthPreflight({
        directory,
        provider: {
          endpoint: required('ENDPOINT'),
          apiKey: required('KEY'),
          webhookSecret: required('WEBHOOK_SECRET'),
          inputUnitCost: Number(required('INPUT_UNIT_COST')),
          outputUnitCost: Number(required('OUTPUT_UNIT_COST')),
          currency: 'CNY',
        },
        approval: {
          apiTermsVersion: required('TERMS_VERSION'),
          modelCodeLicense: required('CODE_LICENSE'),
          modelWeightLicense: required('WEIGHT_LICENSE'),
          commercialUse: true,
          outputOwnership: required('OUTPUT_OWNERSHIP'),
          trainingOrRetentionPolicy: required('RETENTION_POLICY'),
          regionDataTransfer: required('REGION_POLICY'),
          prohibitedContent: required('CONTENT_POLICY'),
          attributionRequirement: required('ATTRIBUTION'),
          approvedBy: required('APPROVED_BY'),
          approvedAt: required('APPROVED_AT'),
          expiresAt: required('APPROVAL_EXPIRES_AT'),
        },
      });
      const report = await environment.run();
      writeFileSync(descriptor, JSON.stringify(report, null, 2));
      expect(report.result).toBe('PASS');
    } catch {
      // Never echo upstream errors, raw text, credential configuration or Provider messages.
      throw new Error('C3C_AUTH_PREFLIGHT_FAILED_SEE_ISOLATED_EVIDENCE');
    } finally {
      delete process.env.REAL_C3C_AUTH_PREFLIGHT_CANARY;
      if (descriptor !== undefined) closeSync(descriptor);
      await environment?.close();
    }
  }, 60_000);
});
