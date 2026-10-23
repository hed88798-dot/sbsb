import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(
  root,
  'schemas/shot-planning/v1/semantic-shot-plan-proposal.schema.json',
);
const outputPath = resolve(
  root,
  'apps/desktop/src/main/semantic-shot-plan-proposal-schema.generated.ts',
);
const schema = JSON.parse(readFileSync(sourcePath, 'utf8'));

if (schema?.title !== 'ShotPlanSemanticProposalV1') {
  throw new Error('Unexpected semantic Shot Plan schema identity');
}

const output = await format(
  `// Generated from schemas/shot-planning/v1/semantic-shot-plan-proposal.schema.json.
// Do not edit this binding directly; regenerate it from the canonical JSON Schema.
import type { TextJsonObject } from '@app/contracts';

export const semanticShotPlanProposalJsonSchema: TextJsonObject = ${JSON.stringify(schema, null, 2)};
`,
  { filepath: outputPath, singleQuote: true, trailingComma: 'all', printWidth: 100 },
);

if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== output) {
    throw new Error('Semantic Shot Plan schema runtime binding is stale');
  }
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, 'utf8');
}
