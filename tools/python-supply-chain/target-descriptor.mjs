import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalJson } from './inventory.mjs';
import { runCompatibilityEngine, validateTargetCompatibilityMetadata } from './compatibility.mjs';

function outputPath(values) {
  const index = values.indexOf('--output');
  if (index < 0 || !values[index + 1]) throw new Error('--output requires a path');
  return resolve(values[index + 1]);
}

function sameSet(left, right) {
  const rightSet = new Set(right);
  return left.length === rightSet.size && left.every((value) => rightSet.has(value));
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  if (command === 'describe-current') {
    const target = runCompatibilityEngine({ action: 'describe_current_target' });
    validateTargetCompatibilityMetadata(target);
    const output = outputPath(values);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, canonicalJson(target));
    console.log(
      `python-target-descriptor: CREATED (${target.implementation} ${target.python_version} ${target.os}/${target.architecture}; ${target.compatibility.compatible_tags.length} tags)`,
    );
  } else if (command === 'verify-current') {
    const targetIndex = values.indexOf('--target');
    if (targetIndex < 0 || !values[targetIndex + 1]) throw new Error('--target requires a path');
    const target = JSON.parse(readFileSync(resolve(values[targetIndex + 1]), 'utf8'));
    const current = runCompatibilityEngine({ action: 'describe_current_target' });
    validateTargetCompatibilityMetadata(target);
    if (
      target.implementation !== current.implementation ||
      target.python_version !== current.python_version ||
      target.os !== current.os ||
      target.architecture !== current.architecture ||
      !sameSet(target.compatibility.compatible_tags, current.compatibility.compatible_tags)
    ) {
      throw new Error('target descriptor does not match the current Python target environment');
    }
    console.log('python-target-descriptor: PASS (matches current target environment)');
  } else {
    throw new Error(`unknown target descriptor command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`python-target-descriptor: FAIL\n${error.message}`);
  process.exitCode = 1;
});
