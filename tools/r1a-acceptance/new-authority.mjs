#!/usr/bin/env node
import { resolve } from 'node:path';
import { readOperatorConfig } from './config.mjs';
import { runControlledAuthorityOperator } from './operator.mjs';

async function main() {
  if (process.argv.length !== 3) throw new Error('USAGE: pnpm r1a:authority:new -- <config>');
  const config = await readOperatorConfig(resolve(process.argv[2]));
  const result = await runControlledAuthorityOperator(config);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const code = error instanceof Error ? error.message.split(':', 1)[0] : 'R1A_OPERATOR_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'BLOCKED', blocker: code })}\n`);
  process.exitCode = 1;
});
