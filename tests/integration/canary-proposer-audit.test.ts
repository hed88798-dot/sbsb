import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShotPlanAuthorityService } from '../../apps/desktop/src/main/shot-plan-authority-service.js';
import { ShotPlanProposerServiceV1 } from '../../apps/desktop/src/main/shot-plan-proposer-service.js';
import { SourceDocumentAuthorityService } from '../../apps/desktop/src/main/source-document-authority-service.js';
import type { TextGatewayRequestV1 } from '../../packages/contracts/src/index.js';
import {
  CopywritingRepository,
  ShotPlanAuthorityRepository,
  SourceDocumentRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import { createCanaryProposerAuditCollector } from '../helpers/canary-proposer-audit.js';

const event = 'shot_plan.proposal.structural_normalization';
const operationId = 'real_shot_plan_canary_synthetic';
const trace = { operation_id: operationId, provider_request_id: 'provider_request_synthetic' };
const text = '使用康健100后，猪群采食状态逐步恢复。';
const raw = readFileSync(
  new URL('../fixtures/shot-planning/optional-context-null-observed.json', import.meta.url),
  'utf8',
);
const validFields = {
  ...trace,
  structural_normalization: 'OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1',
  normalized_optional_context_fields: 2,
  raw_provider_canonical_schema_validation: 'FAIL',
  post_normalization_canonical_schema_validation: 'PASS',
};

let db: Database | undefined;
let directory: string;
const network = vi.fn(() => {
  throw new Error('NETWORK_FORBIDDEN_IN_CANARY_COLLECTOR_TEST');
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'canary-proposer-audit-'));
  network.mockClear();
  vi.stubGlobal('fetch', network);
});

afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  db?.close();
  db = undefined;
  rmSync(directory, { recursive: true, force: true });
});

async function scenario(response: string) {
  db = (
    await openDatabase({
      dbPath: join(directory, 'desktop.db'),
      migrationsDirectory: resolve(import.meta.dirname, '../../migrations/desktop-sqlite'),
    })
  ).db;
  const now = '2026-09-17T00:00:00.000Z';
  db.prepare(
    'INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at) VALUES (?, NULL, 1, ?, ?)',
  ).run('script_canary_audit', now, now);
  db.prepare(
    `INSERT INTO script_versions(
      script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
      fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
      provider_model, request_snapshot_hash, created_at
    ) VALUES (?, 1, ?, ?, 'SUCCEEDED', NULL, '[]', 'synthetic', '1', 'synthetic', 'synthetic', ?, ?)`,
  ).run('script_canary_audit', text, text, 'a'.repeat(64), now);
  const sources = new SourceDocumentRepository(db);
  const source = new SourceDocumentAuthorityService({
    scripts: new CopywritingRepository(db),
    sourceDocuments: sources,
    clock: () => now,
  }).ensureFromScriptVersion({ script_id: 'script_canary_audit', script_version: 1 });
  const repository = new ShotPlanAuthorityRepository(db);
  const collector = createCanaryProposerAuditCollector(operationId);
  const requests: TextGatewayRequestV1[] = [];
  const service = new ShotPlanProposerServiceV1({
    sourceDocuments: sources,
    shotPlans: new ShotPlanAuthorityService({
      repository,
      sourceDocuments: sources,
      clock: () => now,
    }),
    client: {
      generate: async (request) => {
        requests.push(request);
        return {
          schema_version: '1.0',
          request_id: request.request_id,
          text: response,
          provider_alias: 'synthetic-provider',
          provider_model: 'synthetic-model',
          latency_ms: 1,
          billed_units: 1,
          request_snapshot_hash: request.request_snapshot_hash,
        };
      },
    },
    audit: collector.audit,
  });
  const operation = {
    operation_id: operationId,
    source_document_id: source.source_document_id,
    source_document_version: source.source_document_version,
    source_document_hash: source.source_document_hash,
  };
  return { service, operation, collector, requests, repository };
}

describe('success-path canary proposer audit evidence', () => {
  it('captures and persists the actual null-context success audit through the injected sink', async () => {
    const { service, operation, collector, requests, repository } = await scenario(raw);
    const result = await service.propose(operation);
    expect(requests).toHaveLength(1);
    expect(result.trace.provider_attempts).toBe(1);
    expect(result.candidate).toMatchObject({ candidate_revision: 1, candidate_status: 'ACTIVE' });
    expect(result.candidate).not.toHaveProperty('review_state');
    expect(repository.getCandidate(result.candidate.candidate_id)?.candidate).toEqual(
      result.candidate,
    );
    const file = join(directory, 'proposer-audit-evidence.json');
    const evidence = collector.writeEvidence(file, result.trace);
    expect(evidence).toMatchObject({
      operation_id: operationId,
      provider_request_id: requests[0]!.request_id,
      STRUCTURAL_NORMALIZATION_APPLIED: 'YES',
      NORMALIZATION_AUDIT_EXPECTED: 'YES',
      NORMALIZATION_AUDIT_CAPTURED: 'YES',
      NORMALIZATION_AUDIT_EVENT_COUNT: 1,
      NORMALIZATION_AUDIT_RULE: 'OPTIONAL_CONTEXT_NULL_TO_ABSENT_V1',
      NORMALIZATION_AUDIT_FIELD_COUNT: 2,
      NORMALIZATION_AUDIT_RAW_CANONICAL_VALIDATION: 'FAIL',
      NORMALIZATION_AUDIT_POST_NORMALIZATION_VALIDATION: 'PASS',
      normalization_audit_events: [
        { ...validFields, provider_request_id: requests[0]!.request_id, event },
      ],
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(evidence);
    expect(JSON.stringify(evidence)).not.toContain(text);
    expect(JSON.stringify(evidence)).not.toContain(JSON.parse(raw).units[0].rationale);
  });

  it('requires no normalization audit when the Provider correctly omits both anchors', async () => {
    const proposal = JSON.parse(raw);
    delete proposal.units[0].left_context;
    delete proposal.units[0].right_context;
    const { service, operation, collector, requests } = await scenario(JSON.stringify(proposal));
    const result = await service.propose(operation);
    expect(requests).toHaveLength(1);
    expect(result.candidate.candidate_status).toBe('ACTIVE');
    expect(collector.evidence(result.trace)).toMatchObject({
      STRUCTURAL_NORMALIZATION_APPLIED: 'NO',
      NORMALIZATION_AUDIT_EXPECTED: 'NO',
      NORMALIZATION_AUDIT_CAPTURED: 'NOT_APPLICABLE',
      NORMALIZATION_AUDIT_EVENT_COUNT: 0,
      NORMALIZATION_AUDIT_FIELD_COUNT: 0,
      normalization_audit_events: [],
    });
  });

  it('preserves rejection and the default bounded retry for a genuinely invalid proposal', async () => {
    const proposal = JSON.parse(raw);
    proposal.units[0].route = 'INVALID_ROUTE';
    const { service, operation, requests } = await scenario(JSON.stringify(proposal));
    await expect(service.propose(operation)).rejects.toMatchObject({
      code: 'SHOT_PLAN_PROPOSAL_INVALID_STRUCTURED_OUTPUT',
    });
    expect(requests).toHaveLength(2);
    expect(db!.prepare('SELECT COUNT(*) AS count FROM shot_plan_candidates').get()).toEqual({
      count: 0,
    });
  });

  it('returns and writes only allowed scalars, with no semantic, credential or endpoint payload', () => {
    const collector = createCanaryProposerAuditCollector(operationId);
    const forbidden = {
      source_text: text,
      exact_fragment: 'SYNTHETIC_PRIVATE_FRAGMENT',
      rationale: 'SYNTHETIC_PRIVATE_RATIONALE',
      raw_provider_response: raw,
      prompt: 'SYNTHETIC_PRIVATE_PROMPT',
      schema: { description: 'SYNTHETIC_PRIVATE_SCHEMA' },
      api_key: 'synthetic-key',
      authorization: 'synthetic-bearer-never-real',
      workspace_id: 'synthetic-private-workspace',
      endpoint: 'https://synthetic-private-workspace.invalid',
      license_secret: 'synthetic-private-license',
      activation_code: 'synthetic-private-activation',
      device_private_key: 'synthetic-private-device-key',
      stack: 'synthetic-private-stack',
    };
    collector.audit(event, { ...validFields, ...forbidden });
    collector.audit('unrelated.event', forbidden);
    const file = join(directory, 'safe.json');
    const report = collector.writeEvidence(file, trace);
    const serialized = readFileSync(file, 'utf8');
    for (const value of Object.values(forbidden)) {
      expect(serialized).not.toContain(typeof value === 'string' ? value : JSON.stringify(value));
    }
    expect(Object.keys(report.normalization_audit_events[0]!).sort()).toEqual(
      ['event', ...Object.keys(validFields)].sort(),
    );
    expect(() => collector.writeEvidence(file, trace)).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(serialized);
  });

  it.each([{ operation_id: 'stale_operation' }, { provider_request_id: 'provider_request_stale' }])(
    'rejects stale or unrelated audit correlation (%j)',
    (changes) => {
      const collector = createCanaryProposerAuditCollector(operationId);
      collector.audit(event, { ...validFields, ...changes });
      expect(() => collector.evidence(trace)).toThrow('CANARY_AUDIT_CORRELATION_OR_EVENT_INVALID');
    },
  );

  it.each([
    { normalized_optional_context_fields: 0 },
    { normalized_optional_context_fields: 1.5 },
    { structural_normalization: 'UNREVIEWED_RULE' },
    { post_normalization_canonical_schema_validation: { secret: 'private' } },
  ])('rejects malformed evidence rather than returning a safe-looking success (%j)', (changes) => {
    const collector = createCanaryProposerAuditCollector(operationId);
    collector.audit(event, { ...validFields, ...changes });
    expect(() => collector.evidence(trace)).toThrow('CANARY_AUDIT_CORRELATION_OR_EVENT_INVALID');
  });

  it('cannot report a failed normalization validation as successful evidence', () => {
    const collector = createCanaryProposerAuditCollector(operationId);
    collector.audit(event, {
      ...validFields,
      post_normalization_canonical_schema_validation: 'FAIL',
    });
    expect(() => collector.evidence(trace)).toThrow(
      'CANARY_AUDIT_POST_NORMALIZATION_VALIDATION_FAILED',
    );
  });
});
