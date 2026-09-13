import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const path = resolve(
  root,
  'tools/ffmpeg-render-pixel-oracle/CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V1.json',
);
const profile = JSON.parse(readFileSync(path, 'utf8'));
const mode = process.argv[2];
if (mode === '--json') {
  process.stdout.write(`${JSON.stringify(profile.configure_arguments)}\n`);
} else if (mode === '--source-json') {
  process.stdout.write(`${JSON.stringify(profile.upstream_source)}\n`);
} else {
  process.stdout.write(`${profile.configure_arguments.join('\n')}\n`);
}
