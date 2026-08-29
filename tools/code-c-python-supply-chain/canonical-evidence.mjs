import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalJson } from '../python-supply-chain/inventory.mjs';

export const canonicalizationVersion = 'json-utf8-lf-v1';

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function writeCanonicalJson(path, value) {
  const target = resolve(path);
  const directory = dirname(target);
  mkdirSync(directory, { recursive: true });
  const canonicalBytes = canonicalJsonBytes(value);
  const payloadSha256 = sha256Bytes(canonicalBytes);
  const temporary = resolve(
    directory,
    `.${target.split(/[\\/]/u).at(-1)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor;
  let replaced = false;
  try {
    descriptor = openSync(temporary, 'wx', 0o644);
    writeFileSync(descriptor, canonicalBytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const temporaryBytes = readFileSync(temporary);
    if (!temporaryBytes.equals(canonicalBytes) || sha256Bytes(temporaryBytes) !== payloadSha256) {
      throw new Error(`canonical evidence byte drift before atomic replace: ${target}`);
    }
    renameSync(temporary, target);
    replaced = true;
    const fileBytes = readFileSync(target);
    const fileSha256 = sha256Bytes(fileBytes);
    if (!fileBytes.equals(canonicalBytes) || fileSha256 !== payloadSha256) {
      throw new Error(`canonical evidence byte drift after atomic replace: ${target}`);
    }
    return {
      canonical_payload_sha256: payloadSha256,
      canonical_file_sha256: fileSha256,
      canonical_payload_file_hash_equal: true,
      in_memory_file_byte_identity: true,
      temp_file_same_directory: dirname(temporary) === directory,
      atomic_replace: replaced,
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (!replaced) rmSync(temporary, { force: true });
  }
}
