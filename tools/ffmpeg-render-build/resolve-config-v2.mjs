import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const profilePath = resolve(
  root,
  'compliance/runtime-dependency-intake/ffmpeg-render-v2/FFMPEG_RENDER_BUILD_PROFILE_V2.json',
);
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const platform = process.argv[2];
if (!platform || !profile.platform_builds[platform])
  throw new Error(`unknown platform: ${platform}`);
const values = [
  ...profile.common_configure_arguments,
  ...profile.platform_builds[platform].configure_arguments,
];
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(values));
else process.stdout.write(`${values.join('\n')}\n`);
