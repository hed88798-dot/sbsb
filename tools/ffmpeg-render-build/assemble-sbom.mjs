import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
for (const key of ['manifest', 'license', 'output', 'notice'])
  if (!options[key]) throw new Error(`missing --${key}`);
const manifestPath = resolve(options.manifest);
const licensePath = resolve(options.license);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const license = JSON.parse(readFileSync(licensePath, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const components = [
  {
    type: 'library',
    bom_ref: `ffmpeg-${manifest.provenance.upstream_release}`,
    name: 'FFmpeg',
    version: manifest.provenance.upstream_release,
    supplier: { name: 'FFmpeg project' },
    hashes: [{ alg: 'SHA-256', content: manifest.provenance.source_archive_sha256 }],
    licenses: [{ expression: license.software_license_expression }],
    properties: [
      { name: 'upstream.commit', value: manifest.provenance.upstream_commit },
      { name: 'render.build.profile.sha256', value: manifest.provenance.build_profile_sha256 },
      {
        name: 'code.g.capability.profile.hash',
        value: manifest.provenance.code_g_capability_profile_hash,
      },
      { name: 'runtime.identity.sha256', value: manifest.runtime_identity_sha256 },
    ],
  },
  {
    type: 'application',
    bom_ref: `${manifest.runtime_id}:ffmpeg`,
    name: 'ffmpeg render executable',
    version: manifest.provenance.upstream_release,
    hashes: [
      {
        alg: 'SHA-256',
        content: manifest.entrypoints.find((entry) => /ffmpeg(?:\.exe)?$/u.test(entry.path)).sha256,
      },
    ],
    licenses: [{ expression: license.software_license_expression }],
  },
  {
    type: 'application',
    bom_ref: `${manifest.runtime_id}:ffprobe`,
    name: 'ffprobe verification executable',
    version: manifest.provenance.upstream_release,
    hashes: [
      {
        alg: 'SHA-256',
        content: manifest.entrypoints.find((entry) => /ffprobe(?:\.exe)?$/u.test(entry.path))
          .sha256,
      },
    ],
    licenses: [{ expression: license.software_license_expression }],
  },
];
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${manifest.runtime_identity_sha256.slice(0, 8)}-${manifest.runtime_id}`,
  version: 1,
  metadata: {
    component: {
      type: 'application',
      name: manifest.runtime_id,
      version: manifest.provenance.upstream_release,
    },
    properties: [
      { name: 'manifest.sha256', value: manifest.manifest_sha256 },
      { name: 'runtime.identity.sha256', value: manifest.runtime_identity_sha256 },
      { name: 'retention.transport', value: 'TRANSIENT_ACTIONS_ARTIFACT_1_DAY' },
      { name: 'retention.final.logical_root', value: 'frozen-candidates/' },
    ],
  },
  components,
};
writeFileSync(resolve(options.output), `${JSON.stringify(bom, null, 2)}\n`);
const notice = `# FFmpeg Render Runtime Notices\n\n- Runtime: ${manifest.runtime_id}\n- Source: FFmpeg ${manifest.provenance.upstream_release} (${manifest.provenance.upstream_commit})\n- Source archive SHA-256: ${manifest.provenance.source_archive_sha256}\n- Render Build Profile SHA-256: ${manifest.provenance.build_profile_sha256}\n- Code G capability profile hash: ${manifest.provenance.code_g_capability_profile_hash}\n- Software license expression: ${license.software_license_expression}\n\nThe distributed runtime is built with GPL and nonfree components disabled and no libx264/libx265. LGPL source, build configuration, and relinkability obligations apply to the exact shared component set. H.264/AAC patent or codec-program obligations are separate from the source-code license and require independent commercial review.\n`;
writeFileSync(resolve(options.notice), notice);
console.log(
  JSON.stringify({
    sbom_sha256: sha256(readFileSync(resolve(options.output))),
    notice_sha256: sha256(Buffer.from(notice, 'utf8')),
    component_count: components.length,
  }),
);
