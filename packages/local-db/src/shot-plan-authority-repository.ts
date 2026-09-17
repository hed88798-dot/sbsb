import type { Database } from 'better-sqlite3';
import {
  candidateShotPlanV1Schema,
  type CandidateShotPlanV1,
  type ConfirmedShotPlanV1,
} from '@app/contracts';
import { canonicalJson } from '@app/domain-media-index';
import { parseConfirmedShotPlanV1 } from '@app/timeline';

interface CandidateRow {
  candidate_id: string;
  candidate_revision: number;
  candidate_status: string;
  source_document_id: string;
  source_document_version: number;
  source_document_hash: string;
  bound_shot_plan_id: string | null;
  base_confirmed_version: number | null;
  candidate_json: string;
  created_at: string;
  updated_at: string;
}

interface LineageRow {
  shot_plan_id: string;
  source_document_id: string;
  source_document_version: number;
  source_document_hash: string;
  created_at: string;
}

interface ConfirmedRow {
  shot_plan_id: string;
  version: number;
  shot_plan_hash: string;
  source_document_id: string;
  source_document_version: number;
  source_document_hash: string;
  candidate_id: string;
  candidate_revision: number;
  confirmed_plan_json: string;
  created_at: string;
}

export interface ShotPlanCandidateRecordV1 {
  candidate: CandidateShotPlanV1;
  bound_shot_plan_id: string | null;
  base_confirmed_version: number | null;
}

export interface ConfirmedShotPlanRecordV1 {
  plan: ConfirmedShotPlanV1;
  candidate_id: string;
  candidate_revision: number;
  created_at: string;
}

export interface ShotPlanConfirmationIntentV1 {
  candidate_id: string;
  candidate_revision: number;
  source_document_id: string;
  source_document_version: number;
  source_document_hash: string;
}

export interface ShotPlanConfirmationAllocationV1 {
  shot_plan_id: string;
  shot_plan_version: number;
}

function fail(code: string): never {
  throw new Error(code);
}

function parseCandidateRow(row: CandidateRow): ShotPlanCandidateRecordV1 {
  let candidate: CandidateShotPlanV1;
  try {
    candidate = candidateShotPlanV1Schema.parse(JSON.parse(row.candidate_json) as unknown);
  } catch {
    return fail('SHOT_PLAN_CANDIDATE_STORED_INTEGRITY_MISMATCH');
  }
  if (
    candidate.candidate_id !== row.candidate_id ||
    candidate.candidate_revision !== row.candidate_revision ||
    candidate.candidate_status !== row.candidate_status ||
    candidate.source_document_id !== row.source_document_id ||
    candidate.source_document_version !== row.source_document_version ||
    candidate.source_document_hash !== row.source_document_hash ||
    candidate.created_at !== row.created_at ||
    candidate.updated_at !== row.updated_at ||
    (row.bound_shot_plan_id === null) !== (row.base_confirmed_version === null)
  ) {
    return fail('SHOT_PLAN_CANDIDATE_STORED_INTEGRITY_MISMATCH');
  }
  return {
    candidate,
    bound_shot_plan_id: row.bound_shot_plan_id,
    base_confirmed_version: row.base_confirmed_version,
  };
}

function parseConfirmedRow(row: ConfirmedRow): ConfirmedShotPlanRecordV1 {
  let plan: ConfirmedShotPlanV1;
  try {
    plan = parseConfirmedShotPlanV1(JSON.parse(row.confirmed_plan_json) as unknown);
  } catch {
    return fail('CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH');
  }
  if (
    plan.shot_plan_id !== row.shot_plan_id ||
    plan.shot_plan_version !== row.version ||
    plan.shot_plan_hash !== row.shot_plan_hash ||
    plan.source_document_id !== row.source_document_id ||
    plan.source_document_version !== row.source_document_version ||
    plan.source_document_hash !== row.source_document_hash
  ) {
    return fail('CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH');
  }
  return {
    plan,
    candidate_id: row.candidate_id,
    candidate_revision: row.candidate_revision,
    created_at: row.created_at,
  };
}

export class ShotPlanAuthorityRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  createCandidate(
    candidateValue: CandidateShotPlanV1,
    binding: { shot_plan_id: string; base_confirmed_version: number } | null = null,
  ): ShotPlanCandidateRecordV1 {
    const candidate = candidateShotPlanV1Schema.parse(candidateValue);
    this.#validateCandidateValueSource(candidate);
    this.#db
      .prepare(
        `INSERT INTO shot_plan_candidates(
          candidate_id, candidate_revision, candidate_status, source_document_id,
          source_document_version, source_document_hash, bound_shot_plan_id,
          base_confirmed_version, candidate_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidate.candidate_id,
        candidate.candidate_revision,
        candidate.candidate_status,
        candidate.source_document_id,
        candidate.source_document_version,
        candidate.source_document_hash,
        binding?.shot_plan_id ?? null,
        binding?.base_confirmed_version ?? null,
        JSON.stringify(candidate),
        candidate.created_at,
        candidate.updated_at,
      );
    return this.requireCandidate(candidate.candidate_id);
  }

  getCandidate(candidateId: string): ShotPlanCandidateRecordV1 | null {
    const row = this.#candidateRow(candidateId);
    if (!row) return null;
    const record = parseCandidateRow(row);
    this.#validateCandidateSource(record);
    this.#validateCandidateLineage(record);
    return record;
  }

  requireCandidate(candidateId: string): ShotPlanCandidateRecordV1 {
    return this.getCandidate(candidateId) ?? fail('SHOT_PLAN_CANDIDATE_NOT_FOUND');
  }

  mutateCandidate(
    candidateId: string,
    expectedRevision: number,
    update: (current: ShotPlanCandidateRecordV1) => CandidateShotPlanV1,
  ): ShotPlanCandidateRecordV1 {
    const operation = this.#db.transaction(() => {
      const row = this.#candidateRow(candidateId);
      if (!row) return fail('SHOT_PLAN_CANDIDATE_NOT_FOUND');
      const current = parseCandidateRow(row);
      this.#validateCandidateSource(current);
      this.#validateCandidateLineage(current);
      if (current.candidate.candidate_revision !== expectedRevision) {
        return fail('SHOT_PLAN_CANDIDATE_REVISION_CONFLICT');
      }
      if (current.candidate.candidate_status !== 'ACTIVE') {
        return fail('SHOT_PLAN_CANDIDATE_NOT_ACTIVE');
      }
      const next = candidateShotPlanV1Schema.parse(update(current));
      if (
        next.candidate_id !== current.candidate.candidate_id ||
        next.candidate_revision !== current.candidate.candidate_revision + 1 ||
        next.source_document_id !== current.candidate.source_document_id ||
        next.source_document_version !== current.candidate.source_document_version ||
        next.source_document_hash !== current.candidate.source_document_hash ||
        next.source_offset_unit !== current.candidate.source_offset_unit ||
        next.created_at !== current.candidate.created_at
      ) {
        return fail('SHOT_PLAN_CANDIDATE_MUTATION_INVALID');
      }
      const updated = this.#db
        .prepare(
          `UPDATE shot_plan_candidates
           SET candidate_revision = ?, candidate_status = ?, candidate_json = ?, updated_at = ?
           WHERE candidate_id = ? AND candidate_revision = ?`,
        )
        .run(
          next.candidate_revision,
          next.candidate_status,
          JSON.stringify(next),
          next.updated_at,
          candidateId,
          expectedRevision,
        );
      if (updated.changes !== 1) return fail('SHOT_PLAN_CANDIDATE_REVISION_CONFLICT');
      return this.requireCandidate(candidateId);
    });
    return operation.immediate();
  }

  getLineageBySource(sourceDocumentId: string, sourceDocumentVersion: number): LineageRow | null {
    return (
      (this.#db
        .prepare(
          `SELECT * FROM shot_plan_lineages
           WHERE source_document_id = ? AND source_document_version = ?`,
        )
        .get(sourceDocumentId, sourceDocumentVersion) as LineageRow | undefined) ?? null
    );
  }

  getConfirmedVersion(shotPlanId: string, version: number): ConfirmedShotPlanRecordV1 | null {
    const row = this.#confirmedRow(shotPlanId, version);
    return row ? this.#trustedConfirmed(row) : null;
  }

  getLatestConfirmedBySource(
    sourceDocumentId: string,
    sourceDocumentVersion: number,
  ): ConfirmedShotPlanRecordV1 | null {
    const row = this.#db
      .prepare(
        `SELECT confirmed.*
         FROM confirmed_shot_plan_versions AS confirmed
         INNER JOIN shot_plan_lineages AS lineage
           ON lineage.shot_plan_id = confirmed.shot_plan_id
         WHERE lineage.source_document_id = ? AND lineage.source_document_version = ?
         ORDER BY confirmed.version DESC
         LIMIT 1`,
      )
      .get(sourceDocumentId, sourceDocumentVersion) as ConfirmedRow | undefined;
    return row ? this.#trustedConfirmed(row) : null;
  }

  findConfirmation(intent: ShotPlanConfirmationIntentV1): ConfirmedShotPlanRecordV1 | null {
    const row = this.#confirmationRow(intent);
    return row ? this.#trustedConfirmed(row) : null;
  }

  confirmCandidate(input: {
    intent: ShotPlanConfirmationIntentV1;
    new_shot_plan_id: string;
    created_at: string;
    build: (
      candidate: CandidateShotPlanV1,
      allocation: ShotPlanConfirmationAllocationV1,
    ) => ConfirmedShotPlanV1;
  }): ConfirmedShotPlanRecordV1 {
    const operation = this.#db.transaction(() => {
      const duplicate = this.#confirmationRow(input.intent);
      if (duplicate) return this.#trustedConfirmed(duplicate);

      const candidateRow = this.#candidateRow(input.intent.candidate_id);
      if (!candidateRow) return fail('SHOT_PLAN_CANDIDATE_NOT_FOUND');
      const record = parseCandidateRow(candidateRow);
      this.#validateCandidateSource(record);
      this.#validateCandidateLineage(record);
      const candidate = record.candidate;
      if (candidate.candidate_revision !== input.intent.candidate_revision) {
        return fail('SHOT_PLAN_CONFIRMATION_STALE');
      }
      if (candidate.candidate_status !== 'ACTIVE') {
        return fail('SHOT_PLAN_CANDIDATE_NOT_ACTIVE');
      }
      if (
        candidate.source_document_id !== input.intent.source_document_id ||
        candidate.source_document_version !== input.intent.source_document_version ||
        candidate.source_document_hash !== input.intent.source_document_hash
      ) {
        return fail('SHOT_PLAN_CONFIRMATION_SOURCE_MISMATCH');
      }

      let shotPlanId: string;
      let version: number;
      if (record.bound_shot_plan_id === null) {
        if (
          this.getLineageBySource(candidate.source_document_id, candidate.source_document_version)
        ) {
          return fail('SHOT_PLAN_PARALLEL_LINEAGE_NOT_ALLOWED');
        }
        shotPlanId = input.new_shot_plan_id;
        version = 1;
        this.#db
          .prepare(
            `INSERT INTO shot_plan_lineages(
              shot_plan_id, source_document_id, source_document_version,
              source_document_hash, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            shotPlanId,
            candidate.source_document_id,
            candidate.source_document_version,
            candidate.source_document_hash,
            input.created_at,
          );
      } else {
        const lineage = this.#lineageRow(record.bound_shot_plan_id);
        if (
          !lineage ||
          lineage.source_document_id !== candidate.source_document_id ||
          lineage.source_document_version !== candidate.source_document_version ||
          lineage.source_document_hash !== candidate.source_document_hash
        ) {
          return fail('SHOT_PLAN_LINEAGE_STORED_INTEGRITY_MISMATCH');
        }
        const latestVersion = this.#latestVersion(lineage.shot_plan_id);
        if (record.base_confirmed_version !== latestVersion) {
          return fail('SHOT_PLAN_CONFIRMED_VERSION_CONFLICT');
        }
        shotPlanId = lineage.shot_plan_id;
        version = latestVersion + 1;
      }

      const plan = parseConfirmedShotPlanV1(
        input.build(candidate, {
          shot_plan_id: shotPlanId,
          shot_plan_version: version,
        }),
      );
      if (
        plan.shot_plan_id !== shotPlanId ||
        plan.shot_plan_version !== version ||
        plan.source_document_id !== candidate.source_document_id ||
        plan.source_document_version !== candidate.source_document_version ||
        plan.source_document_hash !== candidate.source_document_hash
      ) {
        return fail('CONFIRMED_SHOT_PLAN_ALLOCATION_MISMATCH');
      }
      this.#db
        .prepare(
          `INSERT INTO confirmed_shot_plan_versions(
            shot_plan_id, version, shot_plan_hash, source_document_id,
            source_document_version, source_document_hash, candidate_id,
            candidate_revision, confirmed_plan_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          plan.shot_plan_id,
          plan.shot_plan_version,
          plan.shot_plan_hash,
          plan.source_document_id,
          plan.source_document_version,
          plan.source_document_hash,
          input.intent.candidate_id,
          input.intent.candidate_revision,
          canonicalJson(plan),
          input.created_at,
        );
      this.#db
        .prepare(
          `UPDATE shot_plan_candidates
           SET bound_shot_plan_id = ?, base_confirmed_version = ?
           WHERE candidate_id = ? AND candidate_revision = ?`,
        )
        .run(shotPlanId, version, input.intent.candidate_id, input.intent.candidate_revision);
      const committed = this.#confirmedRow(shotPlanId, version);
      if (!committed) return fail('CONFIRMED_SHOT_PLAN_COMMIT_MISSING_AFTER_INSERT');
      return this.#trustedConfirmed(committed);
    });
    return operation.immediate();
  }

  #candidateRow(candidateId: string): CandidateRow | undefined {
    return this.#db
      .prepare('SELECT * FROM shot_plan_candidates WHERE candidate_id = ?')
      .get(candidateId) as CandidateRow | undefined;
  }

  #lineageRow(shotPlanId: string): LineageRow | undefined {
    return this.#db
      .prepare('SELECT * FROM shot_plan_lineages WHERE shot_plan_id = ?')
      .get(shotPlanId) as LineageRow | undefined;
  }

  #confirmedRow(shotPlanId: string, version: number): ConfirmedRow | undefined {
    return this.#db
      .prepare(
        `SELECT * FROM confirmed_shot_plan_versions
         WHERE shot_plan_id = ? AND version = ?`,
      )
      .get(shotPlanId, version) as ConfirmedRow | undefined;
  }

  #confirmationRow(intent: ShotPlanConfirmationIntentV1): ConfirmedRow | undefined {
    return this.#db
      .prepare(
        `SELECT * FROM confirmed_shot_plan_versions
         WHERE candidate_id = ? AND candidate_revision = ?
           AND source_document_id = ? AND source_document_version = ?
           AND source_document_hash = ?`,
      )
      .get(
        intent.candidate_id,
        intent.candidate_revision,
        intent.source_document_id,
        intent.source_document_version,
        intent.source_document_hash,
      ) as ConfirmedRow | undefined;
  }

  #latestVersion(shotPlanId: string): number {
    return this.#db
      .prepare(
        `SELECT COALESCE(MAX(version), 0) FROM confirmed_shot_plan_versions
         WHERE shot_plan_id = ?`,
      )
      .pluck()
      .get(shotPlanId) as number;
  }

  #validateCandidateLineage(record: ShotPlanCandidateRecordV1): void {
    if (record.bound_shot_plan_id === null) return;
    const lineage = this.#lineageRow(record.bound_shot_plan_id);
    if (
      !lineage ||
      lineage.source_document_id !== record.candidate.source_document_id ||
      lineage.source_document_version !== record.candidate.source_document_version ||
      lineage.source_document_hash !== record.candidate.source_document_hash ||
      record.base_confirmed_version === null ||
      record.base_confirmed_version > this.#latestVersion(lineage.shot_plan_id)
    ) {
      return fail('SHOT_PLAN_CANDIDATE_STORED_INTEGRITY_MISMATCH');
    }
  }

  #validateCandidateSource(record: ShotPlanCandidateRecordV1): void {
    this.#validateCandidateValueSource(record.candidate);
  }

  #validateCandidateValueSource(candidate: CandidateShotPlanV1): void {
    const sourceHash = this.#db
      .prepare(
        `SELECT source_document_hash FROM source_document_versions
         WHERE source_document_id = ? AND version = ?`,
      )
      .pluck()
      .get(candidate.source_document_id, candidate.source_document_version) as string | undefined;
    if (sourceHash !== candidate.source_document_hash) {
      return fail('SHOT_PLAN_CANDIDATE_STORED_INTEGRITY_MISMATCH');
    }
  }

  #trustedConfirmed(row: ConfirmedRow): ConfirmedShotPlanRecordV1 {
    const record = parseConfirmedRow(row);
    const lineage = this.#lineageRow(row.shot_plan_id);
    const sourceHash = this.#db
      .prepare(
        `SELECT source_document_hash FROM source_document_versions
         WHERE source_document_id = ? AND version = ?`,
      )
      .pluck()
      .get(row.source_document_id, row.source_document_version) as string | undefined;
    if (
      !lineage ||
      lineage.source_document_id !== row.source_document_id ||
      lineage.source_document_version !== row.source_document_version ||
      lineage.source_document_hash !== row.source_document_hash ||
      sourceHash !== row.source_document_hash
    ) {
      return fail('CONFIRMED_SHOT_PLAN_STORED_INTEGRITY_MISMATCH');
    }
    return record;
  }
}
