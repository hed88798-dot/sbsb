import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

const metadataPath = process.argv[2];
const artifactPath = process.argv[3];
if (!metadataPath || !artifactPath) {
  console.error('artifact-verify: FAIL\nusage: verify-artifact-metadata.mjs <metadata> <artifact>');
  process.exit(1);
}
const metadata = JSON.parse(readFileSync(resolve(metadataPath), 'utf8'));
const actual = await hashFile(resolve(artifactPath));
if (metadata.artifact?.sha256 !== actual) {
  console.error(
    `artifact-verify: FAIL\nexpected ${metadata.artifact?.sha256 ?? 'missing'}, got ${actual}`,
  );
  process.exit(1);
}
console.log(`artifact-verify: PASS (${actual})`);
