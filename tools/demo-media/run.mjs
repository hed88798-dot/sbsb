import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDatabase,
  MediaIndexRepository,
  NarrationAudioRepository,
  MaterialSelectionRepository,
  ShotPlanAuthorityRepository,
} from '../../packages/local-db/dist/index.js';
import { MaterialSelectionService } from '../../apps/desktop/dist-electron/main/material-selection-service.js';
import {
  registerDemoSlotNarration,
  commitDemoWorkerManifest,
  searchAndSelectDemoSlot,
} from '../../apps/desktop/dist-electron/main/demo-local-media.js';

// Developer CLI only: all runtime paths must already be activated/verified by the
// existing runtime trust chain. No production authority is granted by this config.
const root = fileURLToPath(new URL('../../', import.meta.url));
const [action, configPath, evidencePath] = process.argv.slice(2);
if (!['narration', 'ingest', 'select'].includes(action) || !configPath || !evidencePath) {
  throw new Error(
    'Usage: node tools/demo-media/run.mjs narration|ingest|select config.json evidence.json',
  );
}
const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
const { db } = await openDatabase({
  dbPath: resolve(config.db_path),
  migrationsDirectory: resolve(root, 'migrations/desktop-sqlite'),
});
try {
  const media = new MediaIndexRepository(db);
  let result;
  if (action === 'ingest') {
    result = { asset_id: await commitDemoWorkerManifest({ ...config, repository: media }) };
  } else {
    const confirmed = new ShotPlanAuthorityRepository(db).getConfirmedVersion(
      config.shot_plan_id,
      config.shot_plan_version,
    );
    if (!confirmed) throw new Error('DEMO_CONFIRMED_PLAN_REQUIRED');
    if (action === 'narration') {
      result = await registerDemoSlotNarration({
        plan: confirmed.plan,
        slot_audio: config.slot_audio,
        output_path: config.output_path,
        repository: new NarrationAudioRepository(db),
      });
    } else {
      if (config.runtime_activation_verified !== true)
        throw new Error('DEMO_RUNTIME_ACTIVATION_REQUIRED');
      result = await searchAndSelectDemoSlot({
        ...config,
        plan: confirmed.plan,
        media,
        selection: new MaterialSelectionService({
          repository: new MaterialSelectionRepository(db),
        }),
      });
    }
  }
  await writeFile(
    resolve(evidencePath),
    JSON.stringify(
      { mode: 'DEMO_UNRELEASED', action, real_provider_requests: 0, result },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(`DEMO_MEDIA_${action.toUpperCase()}:PASS`);
} finally {
  db.close();
}
