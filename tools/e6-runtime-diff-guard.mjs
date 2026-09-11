import { execFileSync } from 'node:child_process';

const E5_FROZEN_BASELINE = 'd227ee2c586ceedc726e6764c52ac749ac87d50b';
const allowedPathPatterns = [
  /^tests\//u,
  /^tools\/e6-runtime-diff-guard\.mjs$/u,
  /^CODE_E_E6_COMPLETION_REPORT\.md$/u,
  // Code F's FFmpeg intake is an independent supply-chain validation surface;
  // it does not alter the frozen E6 runtime or timeline semantics.
  /^\.gitattributes$/u,
  /^\.github\/workflows\/code-f-ffmpeg-render-runtime\.yml$/u,
  /^CODE_F_FFMPEG_RENDER_RUNTIME_INTAKE_REPORT\.md$/u,
  /^compliance\/runtime-dependency-intake\/ffmpeg-render-v1\/(?:FFMPEG_RENDER_BUILD_PROFILE_V1\.json|FFMPEG_RENDER_BUILD_PROFILE_V1\.sha256)$/u,
  /^compliance\/runtime-dependency-intake\/ffmpeg-render-v1\/FFMPEG_RENDER_RUNTIME_APPROVAL_V1\.(?:json|sha256)$/u,
  /^docs\/render\/(?:FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1\.md|ffmpeg-required-capability-profile\.v1\.json)$/u,
  /^package\.json$/u,
  /^tools\/ffmpeg-render-build-profile\/verify\.mjs$/u,
  /^tools\/ffmpeg-render-build\/(?:assemble-license-evidence|assemble-manifest|assemble-sbom|assemble-vulnerability-review|build-windows|capture-runtime-deps|create-fixtures|create-records|create-transfer-manifest|preflight-windows|resolve-config|verify-capabilities|verify-manifest)\.(?:mjs|sh)$/u,
];

function gitLines(args) {
  const output = execFileSync('git', args, { encoding: 'utf8' }).trim();
  return output.length === 0 ? [] : output.split(/\r?\n/u);
}

const changedPaths = new Set([
  ...gitLines(['diff', '--name-only', E5_FROZEN_BASELINE, '--']),
  ...gitLines(['diff', '--cached', '--name-only', E5_FROZEN_BASELINE, '--']),
  ...gitLines(['ls-files', '--others', '--exclude-standard']),
]);
const forbiddenPaths = [...changedPaths]
  .filter((path) => !allowedPathPatterns.some((pattern) => pattern.test(path)))
  .sort();

if (forbiddenPaths.length > 0) {
  throw new Error(`E6_RUNTIME_DIFF_GUARD_FAILED:\n${forbiddenPaths.join('\n')}`);
}

process.stdout.write(`E6_RUNTIME_DIFF_GUARD: PASS (${changedPaths.size} validation-only paths)\n`);
