import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertRuntimeTreesEqual,
  createRuntimeTreeEvidence,
} from '../../apps/desktop/src/main/render-runtime-tree.js';
import { createRuntimeV2AuthorityFixture } from '../helpers/runtime-v2-authority-fixture.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function completeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-v2-tree-'));
  cleanup.push(root);
  const context = await createRuntimeV2AuthorityFixture(root);
  await writeFile(join(context.runtimeRoot, 'SBOM.cdx.json'), '{}\n');
  await writeFile(join(context.runtimeRoot, 'THIRD_PARTY_NOTICES.md'), 'notices\n');
  await mkdir(join(context.runtimeRoot, 'approval'));
  const nestedReceipt = join(
    context.runtimeRoot,
    'approval',
    'FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
  );
  await copyFile(context.approvalReceiptPath, nestedReceipt);
  const authority = await context.resolveRuntimeAuthority({
    ...context.input,
    approval_receipt_path: nestedReceipt,
  });
  return { ...context, authority };
}

describe('Runtime v2 distribution tree evidence', () => {
  it('creates a deterministic exact member identity', async () => {
    const context = await completeFixture();
    const first = await createRuntimeTreeEvidence({
      authority: context.authority,
      runtime_root: context.runtimeRoot,
      exact_member_set: true,
    });
    const second = await createRuntimeTreeEvidence({
      authority: context.authority,
      runtime_root: context.runtimeRoot,
      exact_member_set: true,
    });
    expect(first.runtime_tree_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.members.map((member) => member.relative_path)).toEqual([
      'approval/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
      'bundle/avcodec-63.dll',
      'bundle/ffmpeg.exe',
      'bundle/ffprobe.exe',
      'manifest.json',
      'SBOM.cdx.json',
      'THIRD_PARTY_NOTICES.md',
    ]);
    expect(() => assertRuntimeTreesEqual(first, second)).not.toThrow();
  });

  it('rejects an unexpected staged or installed member', async () => {
    const context = await completeFixture();
    await writeFile(join(context.runtimeRoot, 'unexpected.dll'), 'unexpected');
    await expect(
      createRuntimeTreeEvidence({
        authority: context.authority,
        runtime_root: context.runtimeRoot,
        exact_member_set: true,
      }),
    ).rejects.toThrowError('RUNTIME_TREE_MEMBER_SET_INVALID');
  });
});
