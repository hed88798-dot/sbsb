import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { sidecarEventV1Schema, sidecarRequestV1Schema, } from '@app/contracts';
export async function callMockSidecar(options) {
    const request = sidecarRequestV1Schema.parse(options.request);
    const child = spawn(options.pythonPath, [options.scriptPath], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    const events = [];
    const terminalTypes = new Set(['hello', 'result', 'error', 'cancelled']);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('SIDECAR_TIMEOUT'));
        }, options.timeoutMs ?? 5_000);
        const finish = (callback) => {
            clearTimeout(timeout);
            child.kill();
            callback();
        };
        child.once('error', (error) => finish(() => reject(error)));
        const lines = createInterface({ input: child.stdout });
        lines.on('line', (line) => {
            try {
                const event = sidecarEventV1Schema.parse(JSON.parse(line));
                if (event.request_id !== request.request_id)
                    throw new Error('SIDECAR_REQUEST_ID_MISMATCH');
                events.push(event);
                if (terminalTypes.has(event.type))
                    finish(() => resolve(events));
            }
            catch (error) {
                finish(() => reject(error));
            }
        });
        child.stdin.end(`${JSON.stringify(request)}\n`);
    });
}
//# sourceMappingURL=sidecar-client.js.map