import { spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join } from 'node:path';
import { accessSync, constants } from 'node:fs';

function executable(candidate) {
  if (isAbsolute(candidate)) return candidate;
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const path = join(directory, `${candidate}${extension}`);
      try {
        accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return path;
      } catch {
        // Continue through configured PATH candidates.
      }
    }
  }
  return undefined;
}

const candidates = process.env.PYTHON_EXECUTABLE
  ? [process.env.PYTHON_EXECUTABLE]
  : process.platform === 'win32'
    ? ['python', 'python3']
    : ['python3', 'python'];
let python;
for (const candidate of candidates) {
  const path = executable(candidate);
  if (!path) continue;
  const version = spawnSync(path, ['--version'], { encoding: 'utf8', shell: false });
  if (/^Python 3\.13\.15$/u.test(`${version.stdout}${version.stderr}`.trim())) {
    python = path;
    break;
  }
}
if (!python) throw new Error('PYTHON_RUNTIME_NOT_FOUND: Python 3.13.15 is required');

const workerRoot = join(process.cwd(), 'sidecars', 'media-worker');
const environment = {
  ...process.env,
  PYTHONPATH: [join(workerRoot, 'src'), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
};
const result = spawnSync(
  python,
  ['-m', 'unittest', 'discover', '-s', join(workerRoot, 'tests'), '-p', 'test_*.py', '-v'],
  { cwd: process.cwd(), env: environment, shell: false, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
