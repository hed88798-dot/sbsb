import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = process.cwd();
const patterns = [
  {
    name: 'private-key',
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    scanBinary: true,
  },
  {
    name: 'provider-key-assignment',
    expression:
      /(?:FAL_KEY|SILICONFLOW_API_KEY|MINIMAX_API_KEY|OPENAI_API_KEY)\s*[:=]\s*['"]?[A-Za-z0-9_./+\-=]{16,}/gi,
    scanBinary: true,
  },
  {
    name: 'generic-secret-assignment',
    expression:
      /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][A-Za-z0-9_./+\-=]{24,}['"]/gi,
    scanBinary: true,
  },
  {
    name: 'github-token',
    expression: /(?:github_pat_[A-Za-z0-9_]{40,}|gh[opsu]_[A-Za-z0-9_]{30,})/g,
    scanBinary: true,
  },
  { name: 'aws-access-key', expression: /AKIA[0-9A-Z]{16}/g, scanBinary: false },
  {
    name: 'jwt',
    expression: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    scanBinary: false,
  },
  {
    name: 'signed-url',
    expression: /X-Amz-Signature=[A-Fa-f0-9]{32,}/g,
    scanBinary: false,
  },
];

function collect(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collect(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function parseArguments() {
  const paths = [];
  const required = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--require') {
      const value = process.argv[index + 1];
      if (!value) throw new Error('--require needs a path');
      required.push(resolve(repositoryRoot, value));
      index += 1;
    } else {
      paths.push(resolve(repositoryRoot, process.argv[index]));
    }
  }
  return { paths, required };
}

let argumentsValue;
try {
  argumentsValue = parseArguments();
} catch (error) {
  console.error(`secret-scan: FAIL\n${error.message}`);
  process.exit(1);
}

for (const path of argumentsValue.required) {
  try {
    statSync(path);
  } catch {
    console.error(`secret-scan: FAIL\nrequired scan target is missing: ${path}`);
    process.exit(1);
  }
}

let files;
if (argumentsValue.paths.length === 0 && argumentsValue.required.length === 0) {
  files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((path) => resolve(repositoryRoot, path));
} else {
  files = [...argumentsValue.paths, ...argumentsValue.required].flatMap((path) => {
    try {
      return statSync(path).isDirectory() ? collect(path) : [path];
    } catch {
      return [];
    }
  });
}

const failures = [];
for (const file of [...new Set(files)]) {
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    continue;
  }
  const binary = buffer.includes(0);
  const content = buffer.toString('latin1');
  for (const pattern of patterns) {
    if (binary && !pattern.scanBinary) continue;
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(content)) failures.push(`${file}: ${pattern.name}`);
  }
}
if (failures.length > 0) {
  console.error(`secret-scan: FAIL\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`secret-scan: PASS (${files.length} files)`);
