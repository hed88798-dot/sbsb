import { execFileSync } from 'node:child_process';

// Capability floor for the Artifact License Evidence v3 / Review v1 contract.
// This is intentionally not the current main quality baseline.
export const MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE =
  'd1348c50e36b725bfcbf9bec17343392cf0412c7';

function validCommit(value, label) {
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`${label} must be a 40-character SHA-1 commit`);
  }
}

export function containsCommit(commit, descendant, { repositoryRoot = process.cwd() } = {}) {
  validCommit(commit, 'required commit');
  validCommit(descendant, 'validation head');
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, descendant], {
      cwd: repositoryRoot,
      stdio: 'pipe',
      shell: false,
    });
    return true;
  } catch {
    return false;
  }
}

export function assertContainsCommit(
  commit,
  descendant,
  label,
  { repositoryRoot = process.cwd() } = {},
) {
  if (!containsCommit(commit, descendant, { repositoryRoot })) {
    throw new Error(`${descendant} does not contain required ${label}: ${commit}`);
  }
}

export function assertLicenseBaselineBinding({
  minimumBaseline = MINIMUM_REQUIRED_LICENSE_CONTRACT_BASELINE,
  currentMainBaseline,
  validationHead,
  repositoryRoot = process.cwd(),
}) {
  validCommit(minimumBaseline, 'minimum license contract baseline');
  validCommit(currentMainBaseline, 'current main quality baseline');
  validCommit(validationHead, 'validation head');
  assertContainsCommit(minimumBaseline, validationHead, 'minimum license contract baseline', {
    repositoryRoot,
  });
  assertContainsCommit(currentMainBaseline, validationHead, 'current main quality baseline', {
    repositoryRoot,
  });
  return {
    minimumBaseline,
    currentMainBaseline,
    validationHead,
    semantics: 'MINIMUM_CAPABILITY_FLOOR',
  };
}

export function assertWorkerArtifactBinding({
  workerArtifactHead,
  evaluatorHead,
  workerBuildBaseline,
  currentMainBaseline,
  repositoryRoot = process.cwd(),
}) {
  validCommit(workerArtifactHead, 'Worker artifact build head');
  validCommit(evaluatorHead, 'license evaluator head');
  validCommit(workerBuildBaseline, 'Worker build baseline');
  validCommit(currentMainBaseline, 'current main quality baseline');
  assertContainsCommit(workerArtifactHead, evaluatorHead, 'Worker artifact build HEAD', {
    repositoryRoot,
  });
  if (workerBuildBaseline !== currentMainBaseline) {
    throw new Error(
      `Worker Build Context baseline differs from current main quality baseline: ` +
        `${workerBuildBaseline} != ${currentMainBaseline}`,
    );
  }
  return {
    workerArtifactHead,
    evaluatorHead,
    workerBuildBaseline,
    currentMainBaseline,
  };
}
