import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON_312_PATTERN = /^Python 3\.12\.\d+$/;

function executableExtensions(platform: NodeJS.Platform, pathExt?: string): string[] {
  if (platform !== 'win32') return [''];
  return (pathExt ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
}

function canExecute(path: string, platform: NodeJS.Platform): boolean {
  try {
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFromPath(
  candidate: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  if (isAbsolute(candidate)) return canExecute(candidate, platform) ? candidate : undefined;

  const extensions = executableExtensions(platform, environment.PATHEXT);
  const hasExtension = extname(candidate) !== '';
  for (const directory of (environment.PATH ?? '').split(delimiter).filter(Boolean)) {
    const possibleNames =
      platform === 'win32' && !hasExtension
        ? extensions.map((extension) => `${candidate}${extension}`)
        : [candidate];
    for (const name of possibleNames) {
      const resolved = join(directory, name);
      if (canExecute(resolved, platform)) return resolved;
    }
  }
  return undefined;
}

export function readPythonVersion(executable: string): string | undefined {
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) return undefined;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

export function isSupportedPythonVersion(version: string): boolean {
  return PYTHON_312_PATTERN.test(version.trim());
}

export function resolvePythonExecutable(options?: {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): string {
  const environment = options?.environment ?? process.env;
  const platform = options?.platform ?? process.platform;
  const configured = environment.PYTHON_EXECUTABLE?.trim();
  const candidates = configured
    ? [configured]
    : platform === 'win32'
      ? ['python', 'python3']
      : ['python3', 'python'];

  for (const candidate of candidates) {
    const executable = resolveFromPath(candidate, environment, platform);
    if (!executable) continue;
    const version = readPythonVersion(executable);
    if (version && isSupportedPythonVersion(version)) return executable;
  }

  throw new Error('PYTHON_RUNTIME_NOT_FOUND: Python 3.12.x is required');
}

export function resolveMockSidecarScript(): string {
  return fileURLToPath(new URL('../fixtures/mock-sidecar/mock_sidecar.py', import.meta.url));
}
