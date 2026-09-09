import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function args(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 2) result[argv[i].slice(2)] = argv[i + 1];
  return result;
}
const options = args(process.argv);
if (!options.bundle || !options.platform || !options.output)
  throw new Error('bundle, platform and output are required');
const bundle = resolve(options.bundle);
const platform = options.platform;
const entries = readdirSync(bundle, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() || entry.isSymbolicLink())
  .map((entry) => entry.name);
const folded = new Map(files.map((name) => [name.toLowerCase(), name]));
const internal = new Map();
const external = new Set();
const unresolved = new Set();
const windowsOs =
  /^(?:api-ms-win-[^/]+|ext-ms-win-[^/]+|kernel32\.dll|kernelbase\.dll|user32\.dll|advapi32\.dll|ole32\.dll|oleaut32\.dll|shell32\.dll|ws2_32\.dll|bcrypt\.dll|ntdll\.dll|ucrtbase\.dll|msvcp140(?:_1|_2)?\.dll|vcruntime140(?:_1)?\.dll)$/iu;
const linuxOs =
  /^(?:linux-vdso\.so(?:\.1)?|ld-linux[^/]*\.so(?:\.[0-9]+)?|libc\.so(?:\.[0-9]+)?|libm\.so(?:\.[0-9]+)?|libdl\.so(?:\.[0-9]+)?|libpthread\.so(?:\.[0-9]+)?|librt\.so(?:\.[0-9]+)?|libgcc_s\.so(?:\.[0-9]+)?|libstdc\+\+\.so(?:\.[0-9]+)?)$/iu;

function importedNames(file) {
  const command = platform === 'linux' ? 'readelf' : 'objdump';
  const output = execFileSync(command, platform === 'linux' ? ['-d', file] : ['-p', file], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (platform === 'linux')
    return [...output.matchAll(/\(NEEDED\).*\[([^\]]+)\]/gu)].map((match) => match[1]);
  return [...output.matchAll(/DLL Name: ([^\r\n]+)/gu)].map((match) => match[1].trim());
}

for (const name of files) {
  const fullPath = join(bundle, name);
  if (
    name.endsWith('.so') ||
    /\.so\.[0-9]+$/u.test(name) ||
    /\.dll$/iu.test(name) ||
    name === 'ffprobe' ||
    name === 'ffprobe.exe'
  ) {
    for (const imported of importedNames(fullPath)) {
      const member = folded.get(imported.toLowerCase());
      if (member) {
        internal.set(imported, member);
      } else if ((platform === 'linux' ? linuxOs : windowsOs).test(imported)) {
        external.add(imported);
      } else {
        unresolved.add(`${name}->${imported}`);
      }
    }
  }
}
if (unresolved.size) throw new Error(`unresolved runtime imports: ${[...unresolved].join(', ')}`);
const output = {
  schema_version: '1',
  platform,
  bundle_root_semantics: 'FLAT_APP_LOCAL_BUNDLE_V1',
  source_hashes: Object.fromEntries(
    files.sort().map((name) => {
      const path = join(bundle, name);
      const bytes = lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path);
      return [name, sha256(bytes)];
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
