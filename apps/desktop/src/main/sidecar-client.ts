import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  sidecarEventV1Schema,
  sidecarRequestV1Schema,
  type SidecarEventV1,
  type SidecarRequestV1,
} from '@app/contracts';

export async function callSidecar(options: {
  executablePath: string;
  args?: string[];
  cwd?: string;
  request: SidecarRequestV1;
  timeoutMs?: number;
  onEvent?: (event: SidecarEventV1) => void;
}): Promise<SidecarEventV1[]> {
  const request = sidecarRequestV1Schema.parse(options.request);
  const child = spawn(options.executablePath, options.args ?? [], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
  const events: SidecarEventV1[] = [];
  const terminalTypes = new Set(['hello', 'result', 'error', 'cancelled']);
  return new Promise((resolve, reject) => {
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.unref();
        return;
      }
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    };
    const timeout = setTimeout(() => {
      terminate();
      reject(new Error('SIDECAR_TIMEOUT'));
    }, options.timeoutMs ?? 5_000);
    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      terminate();
      callback();
    };
    child.once('error', (error) => finish(() => reject(error)));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        if (Buffer.byteLength(line, 'utf8') > 1024 * 1024)
          throw new Error('SIDECAR_EVENT_TOO_LARGE');
        const event = sidecarEventV1Schema.parse(JSON.parse(line) as unknown);
        if (event.request_id !== request.request_id) throw new Error('SIDECAR_REQUEST_ID_MISMATCH');
        events.push(event);
        options.onEvent?.(event);
        if (terminalTypes.has(event.type)) finish(() => resolve(events));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export async function callMockSidecar(options: {
  pythonPath: string;
  scriptPath: string;
  request: SidecarRequestV1;
  timeoutMs?: number;
}): Promise<SidecarEventV1[]> {
  return callSidecar({
    executablePath: options.pythonPath,
    args: [options.scriptPath],
    request: options.request,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
