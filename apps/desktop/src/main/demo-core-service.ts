import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CandidateShotPlanV1, ConfirmedShotPlanV1 } from '@app/contracts';
import { computeSourceDocumentHashV1 } from '@app/domain-copywriting';
import {
  CopywritingRepository,
  ShotPlanAuthorityRepository,
  SourceDocumentRepository,
} from '@app/local-db';
import { ShotPlanAuthorityService } from './shot-plan-authority-service.js';
import { SourceDocumentAuthorityService } from './source-document-authority-service.js';

type Database = ConstructorParameters<typeof CopywritingRepository>[0];

const identity = z.string().trim().min(1).max(256);
const proposeSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(8000)
      .refine((text) => text.trim().length > 0),
    route: z.enum(['ANIMAL', 'PRODUCT']),
  })
  .strict();
const confirmSchema = z
  .object({
    candidate_id: identity,
    candidate_revision: z.number().int().positive(),
    source_document_id: identity,
    source_document_version: z.number().int().positive(),
    source_document_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const getSchema = z.object({ candidate_id: identity }).strict();

export interface DemoCoreDto {
  mode: 'OFFLINE_DETERMINISTIC';
  stage: 'PROPOSED' | 'CONFIRMED';
  candidate: CandidateShotPlanV1;
  confirmed: ConfirmedShotPlanV1 | null;
}

/** Demo composition only: deterministic segmentation, user-selected route, no provider. */
export class DemoCoreService {
  readonly #database: Database;
  readonly #authority: ShotPlanAuthorityService;
  readonly #sourceAuthority: SourceDocumentAuthorityService;
  readonly #repository: ShotPlanAuthorityRepository;

  constructor(options: { database: Database }) {
    this.#database = options.database;
    const sourceDocuments = new SourceDocumentRepository(options.database);
    this.#repository = new ShotPlanAuthorityRepository(options.database);
    this.#authority = new ShotPlanAuthorityService({
      repository: this.#repository,
      sourceDocuments,
    });
    this.#sourceAuthority = new SourceDocumentAuthorityService({
      scripts: new CopywritingRepository(options.database),
      sourceDocuments,
    });
  }

  propose(value: { text: string; route: 'ANIMAL' | 'PRODUCT' }): DemoCoreDto {
    const input = proposeSchema.parse(value);
    const operation = this.#database.transaction(() => {
      const scriptId = `demo_script_${randomUUID()}`;
      const now = new Date().toISOString();
      // Persist the exact user text, with honest provenance and no provider call record.
      this.#database
        .prepare(
          `INSERT INTO scripts(
        script_id, product_id, current_version, created_at, updated_at
      ) VALUES (?, NULL, 1, ?, ?)`,
        )
        .run(scriptId, now, now);
      this.#database
        .prepare(
          `INSERT INTO script_versions(
        script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
        fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
        provider_model, request_snapshot_hash, created_at
      ) VALUES (?, 1, ?, '', 'SUCCEEDED', NULL, '[]', 'demo-manual-input', '1',
        'local-user-input', 'none', ?, ?)`,
        )
        .run(scriptId, input.text, computeSourceDocumentHashV1(input.text), now);
      const source = this.#sourceAuthority.ensureFromScriptVersion({
        script_id: scriptId,
        script_version: 1,
      });
      const characters = Array.from(input.text);
      const boundaries = characters
        .flatMap((character, index) =>
          /[。！？.!?\n]/u.test(character) &&
          characters
            .slice(index + 1)
            .join('')
            .trim().length > 0
            ? [index + 1]
            : [],
        )
        .slice(0, 2);
      const ends = [...boundaries, characters.length];
      let start = 0;
      const slots = ends.map((end, index) => {
        const sourceStart = start;
        start = end;
        return {
          order_index: index,
          source_start: sourceStart,
          source_end: end,
          source_text: characters.slice(sourceStart, end).join(''),
          route: input.route,
          route_state: 'RESOLVED' as const,
          continuity_state: 'RESOLVED' as const,
          visual_continuity_group_id: `${scriptId}_group_${index}`,
          rationale: '离线确定性分句；路由由用户选择，待人工确认。',
        };
      });
      const record = this.#authority.createCandidate({
        source_document_id: source.source_document_id,
        source_document_version: source.source_document_version,
        source_document_hash: source.source_document_hash,
        segmentation_state: 'RESOLVED',
        slots,
      });
      return this.#dto(record.candidate);
    });
    return operation.immediate();
  }

  confirm(value: z.infer<typeof confirmSchema>): DemoCoreDto {
    const intent = confirmSchema.parse(value);
    this.#authority.confirmCandidate(intent);
    return this.get({ candidate_id: intent.candidate_id });
  }

  get(value: { candidate_id: string }): DemoCoreDto {
    const input = getSchema.parse(value);
    const record = this.#authority.getCandidate(input.candidate_id);
    if (!record) throw new Error('DEMO_CANDIDATE_NOT_FOUND');
    return this.#dto(record.candidate);
  }

  #dto(candidate: CandidateShotPlanV1): DemoCoreDto {
    const confirmed =
      this.#repository.findConfirmation({
        candidate_id: candidate.candidate_id,
        candidate_revision: candidate.candidate_revision,
        source_document_id: candidate.source_document_id,
        source_document_version: candidate.source_document_version,
        source_document_hash: candidate.source_document_hash,
      })?.plan ?? null;
    return {
      mode: 'OFFLINE_DETERMINISTIC',
      stage: confirmed ? 'CONFIRMED' : 'PROPOSED',
      candidate,
      confirmed,
    };
  }
}
