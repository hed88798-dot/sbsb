import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKAGED_RENDER_RUNTIME_RELATIVE_ROOT,
  resolveDesktopRenderRuntimePaths,
} from '../../apps/desktop/src/main/desktop-render-runtime-locator.js';

describe('desktop Runtime v2 location authority', () => {
  it('derives one fixed packaged location below process.resourcesPath', () => {
    const resourcesPath = resolve('controlled-packaged-resources');
    const paths = resolveDesktopRenderRuntimePaths({
      is_packaged: true,
      resources_path: resourcesPath,
    });
    const runtimeRoot = join(resourcesPath, PACKAGED_RENDER_RUNTIME_RELATIVE_ROOT);
    expect(paths).toEqual({
      runtime_root: runtimeRoot,
      runtime_manifest_path: join(runtimeRoot, 'manifest.json'),
      approval_receipt_path: join(
        runtimeRoot,
        'approval',
        'FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
      ),
    });
  });

  it('requires an explicit absolute development/test runtime root', () => {
    const runtimeRoot = resolve('controlled-dev-runtime');
    expect(
      resolveDesktopRenderRuntimePaths({
        is_packaged: false,
        controlled_dev_runtime_root: runtimeRoot,
      }).runtime_root,
    ).toBe(runtimeRoot);
    expect(() => resolveDesktopRenderRuntimePaths({ is_packaged: false })).toThrowError(
      'CONTROLLED_DEV_RENDER_RUNTIME_REQUIRED',
    );
  });

  it('rejects any packaged-mode override even when it is absolute', () => {
    expect(() =>
      resolveDesktopRenderRuntimePaths({
        is_packaged: true,
        resources_path: resolve('controlled-packaged-resources'),
        controlled_dev_runtime_root: resolve('attacker-selected-runtime'),
      }),
    ).toThrowError('PACKAGED_RENDER_RUNTIME_OVERRIDE_FORBIDDEN');
  });

  it('rejects missing and relative packaged resources roots', () => {
    expect(() => resolveDesktopRenderRuntimePaths({ is_packaged: true })).toThrowError(
      'PACKAGED_RENDER_RUNTIME_RESOURCES_PATH_INVALID',
    );
    expect(() =>
      resolveDesktopRenderRuntimePaths({ is_packaged: true, resources_path: 'relative' }),
    ).toThrowError('PACKAGED_RENDER_RUNTIME_RESOURCES_PATH_INVALID');
  });
});
