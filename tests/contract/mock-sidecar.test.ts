import { copyFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callMockSidecar } from '../../apps/desktop/src/main/sidecar-client.js';
import {
  isSupportedPythonVersion,
  readPythonVersion,
  resolveMockSidecarScript,
  resolvePythonExecutable,
} from '../helpers/python-runtime.js';

const pythonPath = resolvePythonExecutable();
const scriptPath = resolveMockSidecarScript();

describe('Mock Sidecar stdio NDJSON', () => {
  it.each(['hello', 'ping', 'echo', 'progress', 'cancel', 'error'] as const)(
    'supports %s',
    async (method) => {
      const events = await callMockSidecar({
        pythonPath,
        scriptPath,
        request: {
          type: 'request',
          protocol_version: '1.0',
          request_id: `sidecar_${method}`,
          method,
          payload: { value: 'synthetic' },
        },
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events.at(-1)?.request_id).toBe(`sidecar_${method}`);
    },
  );

  it('resolves a repository-owned fixture and a supported Python runtime', () => {
    expect(scriptPath).toBe(resolveMockSidecarScript());
    expect(isSupportedPythonVersion(readPythonVersion(pythonPath) ?? '')).toBe(true);
  });

  it('honors PYTHON_EXECUTABLE before PATH candidates', () => {
    expect(
      resolvePythonExecutable({
        environment: { ...process.env, PYTHON_EXECUTABLE: pythonPath },
      }),
    ).toBe(pythonPath);
  });

  it('rejects an explicitly configured unsupported runtime', () => {
    expect(() =>
      resolvePythonExecutable({
        environment: { ...process.env, PYTHON_EXECUTABLE: process.execPath },
      }),
    ).toThrow('PYTHON_RUNTIME_NOT_FOUND');
  });

  it('spawns Python and the repository fixture through paths containing spaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar portability '));
    try {
      const runtimeLink = join(root, 'python runtime with spaces');
      symlinkSync(
        dirname(pythonPath),
        runtimeLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const spacedPythonPath = join(runtimeLink, basename(pythonPath));
      const fixtureDirectory = join(root, 'mock sidecar fixture with spaces');
      mkdirSync(fixtureDirectory);
      const spacedScriptPath = join(fixtureDirectory, 'mock sidecar.py');
      copyFileSync(scriptPath, spacedScriptPath);

      const events = await callMockSidecar({
        pythonPath: spacedPythonPath,
        scriptPath: spacedScriptPath,
        request: {
          type: 'request',
          protocol_version: '1.0',
          request_id: 'sidecar_paths_with_spaces',
          method: 'echo',
          payload: { value: 'path safe' },
        },
      });

      expect(events.at(-1)?.payload).toEqual({ value: 'path safe' });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
