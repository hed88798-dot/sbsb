import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative, sep } from 'node:path';
import {
  CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
} from '@app/render';
import { resolveDesktopRenderRuntimeAuthority } from './desktop-render-runtime-locator.js';
import { createRuntimeTreeEvidence } from './render-runtime-tree.js';

const executeFile = promisify(execFile);

function containedRelativePath(root: string, path: string): string {
  const child = relative(root, path);
  if (child === '' || child === '..' || child.startsWith(`..${sep}`)) {
    throw new Error('PACKAGED_RENDER_RUNTIME_PATH_ESCAPE');
  }
  return child.split(sep).join('/');
}

async function safeVersion(path: string): Promise<string> {
  const result = await executeFile(path, ['-version'], {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  const firstLine = result.stdout.split(/\r?\n/u)[0]?.trim();
  if (!firstLine) throw new Error('PACKAGED_RENDER_RUNTIME_VERSION_SMOKE_FAILED');
  return firstLine;
}

export async function runPackagedRenderRuntimeSmoke(resourcesPath: string) {
  const authority = await resolveDesktopRenderRuntimeAuthority({
    is_packaged: true,
    resources_path: resourcesPath,
  });
  const tree = await createRuntimeTreeEvidence({
    authority,
    runtime_root: authority.runtime_root,
    exact_member_set: true,
  });
  const ffmpegVersion = await safeVersion(authority.identity.ffmpeg_executable_path);
  const ffprobeVersion = await safeVersion(authority.ffprobe_path);
  return {
    schema_version: '1',
    record_kind: 'PACKAGED_FFMPEG_RENDER_RUNTIME_SMOKE',
    status: 'PASS',
    process_resources_path: resourcesPath,
    runtime_root_relative: containedRelativePath(resourcesPath, authority.runtime_root),
    ffmpeg_relative_path: containedRelativePath(
      resourcesPath,
      authority.identity.ffmpeg_executable_path,
    ),
    ffprobe_relative_path: containedRelativePath(resourcesPath, authority.ffprobe_path),
    runtime_id: authority.identity.runtime_id,
    runtime_tree_hash: tree.runtime_tree_hash,
    runtime_tree: tree,
    runtime_manifest_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
    runtime_identity_sha256: CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256,
    ffmpeg_sha256: CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256,
    ffprobe_sha256: CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256,
    approval_receipt_sha256: authority.approval_receipt_sha256,
    ffmpeg_version: ffmpegVersion,
    ffprobe_version: ffprobeVersion,
    packaged_path_containment: 'PASS',
    runtime_authority: 'PASS',
    path_fallback_used: false,
  } as const;
}
