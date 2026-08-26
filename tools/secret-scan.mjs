import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:FAL_KEY|SILICONFLOW_API_KEY|MINIMAX_API_KEY)\s*=\s*[^\s<{]/,
  /(?:api[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_-]{24,}['"]/i,
  /github_pat_[A-Za-z0-9_]{40,}/,
];
const failures = [];
for (const file of files) {
  if (/\.(?:png|jpg|jpeg|gif|ico|woff2?|zip)$/i.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (patterns.some((pattern) => pattern.test(content))) failures.push(file);
}
if (failures.length > 0) {
  console.error(`secret-scan: FAIL\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('secret-scan: PASS');
