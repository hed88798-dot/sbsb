import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson } from '../python-supply-chain/inventory.mjs';
import {
  validateWindowsRuntimeProviderProbe,
  windowsRuntimeProviderProbeHash,
} from './runtime-prerequisite.mjs';

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const input = value('--input');
  const prerequisitePath = value('--prerequisite');
  const output = value('--output') ?? input;
  if (!input || !prerequisitePath || !output) {
    throw new Error('--input, --prerequisite and --output are required');
  }
  const probe = JSON.parse(readFileSync(resolve(input), 'utf8'));
  const prerequisite = JSON.parse(readFileSync(resolve(prerequisitePath), 'utf8'));
  probe.probe_sha256 = windowsRuntimeProviderProbeHash(probe);
  validateWindowsRuntimeProviderProbe(probe, prerequisite);
  writeFileSync(resolve(output), canonicalJson(probe));
  console.log(`windows-runtime-provider-probe: PASS (${probe.evidence_id}; ${probe.probe_sha256})`);
} catch (error) {
  console.error(`windows-runtime-provider-probe: FAIL\n${error.message}`);
  process.exitCode = 1;
}
