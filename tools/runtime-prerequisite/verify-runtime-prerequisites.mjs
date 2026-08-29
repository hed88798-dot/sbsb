import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateExternalRuntimePrerequisite, repositoryRoot } from './runtime-prerequisite.mjs';

const root = resolve(repositoryRoot, 'compliance/runtime-prerequisites/msvc-v14-x64');
const requirement = JSON.parse(
  readFileSync(resolve(root, 'application-requirement.v1.json'), 'utf8'),
);
const prerequisite = JSON.parse(
  readFileSync(resolve(root, 'external-prerequisite.v1.json'), 'utf8'),
);
const requireApproved = process.argv.includes('--require-approved');

try {
  const report = evaluateExternalRuntimePrerequisite(requirement, prerequisite, {
    requireApproved,
  });
  console.log(
    `runtime-prerequisite: PASS (${report.target_disposition}; record=${report.status}; ${report.external_capabilities.length} external capabilities; verify-only)`,
  );
} catch (error) {
  console.error(`runtime-prerequisite: FAIL\n${error.message}`);
  process.exitCode = 1;
}
