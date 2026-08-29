import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArtifactLicenseEvidenceV3 } from './artifact-review.mjs';
import { canonicalJson, normalizePythonName } from '../python-supply-chain/inventory.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

try {
  const wheel = value('--wheel');
  const output = value('--output');
  if (!wheel || !output) throw new Error('--wheel and --output are required');
  const wheelPath = resolve(wheel);
  const python = process.env.PYTHON_EXECUTABLE || 'python3';
  const inspected = JSON.parse(
    execFileSync(
      python,
      [resolve(repositoryRoot, 'tools/python-supply-chain/inspect-wheel.py'), wheelPath],
      { cwd: repositoryRoot, encoding: 'utf8' },
    ),
  );
  const packageName = normalizePythonName(inspected.package_name);
  const suggestion = value('--machine-suggestion');
  const hasRawLicenseEvidence = Boolean(
    inspected.license_expression?.trim() ||
    inspected.legacy_license?.trim() ||
    inspected.license_classifiers.length > 0 ||
    inspected.license_files.length > 0,
  );
  const evidence = createArtifactLicenseEvidenceV3({
    artifact: {
      package: packageName,
      version: inspected.version,
      filename: inspected.filename,
      sha256: sha256(wheelPath),
      purl: `pkg:pypi/${packageName}@${inspected.version}`,
    },
    inspected,
    evidenceStatus: inspected.license_expression
      ? 'PASS'
      : hasRawLicenseEvidence
        ? 'MANUAL_REVIEW'
        : 'FAIL',
    machineSuggestion: suggestion
      ? {
          status: 'UNAPPROVED_MACHINE_SUGGESTION',
          suggested_spdx_expression: suggestion,
          generator: 'capture-artifact-license-evidence.mjs/manual-input',
        }
      : null,
  });
  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, canonicalJson(evidence));
  console.log(
    `artifact-license-evidence: PASS (${evidence.artifact.sha256}; ${evidence.evidence_status}; review not created)`,
  );
} catch (error) {
  console.error(`artifact-license-evidence: FAIL\n${error.message}`);
  process.exitCode = 1;
}
