import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(path, 'utf8');

async function readSourceTree(root: string): Promise<string> {
  const sources: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) sources.push(await readSourceTree(path));
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) sources.push(await read(path));
  }
  return sources.join('\n');
}

describe('approved Runtime v2 desktop distribution boundary', () => {
  it('packages the controlled runtime outside ASAR at one fixed Windows location', async () => {
    const builder = await read('apps/desktop/electron-builder.yml');
    expect(builder).toContain('from: .runtime-stage/ffmpeg-render-v2');
    expect(builder).toContain('to: runtime/ffmpeg-render-v2');
    expect(builder).not.toContain('frozen-candidates');
  });

  it('keeps packaged resolution Main-owned, fixed, and fail closed', async () => {
    const locator = await read('apps/desktop/src/main/desktop-render-runtime-locator.ts');
    expect(locator).toContain("join('runtime', 'ffmpeg-render-v2')");
    expect(locator).toContain('resolveApprovedRuntimeV2Authority');
    expect(locator).toContain('PACKAGED_RENDER_RUNTIME_OVERRIDE_FORBIDDEN');
    expect(locator).not.toContain('process.env');
    expect(locator).not.toMatch(/\bPATH\b/u);
  });

  it('does not expose runtime selection or process execution to preload, Renderer, or IPC', async () => {
    const [preload, ipc, renderer] = await Promise.all([
      read('apps/desktop/src/preload/index.ts'),
      read('apps/desktop/src/main/ipc.ts'),
      readSourceTree('apps/desktop/src/renderer'),
    ]);
    for (const source of [preload, ipc, renderer]) {
      expect(source).not.toMatch(/ffmpeg|ffprobe|renderRuntime|runtime[_-]root/iu);
      expect(source).not.toContain('child_process');
    }
  });

  it('binds Windows CI to the exact private durable asset and real installer smoke', async () => {
    const workflow = await read('.github/workflows/windows-native-smoke.yml');
    expect(workflow).toContain('releases/387604810');
    expect(workflow).toContain('559437104');
    expect(workflow).toContain('a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01');
    expect(workflow).toContain('desktop-runtime-v2-installed-smoke.ps1');
    expect(workflow).toContain('desktop:runtime:v2:verify-three-stage');
  });
});
