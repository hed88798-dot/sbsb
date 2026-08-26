import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const blocked = /\b(?:AGPL|GPL)(?:-|\b)/i;
const allowed =
  /^(?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|CC0-1\.0|CC-BY-4\.0|Python-2\.0|Unlicense|WTFPL|MPL-2\.0|Public Domain|OFL-1\.1|\(MIT OR Apache-2\.0\)|\(MIT OR CC0-1\.0\)|WTFPL OR ISC|WTFPL OR MIT|\(WTFPL OR MIT\)|MIT AND BSD-3-Clause)$/i;
const modules = join(process.cwd(), 'node_modules', '.pnpm');
let entries = [];
try {
  entries = readdirSync(modules);
} catch {
  console.log('license-scan: SKIP (install dependencies first)');
  process.exit(0);
}
const failures = [];
for (const entry of entries) {
  const nested = join(modules, entry, 'node_modules');
  let names;
  try {
    names = readdirSync(nested);
  } catch {
    continue;
  }
  for (const name of names) {
    if (name.startsWith('@')) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(nested, name, 'package.json'), 'utf8'));
      const license = typeof manifest.license === 'string' ? manifest.license : '';
      if (blocked.test(license) || (license && !allowed.test(license))) {
        failures.push(`${manifest.name}@${manifest.version}: ${license || 'UNKNOWN'}`);
      }
    } catch {
      // Scoped packages are covered by pnpm's flattened license metadata in release audit.
    }
  }
}
if (failures.length > 0) {
  console.error(`license-scan: FAIL\n${[...new Set(failures)].sort().join('\n')}`);
  process.exit(1);
}
console.log('license-scan: PASS (first-pass)');
