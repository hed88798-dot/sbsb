import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assetRevisionManifestV1Schema,
  type AssetRevisionManifestV1,
} from '../../packages/contracts/src/index.js';
import {
  buildSearchCache,
  createIndexGenerationSignature,
  hydrateSearchCandidates,
} from '../../packages/domain-media-index/src/index.js';
import { MediaIndexRepository, openDatabase } from '../../packages/local-db/src/index.js';

const workerPython = process.env.CODE_C_WORKER_PYTHON;
const workerExecutable = process.env.CODE_C_WORKER_EXECUTABLE;
const modelRoot = process.env.CODE_C_REAL_MODEL_ROOT;
const ffprobePath = process.env.CODE_C_FFPROBE;
const evidencePath = process.env.CODE_C_E2E_REPORT;
const enabled = Boolean(
  workerPython && (workerPython || workerExecutable) && modelRoot && ffprobePath,
);
const root = resolve(import.meta.dirname, '../..');

interface WorkerEvent {
  type: string;
  payload?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

async function runPython(argumentsValue: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(workerPython!, argumentsValue, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`Python command failed (${code}): ${stderr.slice(-4000)}`));
    });
  });
}

async function callWorker(
  method: string,
  payload: Record<string, unknown>,
  networkEnvironment: NodeJS.ProcessEnv = {},
): Promise<WorkerEvent[]> {
  return await new Promise((resolvePromise, reject) => {
    const executable = workerExecutable ?? workerPython!;
    const argumentsValue = workerExecutable ? [] : ['-m', 'media_worker'];
    const child = spawn(executable, argumentsValue, {
      cwd: root,
      env: {
        ...process.env,
        ...networkEnvironment,
        PYTHONPATH: resolve(root, 'sidecars/media-worker/src'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker failed (${code}): ${stderr.slice(-4000)}`));
        return;
      }
      const events = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as WorkerEvent);
      const error = events.find((event) => event.type === 'error');
      if (error) {
        reject(new Error(`Worker ${error.error?.code}: ${error.error?.message}`));
        return;
      }
      resolvePromise(events);
    });
    child.stdin.end(
      `${JSON.stringify({
        type: 'request',
        protocol_version: '1.0',
        request_id: `real_onnx_${method}`,
        method,
        payload,
      })}\n`,
    );
  });
}

describe.skipIf(!enabled)('real SigLIP ONNX Video → Index → SQLite → Cache → Search', () => {
  it(
    'returns a hydrated exact Shot result from production image/text ONNX outputs',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'code-c-real-onnx-'));
      const videoPath = join(directory, '授权合成 fixture.avi');
      const outputDirectory = join(directory, 'job-output');
      const cacheRoot = join(directory, 'search-cache');
      const dbPath = join(directory, 'app.db');
      let outboundNetworkAttempts = 0;
      const observer = createServer((socket) => {
        outboundNetworkAttempts += 1;
        socket.end('HTTP/1.1 502 Stage B Egress Denied\r\nContent-Length: 0\r\n\r\n');
      });
      await new Promise<void>((resolvePromise, reject) => {
        observer.once('error', reject);
        observer.listen(0, '127.0.0.1', () => resolvePromise());
      });
      const address = observer.address();
      if (!address || typeof address === 'string') throw new Error('Stage B proxy observer failed');
      const proxy = `http://127.0.0.1:${address.port}`;
      const networkEnvironment = {
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        ALL_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        all_proxy: proxy,
        NO_PROXY: '',
        no_proxy: '',
      };
      try {
        await runPython([
          resolve(root, 'tests/performance/generate_real_onnx_fixture.py'),
          videoPath,
        ]);
        await mkdir(outputDirectory, { recursive: true });
        const detector = JSON.parse(
          await readFile(
            resolve(root, 'sidecars/media-worker/config/shot-detector-v1.json'),
            'utf8',
          ),
        ) as { parameters: Record<string, unknown> };
        const indexPayload = {
          input_path: videoPath,
          output_dir: outputDirectory,
          asset_id: 'asset_real_siglip_fixture',
          revision: 1,
          ffprobe_path: ffprobePath,
          shot_detector_parameters: detector.parameters,
          embedding_model_version: 'onnx-fp32-9e7ee6850617',
          embedding_preprocess_version: 'siglip2-processor-256-bicubic-mean0.5-official-text-v2',
          model_root: modelRoot,
          dimension: 768,
        };
        const indexEvents = await callWorker(
          'media.index.asset.v1',
          indexPayload,
          networkEnvironment,
        );
        const indexResult = indexEvents.find((event) => event.type === 'result')?.payload;
        expect(indexResult).toBeDefined();
        const manifestPath = String(indexResult?.manifest_path);
        const manifest = assetRevisionManifestV1Schema.parse(
          JSON.parse(await readFile(manifestPath, 'utf8')),
        ) as AssetRevisionManifestV1;
        expect(manifest.shots.length).toBeGreaterThanOrEqual(2);
        const secondScanEvents = await callWorker(
          'media.index.asset.v1',
          indexPayload,
          networkEnvironment,
        );
        const secondScanStages = secondScanEvents
          .filter((event) => event.type === 'progress')
          .map((event) => event.payload?.stage);
        expect(secondScanStages).toContain('RESUME');
        expect(secondScanStages).not.toContain('EMBEDDING');

        const opened = await openDatabase({
          dbPath,
          migrationsDirectory: resolve(root, 'migrations/desktop-sqlite'),
        });
        try {
          const repository = new MediaIndexRepository(opened.db);
          repository.commitAssetRevision({
            manifest,
            manifestSha256: String(indexResult?.manifest_sha256),
          });
          const truth = repository.listActiveEmbeddingTruth(manifest.generation_key_hash);
          expect(truth).toHaveLength(manifest.shots.length);
          expect(truth.every((row) => row.dimension === 768)).toBe(true);
          const generationSignature = createIndexGenerationSignature({
            generationKeyHash: manifest.generation_key_hash,
            assets: [
              {
                assetId: manifest.asset_id,
                revision: manifest.revision,
                fileHash: manifest.file_hash,
                indexSignatureHash: manifest.index_signature_hash,
              },
            ],
          });
          const generationId = 'generation_real_siglip_e2e';
          await buildSearchCache({
            cacheRoot,
            generationId,
            signatureHash: generationSignature,
            dimension: 768,
            rows: truth,
          });
          const cacheManifestPath = join(cacheRoot, generationId, 'manifest.json');
          const cacheManifestSha256 = createHash('sha256')
            .update(await readFile(cacheManifestPath))
            .digest('hex');
          repository.publishIndexGeneration({
            generationId,
            indexSignatureHash: generationSignature,
            cacheManifestSha256,
            assets: [{ assetId: manifest.asset_id, revision: manifest.revision }],
          });
          const searchEvents = await callWorker(
            'media.search.exact.v1',
            {
              cache_root: cacheRoot,
              signature_hash: generationSignature,
              model_root: modelRoot,
              dimension: 768,
              query_text: 'veterinary medicine bottle for livestock',
              top_k: 2,
            },
            networkEnvironment,
          );
          const rawCandidates = (searchEvents.find((event) => event.type === 'result')?.payload
            ?.candidates ?? []) as Array<{
            asset_id: string;
            shot_id: string;
            revision: number;
            start_ms: number;
            end_ms: number;
            semantic_score: number;
          }>;
          const descriptors = repository.listSearchableShots(manifest.generation_key_hash, {});
          const candidates = hydrateSearchCandidates(rawCandidates, descriptors);
          expect(candidates.length).toBeGreaterThan(0);
          expect(candidates[0]).toMatchObject({
            asset_id: manifest.asset_id,
            revision: 1,
          });
          expect(candidates[0]!.shot_id).toMatch(/^shot_/u);
          expect(candidates[0]!.start_ms).toBeGreaterThanOrEqual(0);
          expect(candidates[0]!.end_ms).toBeGreaterThan(candidates[0]!.start_ms);
          expect(Number.isFinite(candidates[0]!.semantic_score)).toBe(true);
          expect(candidates[0]!.descriptor.health_state).toBe('unknown');
          expect(candidates[0]!.descriptor.evidence.motion_sensitive_guard).toMatchObject({
            temporal_evidence: 'INSUFFICIENT',
          });
          const evidence = {
            report_kind: 'CODE_C_REAL_SIGLIP_ONNX_CANDIDATE_E2E',
            schema_version: '1.0',
            status: 'PASS',
            code_head_sha: process.env.GITHUB_SHA ?? null,
            candidate_worker: workerExecutable
              ? {
                  filename: workerExecutable,
                  sha256: createHash('sha256')
                    .update(await readFile(workerExecutable))
                    .digest('hex'),
                }
              : null,
            source_fixture: 'repository-generated synthetic MJPG AVI',
            index_stages: indexEvents
              .filter((event) => event.type === 'progress')
              .map((event) => event.payload?.stage),
            second_scan_stages: secondScanStages,
            second_scan_zero_reprocess: true,
            shot_count: manifest.shots.length,
            sqlite_embedding_truth_rows: truth.length,
            cache_generation_id: generationId,
            query: 'veterinary medicine bottle for livestock',
            worker_execution: workerExecutable ? 'PYINSTALLER_ONEFILE' : 'PYTHON_MODULE',
            network_observation: {
              instrumentation: 'HTTP_PROXY_HTTPS_PROXY_ALL_PROXY_LOOPBACK_DENY_OBSERVER',
              outbound_network_attempts: outboundNetworkAttempts,
              network_required_for_normal_operation: false,
            },
            top_candidate: candidates[0],
          };
          expect(outboundNetworkAttempts).toBe(0);
          if (evidencePath) await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
        } finally {
          opened.db.close();
        }
      } finally {
        await new Promise<void>((resolvePromise) => observer.close(() => resolvePromise()));
        await rm(directory, { recursive: true, force: true });
      }
    },
    10 * 60 * 1000,
  );
});
