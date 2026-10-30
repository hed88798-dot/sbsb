import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openGoldenEvaluationEnvironment } from '../helpers/golden-evaluation-environment.js';
import { observeGoldenProviderUsage } from '../helpers/golden-provider-usage.js';
import { runShotPlanGoldenEvaluation } from '../helpers/shot-plan-golden-evaluation.js';

const enabled = process.env.REAL_SHOT_PLAN_GOLDEN_EVAL === '1';
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing real-evaluation variable: ${name}`);
  return value;
}

describe.skipIf(!enabled)('opt-in real 30-case semantic golden evaluation', () => {
  it('records the sequential trusted chain and automated evidence for Brain1 inspection', async () => {
    let environment: Awaited<ReturnType<typeof openGoldenEvaluationEnvironment>> | undefined;
    let usage: ReturnType<typeof observeGoldenProviderUsage> | undefined;
    try {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (
        head !== required('REAL_SHOT_PLAN_GOLDEN_REVIEWED_HEAD') ||
        execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).trim()
      )
        throw new Error('REAL_GOLDEN_REVIEWED_CLEAN_HEAD_REQUIRED');
      const directory = mkdtempSync(join(tmpdir(), 'real-shot-plan-golden-'));
      environment = await openGoldenEvaluationEnvironment({
        directory,
        budgetCny: Number(required('REAL_SHOT_PLAN_GOLDEN_BUDGET_CNY')),
        provider: {
          endpoint: required('REAL_TEXT_PROVIDER_ENDPOINT'),
          apiKey: required('REAL_TEXT_PROVIDER_KEY'),
          webhookSecret: required('REAL_TEXT_PROVIDER_WEBHOOK_SECRET'),
          inputUnitCost: Number(required('REAL_TEXT_PROVIDER_INPUT_UNIT_COST')),
          outputUnitCost: Number(required('REAL_TEXT_PROVIDER_OUTPUT_UNIT_COST')),
          currency: 'CNY',
        },
        approval: {
          apiTermsVersion: required('REAL_TEXT_PROVIDER_TERMS_VERSION'),
          modelCodeLicense: required('REAL_TEXT_PROVIDER_CODE_LICENSE'),
          modelWeightLicense: required('REAL_TEXT_PROVIDER_WEIGHT_LICENSE'),
          commercialUse: true,
          outputOwnership: required('REAL_TEXT_PROVIDER_OUTPUT_OWNERSHIP'),
          trainingOrRetentionPolicy: required('REAL_TEXT_PROVIDER_RETENTION_POLICY'),
          regionDataTransfer: required('REAL_TEXT_PROVIDER_REGION_POLICY'),
          prohibitedContent: required('REAL_TEXT_PROVIDER_CONTENT_POLICY'),
          attributionRequirement: required('REAL_TEXT_PROVIDER_ATTRIBUTION'),
          approvedBy: required('REAL_TEXT_PROVIDER_APPROVED_BY'),
          approvedAt: required('REAL_TEXT_PROVIDER_APPROVED_AT'),
          expiresAt: required('REAL_TEXT_PROVIDER_APPROVAL_EXPIRES_AT'),
        },
      });
      usage = observeGoldenProviderUsage(required('REAL_TEXT_PROVIDER_ENDPOINT'));
      const report = await runShotPlanGoldenEvaluation({
        ...environment,
        directory,
        gitHead: head,
        executionKind: 'REAL_PROVIDER_EVALUATION',
        usage,
      });
      expect(report.summary.FIXTURES_EXPECTED).toBe(30);
      expect(report.summary.C3C_REAL_MODEL_SEMANTIC_ACCEPTANCE).toBe('PENDING_BRAIN1_REVIEW');
      // The entire report is written before this automated gate; product approval remains separate.
      expect(report.summary.AUTOMATED_30_CASE_GOLDEN_RESULT).toBe('PASS');
    } catch {
      throw new Error('REAL_GOLDEN_EVALUATION_FAILED_SEE_LOCAL_EVIDENCE');
    } finally {
      delete process.env.REAL_SHOT_PLAN_GOLDEN_EVAL;
      usage?.close();
      await environment?.close();
    }
  }, 2_000_000);
});
