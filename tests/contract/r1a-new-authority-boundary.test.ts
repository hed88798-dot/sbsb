import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const operatorFiles = [
  'tools/r1a-acceptance/operator.mjs',
  'tools/r1a-acceptance/code-c-stage.mjs',
  'tools/r1a-acceptance/narration.mjs',
  'tools/r1a-acceptance/runtime-authority.mjs',
  'tools/r1a-acceptance/new-authority.mjs',
];

describe('R1A-N0 operator architecture boundary', () => {
  it('is orchestration-only and does not fabricate authority rows or execute Render', () => {
    const source = operatorFiles
      .map((path) => readFileSync(resolve(root, path), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/RenderExecutionService|executePreparedRender/u);
    expect(source).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+render_|\bDELETE\s+FROM\b/iu);
    expect(source).not.toMatch(/selectMaterial\s*\(/u);
    expect(source).not.toMatch(/Renderer|preload|ipcMain|Fastify|express|provider-adapters/iu);
    expect(source).not.toMatch(/child_process.*ffmpeg|spawn\([^\n]*ffmpeg/iu);
  });

  it('uses accepted service and repository composition boundaries', () => {
    const source = readFileSync(resolve(root, 'tools/r1a-acceptance/operator.mjs'), 'utf8');
    for (const required of [
      'openDatabase',
      'MediaIndexRepository',
      'MaterialSelectionService',
      'TimelineOrchestrationService',
      'NarrationAudioRepository',
      'RenderPreparationService',
      '.prepare(',
    ]) {
      expect(source).toContain(required);
    }
  });

  it('does not add migration 008 or a public application surface', () => {
    const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8');
    expect(packageJson).toContain('r1a:authority:new');
    expect(packageJson).not.toContain('r1a:authority:serve');
    expect(sourceFileNames()).not.toContain('008');
  });
});

function sourceFileNames(): string {
  return operatorFiles.join('\n');
}
