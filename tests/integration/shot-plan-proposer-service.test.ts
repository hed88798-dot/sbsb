import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShotPlanAuthorityService } from '../../apps/desktop/src/main/shot-plan-authority-service.js';
import { ShotPlanProposerServiceV1 } from '../../apps/desktop/src/main/shot-plan-proposer-service.js';
import { SourceDocumentAuthorityService } from '../../apps/desktop/src/main/source-document-authority-service.js';
import type {
  CanonicalSourceDocumentV1,
  TextGatewayRequestV1,
  TextGatewayResultV1,
} from '../../packages/contracts/src/index.js';
import {
  CopywritingRepository,
  ShotPlanAuthorityRepository,
  SourceDocumentRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import {
  GatewayClientError,
  type TextCapabilityClient,
} from '../../packages/provider-client/src/index.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
const now = '2026-09-17T01:02:03.000Z';

class SequenceClient implements TextCapabilityClient {
  readonly requests: TextGatewayRequestV1[] = [];
  readonly #steps: Array<string | Error>;

  constructor(steps: Array<string | Error>) {
    this.#steps = [...steps];
  }

  async generate(
    request: TextGatewayRequestV1,
    options: { signal?: AbortSignal } = {},
  ): Promise<TextGatewayResultV1> {
    this.requests.push(request);
    if (options.signal?.aborted) throw new GatewayClientError('CANCELLED', 'cancelled', false);
    const step = this.#steps.shift();
    if (step instanceof Error) throw step;
    if (step === undefined) throw new Error('TEST_SEQUENCE_EXHAUSTED');
    return {
      schema_version: '1.0',
      request_id: request.request_id,
      text: step,
      provider_alias: 'mock-text',
      provider_model: 'mock-semantic-v1',
      latency_ms: 4,
      billed_units: 1,
      request_snapshot_hash: request.request_snapshot_hash,
    };
  }
}

function rawProposal(first = '猪群咳喘。', second = '展示本品。'): string {
  return JSON.stringify({
    schema_version: '1.0',
    segmentation_state: 'RESOLVED',
    review_warnings: [],
    units: [
      {
        exact_fragment: first,
        route: 'ANIMAL',
        route_state: 'RESOLVED',
        continuity_action: 'START_NEW',
        continuity_state: 'RESOLVED',
        rationale: '症状场景。',
        review_warnings: [],
      },
      {
        exact_fragment: second,
        route: 'PRODUCT',
        route_state: 'RESOLVED',
        continuity_action: 'SWITCH_VISUAL',
        continuity_state: 'RESOLVED',
        rationale: '产品展示。',
        review_warnings: [],
      },
    ],
  });
}

let database: Database;
let sourceRepository: SourceDocumentRepository;
let shotPlanRepository: ShotPlanAuthorityRepository;
let shotPlanAuthority: ShotPlanAuthorityService;
let sourceAuthority: SourceDocumentAuthorityService;
let ids: number;

function insertSource(text: string, scriptId = `script_${ids++}`): CanonicalSourceDocumentV1 {
  database
    .prepare(
      `INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at)
       VALUES (?, NULL, 1, ?, ?)`,
    )
    .run(scriptId, now, now);
  database
    .prepare(
      `INSERT INTO script_versions(
        script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
        fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
        provider_model, request_snapshot_hash, created_at
      ) VALUES (?, 1, ?, ?, 'SUCCEEDED', NULL, '[]', 'test', '1', 'mock', 'mock', ?, ?)`,
    )
    .run(scriptId, text, text, 'a'.repeat(64), now);
  return sourceAuthority.ensureFromScriptVersion({ script_id: scriptId, script_version: 1 });
}

function proposer(
  client: TextCapabilityClient,
  audit: Array<{ event: string; fields: Record<string, unknown> }> = [],
) {
  return new ShotPlanProposerServiceV1({
    sourceDocuments: sourceRepository,
    shotPlans: shotPlanAuthority,
    client,
    maxProviderAttempts: 2,
    clock: () => 100,
    id: (kind) => `${kind}_${ids++}`,
    audit: (event, fields) => audit.push({ event, fields }),
  });
}

function operation(source: CanonicalSourceDocumentV1, operationId = 'proposal_operation_1') {
  return {
    operation_id: operationId,
    source_document_id: source.source_document_id,
    source_document_version: source.source_document_version,
    source_document_hash: source.source_document_hash,
  };
}

beforeEach(async () => {
  ids = 1;
  const directory = mkdtempSync(join(tmpdir(), 'shot-plan-proposer-'));
  database = (await openDatabase({ dbPath: join(directory, 'app.db'), migrationsDirectory })).db;
  sourceRepository = new SourceDocumentRepository(database);
  sourceAuthority = new SourceDocumentAuthorityService({
    scripts: new CopywritingRepository(database),
    sourceDocuments: sourceRepository,
    clock: () => now,
  });
  shotPlanRepository = new ShotPlanAuthorityRepository(database);
  shotPlanAuthority = new ShotPlanAuthorityService({
    repository: shotPlanRepository,
    sourceDocuments: sourceRepository,
    clock: () => now,
    id: (kind) => `${kind}_${ids++}`,
  });
});

afterEach(() => {
  if (database.open) database.close();
});

describe('AI semantic Candidate Shot Plan proposer', () => {
  it('provides the whole exact source once and persists one non-confirmed C3B Candidate', async () => {
    const text = '猪群咳喘。展示本品。';
    const source = insertSource(text);
    const client = new SequenceClient([rawProposal()]);
    const result = await proposer(client).propose(operation(source));

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.prompt.split(text)).toHaveLength(2);
    expect(client.requests[0]!.prompt).toContain('同时完成语义分段、素材路由和视觉连续性提案');
    expect(result.candidate).toMatchObject({
      candidate_revision: 1,
      candidate_status: 'ACTIVE',
      source_document_hash: source.source_document_hash,
      segmentation_state: 'RESOLVED',
    });
    expect(result.candidate).not.toHaveProperty('review_state');
    expect(result.candidate).not.toHaveProperty('shot_plan_hash');
    const confirmedCount = database
      .prepare('SELECT COUNT(*) AS count FROM confirmed_shot_plan_versions')
      .get() as { count: number };
    expect(confirmedCount.count).toBe(0);
    expect(shotPlanRepository.getCandidate(result.candidate.candidate_id)?.candidate).toEqual(
      result.candidate,
    );
  });

  it('retries malformed structured output and creates no duplicate Candidate', async () => {
    const source = insertSource('猪群咳喘。展示本品。');
    const client = new SequenceClient(['not-json', rawProposal()]);
    const service = proposer(client);
    const first = await service.propose(operation(source));
    const replay = await service.propose(operation(source));

    expect(client.requests).toHaveLength(2);
    expect(replay.candidate.candidate_id).toBe(first.candidate.candidate_id);
    const count = database.prepare('SELECT COUNT(*) AS count FROM shot_plan_candidates').get() as {
      count: number;
    };
    expect(count.count).toBe(1);
    expect(first.trace.provider_attempts).toBe(2);
  });

  it('rejects an operation identity reused for a different authority snapshot', async () => {
    const firstSource = insertSource('猪群咳喘。展示本品。');
    const secondSource = insertSource('猪群采食。展示本品。');
    const client = new SequenceClient([rawProposal()]);
    const service = proposer(client);
    await service.propose(operation(firstSource, 'same_operation'));
    await expect(service.propose(operation(secondSource, 'same_operation'))).rejects.toThrow(
      'SHOT_PLAN_PROPOSAL_IDEMPOTENCY_CONFLICT',
    );
    expect(client.requests).toHaveLength(1);
  });

  it('keeps provider audit metadata traceable without source or raw model output', async () => {
    const source = insertSource('猪群咳喘。展示本品。');
    const audit: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const result = await proposer(new SequenceClient([rawProposal()]), audit).propose(
      operation(source),
    );
    expect(result.trace).toMatchObject({
      prompt_template_id: 'shot-plan.semantic-proposer',
      prompt_template_version: '2',
      model_alias: 'text.semantic-shot-planning',
      provider_request_id: expect.stringMatching(/^provider_request_/u),
      provider_alias: 'mock-text',
      provider_model: 'mock-semantic-v1',
    });
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain(source.text);
    expect(serializedAudit).not.toContain(rawProposal());
    expect(audit[0]!.fields).not.toHaveProperty('prompt');
    expect(audit[0]!.fields).not.toHaveProperty('text');
    expect(audit[0]!.fields).not.toHaveProperty('raw_output');
  });

  it.each([
    ['timeout', new GatewayClientError('GATEWAY_TIMEOUT', 'timeout', true)],
    ['429', new GatewayClientError('RATE_LIMITED', 'rate limited', true)],
    ['500', new GatewayClientError('GATEWAY_UPSTREAM_ERROR', 'upstream', true)],
    ['invalid response', new GatewayClientError('INVALID_GATEWAY_RESPONSE', 'invalid', false)],
  ])('bounds retries for provider %s without persisting a Candidate', async (_name, error) => {
    const source = insertSource('猪群咳喘。展示本品。');
    const client = new SequenceClient([error, error]);
    await expect(proposer(client).propose(operation(source))).rejects.toThrow(
      `SHOT_PLAN_PROPOSAL_PROVIDER_${error.code}`,
    );
    expect(client.requests).toHaveLength(2);
    const count = database.prepare('SELECT COUNT(*) AS count FROM shot_plan_candidates').get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });

  it('honors caller cancellation without a provider call or Candidate', async () => {
    const source = insertSource('猪群咳喘。展示本品。');
    const client = new SequenceClient([rawProposal()]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      proposer(client).propose(operation(source), { signal: controller.signal }),
    ).rejects.toThrow('SHOT_PLAN_PROPOSAL_CANCELLED');
    expect(client.requests).toHaveLength(0);
  });

  it('persists valid NEEDS_REVIEW semantics without auto-confirming them', async () => {
    const source = insertSource('疗效表达需要人工判断。');
    const raw = JSON.stringify({
      schema_version: '1.0',
      segmentation_state: 'NEEDS_REVIEW',
      review_warnings: [
        { code: 'AMBIGUOUS_CLAIM', severity: 'BLOCKING', message: '需人工复核语义' },
      ],
      units: [
        {
          exact_fragment: source.text,
          route: null,
          route_state: 'NEEDS_REVIEW',
          continuity_action: null,
          continuity_state: 'NEEDS_REVIEW',
          rationale: '无法稳定判断素材类型。',
          review_warnings: [
            { code: 'AMBIGUOUS_ROUTE', severity: 'BLOCKING', message: '需人工选择路由' },
          ],
        },
      ],
    });
    const result = await proposer(new SequenceClient([raw])).propose(operation(source));
    expect(result.candidate).toMatchObject({
      segmentation_state: 'NEEDS_REVIEW',
      slots: [
        {
          route: null,
          route_state: 'NEEDS_REVIEW',
          visual_continuity_group_id: null,
          continuity_state: 'NEEDS_REVIEW',
        },
      ],
    });
  });
});
