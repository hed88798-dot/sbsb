import type { Database } from 'better-sqlite3';
import {
  materialSelectionRequestV1Schema,
  materialSelectionResultV1Schema,
  selectionDecisionReceiptV1Schema,
  usageHistorySnapshotV1Schema,
  type MaterialSelectionRequestV1,
  type MaterialSelectionResultV1,
  type MaterialUsageRecordV1,
  type SelectionDecisionReceiptV1,
  type UsageHistorySnapshotV1,
} from '@app/contracts';

interface DecisionRow {
  selection_request_id: string;
  batch_id: string;
  video_id: string;
  slot_id: string;
  material_family: 'ANIMAL' | 'PRODUCT';
  status: 'SELECTED' | 'NO_MATCH';
  selected_asset_id: string | null;
  selected_shot_id: string | null;
  selected_semantic_rank: number | null;
  selected_semantic_score: number | null;
  degradation_level: number;
  reason_codes_json: string;
  candidate_set_id: string;
  candidate_set_contract_version: string;
  candidate_set_hash: string;
  history_snapshot_hash: string;
  policy_id: string;
  policy_version: string;
  policy_snapshot_hash: string;
  committed_at: string;
  decision_receipt_hash: string;
  request_json: string;
  decision_receipt_json: string;
  result_json: string;
}

export interface CommittedMaterialSelectionEvidenceV1 {
  request: MaterialSelectionRequestV1;
  receipt: SelectionDecisionReceiptV1;
  result: MaterialSelectionResultV1;
}

export class MaterialSelectionRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  get(selectionRequestId: string): MaterialSelectionResultV1 | null {
    const row = this.#db
      .prepare(
        'SELECT result_json FROM material_selection_decisions WHERE selection_request_id = ?',
      )
      .get(selectionRequestId) as Pick<DecisionRow, 'result_json'> | undefined;
    return row
      ? materialSelectionResultV1Schema.parse(JSON.parse(row.result_json) as unknown)
      : null;
  }

  getCommittedEvidence(selectionRequestId: string): CommittedMaterialSelectionEvidenceV1 | null {
    const row = this.#db
      .prepare('SELECT * FROM material_selection_decisions WHERE selection_request_id = ?')
      .get(selectionRequestId) as DecisionRow | undefined;
    if (!row) return null;
    const request = materialSelectionRequestV1Schema.parse(JSON.parse(row.request_json) as unknown);
    const receipt = selectionDecisionReceiptV1Schema.parse(
      JSON.parse(row.decision_receipt_json) as unknown,
    );
    const result = materialSelectionResultV1Schema.parse(JSON.parse(row.result_json) as unknown);
    if (
      row.selection_request_id !== request.selection_request_id ||
      row.selection_request_id !== receipt.selection_request_id ||
      row.selection_request_id !== result.selection_request_id ||
      row.batch_id !== request.batch_id ||
      row.batch_id !== receipt.batch_id ||
      row.batch_id !== result.batch_id ||
      row.video_id !== request.video_id ||
      row.video_id !== receipt.video_id ||
      row.video_id !== result.video_id ||
      row.slot_id !== request.slot_id ||
      row.slot_id !== receipt.slot_id ||
      row.slot_id !== result.slot_id ||
      row.material_family !== request.material_family ||
      row.status !== receipt.status ||
      row.status !== result.status ||
      row.selected_asset_id !== receipt.selected_asset_id ||
      row.selected_asset_id !== result.selected_asset_id ||
      row.selected_shot_id !== receipt.selected_shot_id ||
      row.selected_shot_id !== result.selected_shot_id ||
      row.selected_semantic_rank !== receipt.selected_semantic_rank ||
      row.selected_semantic_rank !== result.selected_semantic_rank ||
      row.selected_semantic_score !== receipt.selected_semantic_score ||
      row.selected_semantic_score !== result.selected_semantic_score ||
      row.degradation_level !== receipt.degradation_level ||
      row.degradation_level !== result.degradation_level ||
      row.reason_codes_json !== JSON.stringify(result.reason_codes) ||
      row.candidate_set_id !== request.candidate_set_id ||
      row.candidate_set_contract_version !== request.candidate_set_contract_version ||
      row.candidate_set_hash !== request.candidate_set_hash ||
      row.candidate_set_hash !== receipt.candidate_set_hash ||
      row.candidate_set_hash !== result.candidate_set_hash ||
      row.history_snapshot_hash !== request.history_snapshot_hash ||
      row.history_snapshot_hash !== receipt.history_snapshot_hash ||
      row.history_snapshot_hash !== result.history_snapshot_hash ||
      row.policy_id !== request.policy_id ||
      row.policy_id !== receipt.policy_id ||
      row.policy_version !== request.policy_version ||
      row.policy_version !== receipt.policy_version ||
      row.policy_snapshot_hash !== request.policy_snapshot_hash ||
      row.policy_snapshot_hash !== receipt.policy_snapshot_hash ||
      row.policy_snapshot_hash !== result.policy_snapshot_hash ||
      row.decision_receipt_hash !== result.decision_receipt_hash ||
      row.committed_at !== result.committed_at
    ) {
      throw new Error('MATERIAL_SELECTION_STORED_EVIDENCE_IDENTITY_MISMATCH');
    }
    return { request, receipt, result };
  }

  listAuthoritativeUsage(): UsageHistorySnapshotV1 {
    const rows = this.#db
      .prepare(
        `SELECT selection_request_id, batch_id, video_id, slot_id, material_family,
          selected_asset_id, selected_shot_id, committed_at, decision_receipt_hash
         FROM material_selection_decisions
         WHERE status = 'SELECTED'
         ORDER BY committed_at, selection_request_id`,
      )
      .all() as Array<
      Pick<
        DecisionRow,
        | 'selection_request_id'
        | 'batch_id'
        | 'video_id'
        | 'slot_id'
        | 'material_family'
        | 'selected_asset_id'
        | 'selected_shot_id'
        | 'committed_at'
        | 'decision_receipt_hash'
      >
    >;
    const selectedDecisions: MaterialUsageRecordV1[] = rows.map((row) => ({
      selection_request_id: row.selection_request_id,
      batch_id: row.batch_id,
      video_id: row.video_id,
      slot_id: row.slot_id,
      material_family: row.material_family,
      asset_id: row.selected_asset_id!,
      shot_id: row.selected_shot_id!,
      committed_at: row.committed_at,
      decision_receipt_hash: row.decision_receipt_hash,
    }));
    return usageHistorySnapshotV1Schema.parse({
      schema_version: '1.0',
      selected_decisions: selectedDecisions,
    });
  }

  runImmediate<T>(operation: () => T): T {
    return this.#db.transaction(operation).immediate();
  }

  commit(input: {
    request: MaterialSelectionRequestV1;
    receipt: SelectionDecisionReceiptV1;
    result: MaterialSelectionResultV1;
  }): void {
    const request = materialSelectionRequestV1Schema.parse(input.request);
    const receipt = selectionDecisionReceiptV1Schema.parse(input.receipt);
    const result = materialSelectionResultV1Schema.parse(input.result);
    if (
      request.selection_request_id !== receipt.selection_request_id ||
      receipt.selection_request_id !== result.selection_request_id ||
      request.batch_id !== receipt.batch_id ||
      receipt.batch_id !== result.batch_id ||
      request.video_id !== receipt.video_id ||
      receipt.video_id !== result.video_id ||
      request.slot_id !== receipt.slot_id ||
      receipt.slot_id !== result.slot_id ||
      receipt.status !== result.status ||
      receipt.selected_asset_id !== result.selected_asset_id ||
      receipt.selected_shot_id !== result.selected_shot_id ||
      receipt.selected_semantic_rank !== result.selected_semantic_rank ||
      receipt.selected_semantic_score !== result.selected_semantic_score ||
      receipt.degradation_level !== result.degradation_level ||
      JSON.stringify(receipt.reason_codes) !== JSON.stringify(result.reason_codes) ||
      request.candidate_set_hash !== receipt.candidate_set_hash ||
      request.candidate_set_hash !== result.candidate_set_hash ||
      request.history_snapshot_hash !== receipt.history_snapshot_hash ||
      request.history_snapshot_hash !== result.history_snapshot_hash ||
      request.policy_id !== receipt.policy_id ||
      request.policy_version !== receipt.policy_version ||
      request.policy_snapshot_hash !== receipt.policy_snapshot_hash ||
      request.policy_snapshot_hash !== result.policy_snapshot_hash
    ) {
      throw new Error('MATERIAL_SELECTION_DECISION_IDENTITY_MISMATCH');
    }
    this.#db
      .prepare(
        `INSERT INTO material_selection_decisions(
          selection_request_id, batch_id, video_id, slot_id, material_family, status,
          selected_asset_id, selected_shot_id, selected_semantic_rank, selected_semantic_score,
          degradation_level, reason_codes_json, candidate_set_id, candidate_set_contract_version,
          candidate_set_hash, history_snapshot_hash, policy_id, policy_version,
          policy_snapshot_hash, decision_receipt_hash, request_json, decision_receipt_json,
          result_json, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.selection_request_id,
        result.batch_id,
        result.video_id,
        result.slot_id,
        request.material_family,
        result.status,
        result.selected_asset_id,
        result.selected_shot_id,
        result.selected_semantic_rank,
        result.selected_semantic_score,
        result.degradation_level,
        JSON.stringify(result.reason_codes),
        request.candidate_set_id,
        request.candidate_set_contract_version,
        result.candidate_set_hash,
        result.history_snapshot_hash,
        request.policy_id,
        request.policy_version,
        result.policy_snapshot_hash,
        result.decision_receipt_hash,
        JSON.stringify(request),
        JSON.stringify(receipt),
        JSON.stringify(result),
        result.committed_at,
      );
  }
}
