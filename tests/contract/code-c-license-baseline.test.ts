import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  assertLicenseBaselineBinding,
  assertWorkerArtifactBinding,
  containsCommit,
  MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE,
} from '../../tools/code-c-python-supply-chain/license-baseline.mjs';

const repositoryRoot = process.cwd();
const currentMain = 'e00abb61a5f493ec02cfeea0ee6e4d3e5a0f99b0';
const workerHead = execFileSync('git', ['rev-parse', 'HEAD~1'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
const validationHead = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
const missingCommit = 'f'.repeat(40);

describe('Code C license baseline binding', () => {
  it('passes when validation contains the minimum floor and a newer current main baseline', () => {
    expect(
      assertLicenseBaselineBinding({
        currentMainBaseline: currentMain,
        validationHead,
        repositoryRoot,
      }),
    ).toMatchObject({
      minimumBaseline: MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE,
      currentMainBaseline: currentMain,
      semantics: 'MINIMUM_CAPABILITY_FLOOR',
    });
  });

  it('fails closed when the minimum capability baseline is not contained', () => {
    expect(() =>
      assertLicenseBaselineBinding({
        minimumBaseline: missingCommit,
        currentMainBaseline: currentMain,
        validationHead,
        repositoryRoot,
      }),
    ).toThrow(/minimum license contract baseline/iu);
  });

  it('fails closed when the declared current main baseline is not contained', () => {
    expect(() =>
      assertLicenseBaselineBinding({
        currentMainBaseline: missingCommit,
        validationHead,
        repositoryRoot,
      }),
    ).toThrow(/current main quality baseline/iu);
  });

  it('does not require the current main baseline to equal the validation head', () => {
    expect(currentMain).not.toBe(validationHead);
    expect(containsCommit(currentMain, validationHead, { repositoryRoot })).toBe(true);
  });

  it('retains the historical minimum commit as a valid fixture identity', () => {
    expect(
      containsCommit(MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE, validationHead, {
        repositoryRoot,
      }),
    ).toBe(true);
  });

  it('keeps Worker artifact and evaluator identities independent', () => {
    expect(
      assertWorkerArtifactBinding({
        workerArtifactHead: workerHead,
        evaluatorHead: validationHead,
        workerBuildBaseline: currentMain,
        currentMainBaseline: currentMain,
        repositoryRoot,
      }),
    ).toMatchObject({ workerArtifactHead: workerHead, evaluatorHead: validationHead });
  });

  it('fails closed when the Worker Build Context baseline drifts', () => {
    expect(() =>
      assertWorkerArtifactBinding({
        workerArtifactHead: workerHead,
        evaluatorHead: validationHead,
        workerBuildBaseline: MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE,
        currentMainBaseline: currentMain,
        repositoryRoot,
      }),
    ).toThrow(/Worker Build Context baseline differs/iu);
  });

  it('fails closed when the Worker artifact head is unrelated', () => {
    expect(() =>
      assertWorkerArtifactBinding({
        workerArtifactHead: missingCommit,
        evaluatorHead: validationHead,
        workerBuildBaseline: currentMain,
        currentMainBaseline: currentMain,
        repositoryRoot,
      }),
    ).toThrow(/Worker artifact build HEAD/iu);
  });

  it('fails closed when a declared current main baseline is missing', () => {
    expect(() =>
      assertLicenseBaselineBinding({
        currentMainBaseline: '',
        validationHead,
        repositoryRoot,
      }),
    ).toThrow(/current main quality baseline/iu);
  });

  it('allows evaluator tooling to change without requiring a Worker rebuild', () => {
    const evaluatorHead = validationHead;
    expect(containsCommit(workerHead, evaluatorHead, { repositoryRoot })).toBe(true);
    expect(workerHead).not.toBe(evaluatorHead);
  });
});
