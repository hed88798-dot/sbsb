import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  resolveApprovedRuntimeV2Authority,
  type ApprovedRuntimeV2AuthorityResolution,
} from './render-runtime-authority-service.js';

export const PACKAGED_RENDER_RUNTIME_RELATIVE_ROOT = join('runtime', 'ffmpeg-render-v2');

export interface DesktopRenderRuntimeLocationInput {
  is_packaged: boolean;
  resources_path?: string;
  controlled_dev_runtime_root?: string;
}

export interface DesktopRenderRuntimePaths {
  runtime_root: string;
  runtime_manifest_path: string;
  approval_receipt_path: string;
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

export function resolveDesktopRenderRuntimePaths(
  input: DesktopRenderRuntimeLocationInput,
): DesktopRenderRuntimePaths {
  if (input.is_packaged) {
    if (input.controlled_dev_runtime_root !== undefined) {
      throw new Error('PACKAGED_RENDER_RUNTIME_OVERRIDE_FORBIDDEN');
    }
    if (!input.resources_path || !isAbsolute(input.resources_path)) {
      throw new Error('PACKAGED_RENDER_RUNTIME_RESOURCES_PATH_INVALID');
    }
    const resourcesRoot = resolve(input.resources_path);
    const runtimeRoot = resolve(resourcesRoot, PACKAGED_RENDER_RUNTIME_RELATIVE_ROOT);
    if (!isInsideOrEqual(resourcesRoot, runtimeRoot)) {
      throw new Error('PACKAGED_RENDER_RUNTIME_PATH_ESCAPE');
    }
    return {
      runtime_root: runtimeRoot,
      runtime_manifest_path: join(runtimeRoot, 'manifest.json'),
      approval_receipt_path: join(
        runtimeRoot,
        'approval',
        'FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
      ),
    };
  }

  if (!input.controlled_dev_runtime_root || !isAbsolute(input.controlled_dev_runtime_root)) {
    throw new Error('CONTROLLED_DEV_RENDER_RUNTIME_REQUIRED');
  }
  const runtimeRoot = resolve(input.controlled_dev_runtime_root);
  return {
    runtime_root: runtimeRoot,
    runtime_manifest_path: join(runtimeRoot, 'manifest.json'),
    approval_receipt_path: join(runtimeRoot, 'approval', 'FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json'),
  };
}

export async function resolveDesktopRenderRuntimeAuthority(
  input: DesktopRenderRuntimeLocationInput,
): Promise<ApprovedRuntimeV2AuthorityResolution> {
  const paths = resolveDesktopRenderRuntimePaths(input);
  const authority = await resolveApprovedRuntimeV2Authority(paths);
  if (input.is_packaged) {
    const resourcesRoot = await realpath(resolve(input.resources_path!));
    if (!(await lstat(resourcesRoot)).isDirectory()) {
      throw new Error('PACKAGED_RENDER_RUNTIME_RESOURCES_PATH_INVALID');
    }
    for (const path of [
      authority.runtime_root,
      authority.manifest_path,
      authority.approval_receipt_path,
      authority.identity.ffmpeg_executable_path,
      authority.ffprobe_path,
    ]) {
      const resolvedPath = await realpath(path);
      if (!isInsideOrEqual(resourcesRoot, resolvedPath)) {
        throw new Error('PACKAGED_RENDER_RUNTIME_PATH_ESCAPE');
      }
    }
  }
  return authority;
}
