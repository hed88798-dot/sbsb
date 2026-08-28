import { spawnSync } from 'node:child_process';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolDirectory, '../..');
export const compatibilityEngineMetadata = Object.freeze({
  compatibility_engine: 'pypa-packaging',
  compatibility_engine_version: '1',
  packaging_version: '25.0',
  wheel_tag_parser: 'packaging.utils.parse_wheel_filename',
  wheel_tag_parser_version: '25.0',
  target_descriptor_version: '1',
});

export function runCompatibilityEngine(request) {
  const pythonExecutable =
    process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python.exe' : 'python3');
  const toolingRoot = resolve(
    process.env.PYTHON_COMPLIANCE_TOOL_ROOT ||
      resolve(repositoryRoot, 'artifacts/python-compliance-tools'),
  );
  const sitePackages = resolve(toolingRoot, 'site-packages');
  const result = spawnSync(pythonExecutable, [resolve(toolDirectory, 'compatibility-engine.py')], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
  });
  if (result.error || result.status !== 0) {
    throw (
      result.error ??
      new Error(
        result.stderr.trim() ||
          'wheel compatibility engine unavailable; run pnpm compliance:python:tooling:install',
      )
    );
  }
  return JSON.parse(result.stdout);
}

export function parseWheelFilename(filename) {
  return runCompatibilityEngine({ action: 'parse_wheel', filename });
}

export function evaluateWheel(filename, target) {
  return runCompatibilityEngine({
    action: 'evaluate',
    filename,
    compatible_tags: target.compatibility.compatible_tags,
  });
}

export function currentTargetDescriptor() {
  return runCompatibilityEngine({ action: 'describe_current_target' });
}

export function assertTargetMatchesCurrent(target) {
  const current = currentTargetDescriptor();
  validateTargetCompatibilityMetadata(target);
  const expectedTags = new Set(current.compatibility.compatible_tags);
  if (
    target.implementation !== current.implementation ||
    target.python_version !== current.python_version ||
    target.os !== current.os ||
    target.architecture !== current.architecture ||
    target.compatibility.compatible_tags.length !== expectedTags.size ||
    target.compatibility.compatible_tags.some((tag) => !expectedTags.has(tag))
  ) {
    throw new Error('target descriptor does not match current packaging.tags.sys_tags environment');
  }
}

export function validateTargetCompatibilityMetadata(target) {
  const failures = [];
  for (const [key, expected] of Object.entries(compatibilityEngineMetadata)) {
    if (key === 'target_descriptor_version') {
      if (target.target_descriptor_version !== expected)
        failures.push(`target ${key} must be ${expected}`);
    } else if (target.compatibility[key] !== expected) {
      failures.push(`target compatibility ${key} must be ${expected}`);
    }
  }
  const calculated = runCompatibilityEngine({
    action: 'hash_tags',
    tags: target.compatibility.compatible_tags,
  });
  if (calculated.compatible_tags_sha256 !== target.compatibility.compatible_tags_sha256) {
    failures.push('target compatible_tags_sha256 does not match materialized tag set');
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}
