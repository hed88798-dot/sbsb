import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNEL_ALLOWLIST } from '../../packages/contracts/src/index.js';

const root = resolve(import.meta.dirname, '../..');
const mainSource = readFileSync(join(root, 'apps/desktop/src/main/index.ts'), 'utf8');
const preloadSource = readFileSync(join(root, 'apps/desktop/src/preload/index.ts'), 'utf8');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/u.test(entry.name)
        ? [path]
        : [];
  });
}

describe('Electron renderer isolation', () => {
  it('keeps sandbox, context isolation and Node integration settings locked', () => {
    expect(mainSource).toMatch(/sandbox:\s*true/u);
    expect(mainSource).toMatch(/contextIsolation:\s*true/u);
    expect(mainSource).toMatch(/nodeIntegration:\s*false/u);
    expect(mainSource).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(mainSource).toContain("on('will-navigate'");
  });

  it('exposes a named use-case API instead of ipcRenderer, fs, sql or exec', () => {
    expect(preloadSource).toContain("exposeInMainWorld('desktop'");
    expect(preloadSource).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/u);
    expect(preloadSource).not.toMatch(/exposeInMainWorld\([^)]*(?:fs|sql|exec)/u);
    expect(preloadSource).not.toContain('ipcRenderer.send');
  });

  it('keeps renderer imports free of Node, SQLite and generic IPC', () => {
    const rendererDirectory = join(root, 'apps/desktop/src/renderer');
    for (const file of sourceFiles(rendererDirectory)) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(
        /from ['"](?:node:|fs['"]|child_process|better-sqlite3|@app\/local-db)/u,
      );
      expect(source, file).not.toContain('ipcRenderer');
    }
  });

  it('maintains a unique explicit IPC allowlist', () => {
    expect(IPC_CHANNEL_ALLOWLIST.length).toBeGreaterThan(0);
    expect(new Set(IPC_CHANNEL_ALLOWLIST).size).toBe(IPC_CHANNEL_ALLOWLIST.length);
    expect(IPC_CHANNEL_ALLOWLIST.every((channel) => /^[a-z-]+:[a-z-]+$/u.test(channel))).toBe(true);
  });
});
