import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function sha256(path: string): string {
  return createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');
}

describe('Code G R1B architecture and frozen-authority boundaries', () => {
  it('keeps the pure Render package free of filesystem, SQLite, Electron, and child_process', () => {
    for (const name of readdirSync(join(root, 'packages/render/src')).filter((value) =>
      value.endsWith('.ts'),
    )) {
      const value = source(`packages/render/src/${name}`);
      expect(value, name).not.toMatch(
        /from ['"](?:node:)?(?:fs|child_process)(?:\/[^'"]*)?['"]|better-sqlite3|from ['"]electron['"]/u,
      );
    }
  });

  it('exposes a job-only execution method and no Renderer IPC execution surface', () => {
    const service = source('apps/desktop/src/main/render-execution-service.ts');
    const preload = source('apps/desktop/src/preload/index.ts');
    const renderer = readdirSync(join(root, 'apps/desktop/src/renderer'), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
      .join('\n');
    expect(service).toContain('executePreparedRender(jobId: string)');
    expect(service).not.toMatch(/executePreparedRender\([^)]*(?:source|output|ffmpeg|argument)/u);
    expect(preload).not.toMatch(/ffmpeg|ffprobe|raw.*arg|executable.*path/iu);
    expect(renderer).not.toMatch(/child_process|ffmpeg|ffprobe|render-execution-service/iu);
  });

  it('keeps migration 005, Code F approval, and the frozen Code G profile bytes unchanged', () => {
    expect(sha256('migrations/desktop-sqlite/005_render_foundation_v1.sql')).toBe(
      '3ab51bf054cd112f73994de5670dc347e2751dff1ed7f8313f8b041c55aefd8b',
    );
    expect(
      sha256(
        'compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_RUNTIME_APPROVAL_V1.json',
      ),
    ).toBe('bcfad4490263904b9f8c71b19b66f5c0d6a033d4ab6bdb8896372072501ea714');
    const profile = JSON.parse(
      source('docs/render/ffmpeg-required-capability-profile.v1.json'),
    ) as { profile_hash: string };
    expect(profile.profile_hash).toBe(
      'e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910',
    );
  });

  it('keeps the Windows smoke on the historical service path without C/D/E recomputation', () => {
    const harness = source('tools/render-r1b/windows-desktop-product-smoke.mjs');
    expect(harness).toContain("authority_mode !== 'HISTORICAL_ACCEPTED_CHAIN'");
    expect(harness).toContain('service.executePreparedRender(config.job_id)');
    expect(harness).toContain("process.platform !== 'win32'");
    expect(harness).not.toMatch(
      /RenderPreparationService|MaterialSelectionRepository|MediaIndexRepository|TimelinePlanRepository|planAndCommit|retrieve|select\(/u,
    );
  });
});
