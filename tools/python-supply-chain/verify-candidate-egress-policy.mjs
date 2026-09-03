import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function uploadBlocks(content) {
  return content
    .split(/(?=^\s*-\s+uses:\s+[^\s#]*upload-artifact@)/gmu)
    .filter((block) => /^\s*-\s+uses:\s+[^\s#]*upload-artifact@/mu.test(block));
}

function isFullCandidateTransfer(block) {
  return /candidate-transfer|full[-_ ]candidate|worker[\s\S]*carchive|carchive[\s\S]*worker/iu.test(
    block,
  );
}

function inspectWorkflowDirectory(workflowDirectory) {
  const failures = [];
  for (const name of readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/u.test(entry))) {
    const path = join(workflowDirectory, name);
    const content = readFileSync(path, 'utf8');
    for (const block of uploadBlocks(content)) {
      if (!isFullCandidateTransfer(block)) continue;
      const retention = /retention-days:\s*(\d+)/iu.exec(block)?.[1];
      if (retention !== '1') {
        failures.push(`${name}: full Candidate transfer artifact must set retention-days: 1`);
      }
      if (!/candidate-transfer-manifest|transfer-manifest|manifest\.json/iu.test(block)) {
        failures.push(`${name}: full Candidate transfer must upload its transfer manifest`);
      }
    }
  }
  return failures;
}

const failures = inspectWorkflowDirectory(join(repositoryRoot, '.github', 'workflows'));
if (failures.length > 0) {
  console.error(`candidate-egress-policy: FAIL\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('candidate-egress-policy: PASS');

export { inspectWorkflowDirectory, isFullCandidateTransfer, uploadBlocks };
