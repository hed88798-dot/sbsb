import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callSidecar } from '../../apps/desktop/src/main/sidecar-client.js';
import { buildSearchCache, encodeNormalizedVector } from '../../packages/domain-media-index/src/index.js';

const workerExecutable = process.env.CODE_C_WORKER_EXECUTABLE;
const modelRoot = process.env.CODE_C_REAL_MODEL_ROOT;
const evidencePath = process.env.CODE_C_SIDECAR_UTF8_E2E_REPORT;
const enabled = process.platform === 'win32' && Boolean(workerExecutable && modelRoot);
const root = resolve(import.meta.dirname, '../..');

describe.skipIf(!enabled)('packaged Windows Worker through the Desktop sidecar client', () => {
  it('sends literal Chinese over JSON/NDJSON and returns a real text-embedding result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'windows-sidecar-utf8-'));
    const cacheRoot = join(directory, 'search-cache');
    const signatureHash = createHash('sha256')
      .update('code-c-windows-desktop-sidecar-utf8-e2e-v1')
      .digest('hex');
    await buildSearchCache({
      cacheRoot,
      generationId: 'generation_windows_sidecar_utf8',
      signatureHash,
      dimension: 768,
      rows: [
        {
          shotId: 'shot_windows_sidecar_utf8',
          assetId: 'asset_windows_sidecar_utf8',
          revision: 1,
          startMs: 0,
          endMs: 1000,
          vectorF16: encodeNormalizedVector(new Array(768).fill(1)),
        },
      ],
    });
    try {
      const events = await callSidecar({
        executablePath: workerExecutable!,
        cwd: root,
        timeoutMs: 180_000,
        request: {
          type: 'request',
          protocol_version: '1.0',
          request_id: 'desktop_literal_猪场',
          method: 'media.search.exact.v1',
          payload: {
            cache_root: cacheRoot,
            signature_hash: signatureHash,
            model_root: modelRoot!,
            dimension: 768,
            query_text: '猪场',
            top_k: 1,
          },
        },
      });
      const result = events.find((event) => event.type === 'result');
      const candidates = result?.payload?.candidates;
      const candidateList = Array.isArray(candidates) ? candidates : [];
      expect(candidateList).toHaveLength(1);
      const score = (candidateList as Array<{ semantic_score?: unknown }>)[0]?.semantic_score;
      expect(typeof score).toBe('number');
      expect(Number.isFinite(score)).toBe(true);
      expect(events.every((event) => event.protocol_version === '1.0')).toBe(true);
      if (evidencePath) {
        const report = {
          report_kind: 'CODE_C_WINDOWS_DESKTOP_SIDECAR_UTF8_E2E',
          schema_version: '1',
          status: 'PASS',
          protocol_version: '1.0',
          query_text: '猪场',
          worker_sha256: createHash('sha256').update(await readFile(workerExecutable!)).digest('hex'),
          candidate_count: candidateList.length,
          semantic_score_finite: true,
        };
        await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 240_000);
});
