import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaPath = new URL('./R1A_NEW_AUTHORITY_INPUT_V1.schema.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const pathKeys = new Set([
  'acceptance_data_root',
  'migrations_directory',
  'staging_root',
  'output_root',
  'executable_path',
  'working_directory',
  'model_root',
  'shot_detector_config_path',
  'source_path',
  'root',
  'manifest_path',
  'approval_receipt_path',
]);

function walk(value, key = '') {
  if (Array.isArray(value)) {
    value.forEach((entry) => walk(entry, key));
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (pathKeys.has(key) && value !== null) assertAbsoluteExecutionPath(value);
    return;
  }
  for (const [nestedKey, nestedValue] of Object.entries(value)) walk(nestedValue, nestedKey);
}

export function assertAbsoluteExecutionPath(value) {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.includes('\0') ||
    value.split(/[\\/]/u).includes('..')
  ) {
    throw new Error('R1A_OPERATOR_PATH_INVALID');
  }
  return resolve(value);
}

function assertControlledChild(rootValue, childValue, code) {
  const root = resolve(rootValue);
  const child = resolve(childValue);
  const fromRoot = relative(root, child);
  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(code);
  }
}

export function parseOperatorConfig(value) {
  if (!validate(value)) {
    const issue = validate.errors?.[0];
    const suffix = issue ? `${issue.instancePath || '/'} ${issue.message}` : 'unknown error';
    throw new Error(`R1A_OPERATOR_CONFIG_INVALID: ${suffix}`);
  }
  const config = structuredClone(value);
  walk(config);
  assertControlledChild(
    config.acceptance_data_root,
    config.staging_root,
    'R1A_STAGING_ROOT_OUTSIDE_ACCEPTANCE_ROOT',
  );
  assertControlledChild(
    config.acceptance_data_root,
    config.output_root,
    'R1A_OUTPUT_ROOT_OUTSIDE_ACCEPTANCE_ROOT',
  );
  if (resolve(config.staging_root) === resolve(config.output_root)) {
    throw new Error('R1A_STAGING_OUTPUT_ROOT_CONFLICT');
  }
  return config;
}

export async function readOperatorConfig(path) {
  const configPath = assertAbsoluteExecutionPath(path);
  return parseOperatorConfig(JSON.parse(await readFile(configPath, 'utf8')));
}
