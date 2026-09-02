import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLicenseEvidence, loadLicensePolicy } from './evaluator.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function fail(message) {
  throw new Error(`license-universe-replay: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function evaluateTargetUsage(usage, policy) {
  const decision = evaluateLicenseEvidence(
    {
      artifact_sha256: usage.artifact_sha256,
      package: usage.package,
      version: usage.version,
      artifact_type: 'PYTHON_WHEEL',
      artifact_role: usage.artifact_role,
      distribution_role: usage.distribution_role,
      detected_license_expression: usage.detected_license_expression,
      evidence_status: 'PASS',
      source_provenance: { review_status: 'APPROVED' },
      evidence_sources: [{ evidence_type: 'LICENSE_FILE', relative_path: 'LICENSE' }],
      usage_policy_context: usage.usage_policy_context,
    },
    { policy },
  );
  return decision;
}

export function reEvaluateUsageUniverse(
  input,
  { policy: loadedPolicy = loadLicensePolicy() } = {},
) {
  const policy = loadedPolicy.document ?? loadedPolicy;
  assert(input.schema_version === '1', 'unsupported universe snapshot schema');
  assert(Number.isInteger(input.total_usage), 'total_usage must be an integer');
  assert(Array.isArray(input.target_usages), 'target_usages must be an array');
  assert(
    Number.isInteger(input.non_target_usage_count),
    'non_target_usage_count must be an integer',
  );
  assert(
    input.target_usages.length + input.non_target_usage_count === input.total_usage,
    'target and non-target usage counts do not cover the universe',
  );
  const previous = input.pre_change_disposition_counts ?? {};
  const current = input.expected_non_target_disposition_counts ?? {};
  const previousTargetCount = input.target_usages.filter(
    (usage) => usage.previous_policy_result === 'FAIL',
  ).length;
  const previousNonTarget =
    (previous.PASS ?? 0) +
    (previous.MANUAL_REVIEW ?? 0) +
    (previous.FAIL ?? 0) -
    previousTargetCount;
  assert(previousNonTarget === input.non_target_usage_count, 'non-target partition is incomplete');
  assert(
    (current.PASS ?? 0) + (current.MANUAL_REVIEW ?? 0) + (current.FAIL ?? 0) ===
      input.non_target_usage_count,
    'expected non-target disposition partition is incomplete',
  );
  const targetResults = input.target_usages.map((usage) => {
    const decision = evaluateTargetUsage(usage, loadedPolicy);
    assert(
      decision.policy_result === usage.expected_policy_result,
      `${usage.usage_binding_id}: unexpected policy result`,
    );
    return {
      usage_binding_id: usage.usage_binding_id,
      artifact_sha256: usage.artifact_sha256,
      previous_policy_result: usage.previous_policy_result,
      current_policy_result: decision.policy_result,
      policy_rule_id: decision.policy_rule_id,
      policy_disposition: decision.policy_disposition,
      policy_input_hash: decision.policy_input_hash,
    };
  });
  const targetChanges = targetResults.filter(
    (entry) => entry.previous_policy_result !== entry.current_policy_result,
  );
  const previousNonTargetCounts = {
    PASS:
      (previous.PASS ?? 0) -
      input.target_usages.filter((usage) => usage.previous_policy_result === 'PASS').length,
    MANUAL_REVIEW:
      (previous.MANUAL_REVIEW ?? 0) -
      input.target_usages.filter((usage) => usage.previous_policy_result === 'MANUAL_REVIEW')
        .length,
    FAIL: (previous.FAIL ?? 0) - previousTargetCount,
  };
  const nonTargetDrift = Object.keys(previousNonTargetCounts).reduce(
    (count, key) => count + Math.abs((previousNonTargetCounts[key] ?? 0) - (current[key] ?? 0)),
    0,
  );
  return {
    schema_version: '1',
    source_snapshot_id: input.source_snapshot_id,
    license_policy_version: policy.license_policy_version,
    total_usage: input.total_usage,
    target_usage_count: targetResults.length,
    target_changes: targetChanges,
    target_change_count: targetChanges.length,
    non_target_usage_count: input.non_target_usage_count,
    non_target_policy_disposition_drift_count: nonTargetDrift,
    pre_change_disposition_counts: previous,
    post_change_disposition_counts: input.post_change_disposition_counts,
    license_disposition_partition:
      targetChanges.length === input.target_usages.length && nonTargetDrift === 0 ? 'PASS' : 'FAIL',
    full_current_license_universe_reevaluation: true,
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--input') options.input = args[++index];
    else if (args[index] === '--output') options.output = args[++index];
    else fail(`unknown argument: ${args[index]}`);
  }
  if (!options.input) fail('--input is required');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = reEvaluateUsageUniverse(readJson(options.input));
    if (options.output)
      writeFileSync(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `license-universe-replay: ${report.license_disposition_partition} (${report.total_usage} usages; ${report.target_change_count} target changes; ${report.non_target_policy_disposition_drift_count} non-target drift)`,
    );
  } catch (error) {
    console.error(`license-universe-replay: FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}
