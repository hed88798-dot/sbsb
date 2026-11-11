import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

function parseArgs(args) {
  const [command, ...rest] = args;
  if (!['propose', 'inspect', 'confirm'].includes(command)) {
    throw new Error(
      'Usage: cli.mjs propose --db PATH --input TEXT_FILE --route ANIMAL|PRODUCT; inspect --db PATH --candidate ID; confirm --db PATH --intent INTENT_JSON_FILE --confirm',
    );
  }
  const allowed =
    command === 'propose'
      ? ['db', 'input', 'route']
      : command === 'inspect'
        ? ['db', 'candidate']
        : ['db', 'intent', 'confirm'];
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index]?.slice(2);
    if (!rest[index]?.startsWith('--') || !allowed.includes(key) || Object.hasOwn(options, key)) {
      throw new Error('DEMO_CLI_ARGUMENT_INVALID');
    }
    if (key === 'confirm') options[key] = true;
    else {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new Error('DEMO_CLI_ARGUMENT_VALUE_REQUIRED');
      options[key] = value;
    }
  }
  if (allowed.some((key) => !Object.hasOwn(options, key)))
    throw new Error('DEMO_CLI_ARGUMENT_REQUIRED');
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const databasePath = resolve(options.db);
  if (command !== 'propose' && !existsSync(databasePath))
    throw new Error('DEMO_DATABASE_NOT_FOUND');
  const [{ openDatabase }, { DemoCoreService }] = await Promise.all([
    import('../../packages/local-db/dist/index.js'),
    import('../../apps/desktop/dist-electron/main/demo-core-service.js'),
  ]);
  const { db } = await openDatabase({
    dbPath: databasePath,
    migrationsDirectory: resolve(root, 'migrations/desktop-sqlite'),
  });
  try {
    const service = new DemoCoreService({ database: db });
    const state =
      command === 'propose'
        ? service.propose({
            text: await readFile(resolve(options.input), 'utf8'),
            route: options.route,
          })
        : command === 'inspect'
          ? service.get({ candidate_id: options.candidate })
          : service.confirm(JSON.parse(await readFile(resolve(options.intent), 'utf8')));
    const candidate = state.candidate;
    const confirmation_intent = {
      candidate_id: candidate.candidate_id,
      candidate_revision: candidate.candidate_revision,
      source_document_id: candidate.source_document_id,
      source_document_version: candidate.source_document_version,
      source_document_hash: candidate.source_document_hash,
    };
    console.log(JSON.stringify({ state, confirmation_intent }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'DEMO_CLI_FAILED');
  process.exitCode = 1;
});
