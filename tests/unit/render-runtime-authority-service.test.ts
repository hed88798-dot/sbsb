import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2 } from '../../packages/render/src/index.js';
import { createRuntimeV2AuthorityFixture } from '../helpers/runtime-v2-authority-fixture.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-v2-authority-'));
  cleanup.push(root);
  return createRuntimeV2AuthorityFixture(root);
}

describe('approved Runtime v2 authority resolution', () => {
  it('derives RenderRuntimeIdentityV1 from manifest, receipt, and exact members', async () => {
    const context = await fixture();
    const resolution = await context.resolveRuntimeAuthority(context.input);
    expect(resolution.identity.ffmpeg_executable_path).toBe(await realpath(context.ffmpegPath));
    expect(resolution.identity.ffprobe_executable_path).toBe(await realpath(context.ffprobePath));
    expect(resolution.identity.runtime_member_hashes.map((member) => member.relative_path)).toEqual(
      ['avcodec-63.dll', 'ffmpeg.exe', 'ffprobe.exe'],
    );
    expect(await readdir(context.runtimeRoot)).toEqual(['bundle', 'manifest.json']);
  });

  it('rejects a missing manifest', async () => {
    const context = await fixture();
    await rm(context.manifestPath);
    await expect(context.resolveRuntimeAuthority(context.input)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });

  it('rejects a modified manifest', async () => {
    const context = await fixture();
    await writeFile(context.manifestPath, JSON.stringify({ ...context.manifest, extra: true }));
    await expect(context.resolveRuntimeAuthority(context.input)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });

  it('rejects the wrong approval receipt', async () => {
    const context = await fixture();
    await writeFile(context.approvalReceiptPath, '{}');
    await expect(context.resolveRuntimeAuthority(context.input)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });

  it('rejects modified FFmpeg bytes', async () => {
    const context = await fixture();
    await writeFile(context.ffmpegPath, 'modified-ffmpeg');
    await expect(context.resolveRuntimeAuthority(context.input)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });

  it('rejects modified FFprobe bytes', async () => {
    const context = await fixture();
    await writeFile(context.ffprobePath, 'modified-ffprobe');
    await expect(context.resolveRuntimeAuthority(context.input)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });

  it('rejects mutation of any declared runtime member', async () => {
    const context = await fixture();
    await writeFile(context.companionPath, 'modified-companion');
    await expect(context.resolveRuntimeAuthority(context.input)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });

  it('rejects a manifest bound to the wrong capability profile', async () => {
    const context = await fixture();
    await writeFile(
      context.manifestPath,
      JSON.stringify({
        ...context.manifest,
        provenance: {
          ...context.manifest.provenance,
          code_g_capability_profile_hash: `${FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash.slice(0, -1)}0`,
        },
      }),
    );
    await expect(context.resolveRuntimeAuthority(context.input)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });
});
