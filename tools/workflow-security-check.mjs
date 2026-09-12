import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const repositoryRoot = process.cwd();
const workflowDirectory = join(repositoryRoot, '.github', 'workflows');
const failures = [];
// The only workflow allowed to mint a durable release asset is the narrowly
// scoped, branch-only Runtime-v2 retention workflow approved for this intake.
// Bind both its exact path and bytes so a future write-capable workflow (or a
// modified retention workflow) fails closed until separately reviewed.
const approvedReleaseWorkflowHashes = new Map([
  [
    '.github/workflows/code-f-ffmpeg-render-v2-retention.yml',
    '18b44f21781898827d2a950bce39db02740f2b1a23de0ae056713f9637db565d',
  ],
]);
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

for (const name of readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/u.test(entry))) {
  const path = join(workflowDirectory, name);
  const displayPath = relative(repositoryRoot, path);
  const content = readFileSync(path, 'utf8');
  if (/\bpull_request_target\s*:/u.test(content)) {
    failures.push(`${displayPath}: pull_request_target is forbidden`);
  }
  if (/\b(?:contents|actions|packages|deployments|id-token)\s*:\s*write\b/u.test(content)) {
    const approvedHash = approvedReleaseWorkflowHashes.get(displayPath);
    if (!approvedHash) {
      failures.push(
        `${displayPath}: write permission requires a separately approved release design`,
      );
    } else if (sha256(content) !== approvedHash) {
      failures.push(`${displayPath}: approved release workflow bytes changed; re-review required`);
    }
  }
  if (/\bpull_request\s*:/u.test(content) && /\$\{\{\s*secrets\./u.test(content)) {
    failures.push(`${displayPath}: PR workflow must not reference repository/environment secrets`);
  }
  for (const line of content.split('\n')) {
    const action = /^\s*-\s+uses:\s+([^\s#]+)/u.exec(line)?.[1];
    if (!action || action.startsWith('./')) continue;
    const revision = action.split('@').at(-1) ?? '';
    if (!/^[a-f0-9]{40}$/u.test(revision)) {
      failures.push(`${displayPath}: third-party action is not pinned to a commit SHA: ${action}`);
    }
  }
  const checkoutCount = (content.match(/uses:\s+actions\/checkout@/gu) ?? []).length;
  const hardenedCheckoutCount = (content.match(/persist-credentials:\s+false/gu) ?? []).length;
  if (checkoutCount !== hardenedCheckoutCount) {
    failures.push(`${displayPath}: every checkout step must set persist-credentials: false`);
  }
}

if (failures.length > 0) {
  console.error(`workflow-security: FAIL\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('workflow-security: PASS');
