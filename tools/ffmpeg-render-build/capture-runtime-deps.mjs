import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function args(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument: ${key}`);
    result[key.slice(2)] = value;
  }
  return result;
}
const options = args(process.argv);
if (!options.bundle || !options.platform || !options.output)
  throw new Error('bundle, platform and output are required');
if (options.platform !== 'windows')
  throw new Error('render runtime dependency capture currently supports windows only');
const bundle = resolve(options.bundle);
const files = readdirSync(bundle, { withFileTypes: true })
  .filter((entry) => entry.isFile() || entry.isSymbolicLink())
  .map((entry) => entry.name)
  .sort();
const folded = new Map(files.map((name) => [name.toLowerCase(), name]));
const internal = new Map();
const external = new Set();
const unresolved = new Set();
const windowsOs =
  /^(?:api-ms-win-[^/]+|ext-ms-win-[^/]+|kernel32\.dll|kernelbase\.dll|user32\.dll|advapi32\.dll|ole32\.dll|oleaut32\.dll|shell32\.dll|shlwapi\.dll|ws2_32\.dll|bcrypt\.dll|ntdll\.dll|ucrtbase\.dll|msvcrt\.dll|vcruntime140(?:_1)?\.dll|msvcp140(?:_1|_2)?\.dll|concrt140\.dll|version\.dll|winmm\.dll|comdlg32\.dll|gdi32\.dll|secur32\.dll|imm32\.dll|psapi\.dll|iphlpapi\.dll|userenv\.dll|dwmapi\.dll|avrt\.dll|mf\.dll|mfplat\.dll|mfreadwrite\.dll|mfuuid\.dll|strmiids\.dll|propsys\.dll)$/iu;

function importedNames(file) {
  const output = execFileSync('objdump', ['-p', file], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return [...output.matchAll(/DLL Name: ([^\r\n]+)/gu)].map((match) => match[1].trim());
}

for (const name of files) {
  if (!/\.dll$/iu.test(name) && !/\.exe$/iu.test(name)) continue;
  for (const imported of importedNames(join(bundle, name))) {
    const member = folded.get(imported.toLowerCase());
    if (member) internal.set(imported, member);
    else if (windowsOs.test(imported)) external.add(imported);
    else unresolved.add(`${name}->${imported}`);
  }
}
if (unresolved.size)
  throw new Error(`unresolved runtime imports: ${[...unresolved].sort().join(', ')}`);
const output = {
  schema_version: '1',
  platform: 'windows',
  bundle_root_semantics: 'FLAT_APP_LOCAL_BUNDLE_V1',
  source_hashes: Object.fromEntries(
    files.map((name) => {
      const path = join(bundle, name);
      return [name, createHash('sha256').update(readFileSync(path)).digest('hex')];
    }),
  ),
  internal: [...internal.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, member_path]) => ({ name, member_path })),
  external_os_imports: [...external].sort(),
  unresolved: [],
};
writeFileSync(resolve(options.output), `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify({
    internal: output.internal.length,
    external: output.external_os_imports.length,
    unresolved: 0,
  }),
);
