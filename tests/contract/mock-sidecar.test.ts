import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callMockSidecar } from '../../apps/desktop/src/main/sidecar-client.js';

const pythonPath =
  process.env.PYTHON_BIN ??
  (process.platform === 'win32'
    ? 'python'
    : '/Users/sungaoang/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const scriptPath = resolve(import.meta.dirname, '../fixtures/mock-sidecar/mock_sidecar.py');

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
});
