import { createHash } from 'node:crypto';
import {
  materialSelectionIntentV1Schema,
  materialSelectionRequestV1Schema,
  materialSelectionResultV1Schema,
  selectionDecisionReceiptV1Schema,
  type MaterialCandidateV1,
  type MaterialSelectionIntentV1,
  type MaterialSelectionRequestV1,
  type MaterialSelectionResultV1,
  type SelectionDecisionReceiptV1,
  type ShotSearchCandidateV1,
  type UsageHistorySnapshotV1,
} from '@app/contracts';
import {
  MATERIAL_SELECTION_POLICY_V1,
  adaptCodeCCandidates,
  selectMaterial,
} from '@app/domain-auto-edit';
import type {
  CommittedMaterialSelectionEvidenceV1,
  MaterialSelectionRepository,
} from '@app/local-db';

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareStableText(left, right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function stableSha256(value: unknown): string {
  return createHash('sha256').update(stableCanonicalJson(value)).digest('hex');
}

export function computeMaterialCandidateSetHashV1(
  candidates: readonly MaterialCandidateV1[],
): string {
  return stableSha256(
    [...candidates].sort(
      (left, right) =>
        compareStableText(left.asset_id, right.asset_id) ||
        compareStableText(left.shot_id, right.shot_id),
    ),
  );
}

export function computeMaterialUsageHistoryHashV1(history: UsageHistorySnapshotV1): string {
  return stableSha256(history);
}

export function computeMaterialSelectionPolicyHashV1(): string {
  return stableSha256(MATERIAL_SELECTION_POLICY_V1);
}

export function computeMaterialSelectionReceiptHashV1(receipt: SelectionDecisionReceiptV1): string {
  return stableSha256(receipt);
}

export function verifyCommittedMaterialSelectionEvidenceV1(
  input: CommittedMaterialSelectionEvidenceV1,
): CommittedMaterialSelectionEvidenceV1 {
  const request = materialSelectionRequestV1Schema.parse(input.request);
  const receipt = selectionDecisionReceiptV1Schema.parse(input.receipt);
  const result = materialSelectionResultV1Schema.parse(input.result);
  const candidateSetHash = computeMaterialCandidateSetHashV1(request.candidates);
  const historySnapshotHash = computeMaterialUsageHistoryHashV1(request.usage_history_snapshot);
  const policySnapshotHash = computeMaterialSelectionPolicyHashV1();
  const receiptHash = computeMaterialSelectionReceiptHashV1(receipt);
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
    stableCanonicalJson(receipt.reason_codes) !== stableCanonicalJson(result.reason_codes) ||
    request.candidate_set_hash !== candidateSetHash ||
    receipt.candidate_set_hash !== candidateSetHash ||
    result.candidate_set_hash !== candidateSetHash ||
    request.history_snapshot_hash !== historySnapshotHash ||
    receipt.history_snapshot_hash !== historySnapshotHash ||
    result.history_snapshot_hash !== historySnapshotHash ||
    request.policy_id !== MATERIAL_SELECTION_POLICY_V1.policy_id ||
    request.policy_version !== MATERIAL_SELECTION_POLICY_V1.policy_version ||
    receipt.policy_id !== MATERIAL_SELECTION_POLICY_V1.policy_id ||
    receipt.policy_version !== MATERIAL_SELECTION_POLICY_V1.policy_version ||
    request.policy_snapshot_hash !== policySnapshotHash ||
    receipt.policy_snapshot_hash !== policySnapshotHash ||
    result.policy_snapshot_hash !== policySnapshotHash ||
    result.decision_receipt_hash !== receiptHash
  ) {
    throw new Error('MATERIAL_SELECTION_COMMITTED_EVIDENCE_INTEGRITY_MISMATCH');
  }
  return { request, receipt, result };
}

export interface MaterialSelectionExecutionInputV1 {
  intent: MaterialSelectionIntentV1;
  /** Already validated as semantically eligible by Code C. Main never expands this set. */
  eligibleCandidates: readonly ShotSearchCandidateV1[];
}

export interface SupplementalMaterialSelectionExecutionInputV1 {
  source_selection_request_id: string;
  selection_request_id: string;
  batch_id: string;
  video_id: string;
  slot_id: string;
  material_family: 'ANIMAL' | 'PRODUCT';
}

function assertSameCandidateAuthority(
  source: MaterialSelectionRequestV1,
  target: MaterialSelectionRequestV1,
): void {
  if (
    target.candidate_set_id !== source.candidate_set_id ||
    target.candidate_set_contract_version !== source.candidate_set_contract_version ||
    target.candidate_set_hash !== source.candidate_set_hash ||
    stableCanonicalJson(target.candidates) !== stableCanonicalJson(source.candidates)
  ) {
    throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_FORK');
  }
}

export class MaterialSelectionService {
  readonly #repository: MaterialSelectionRepository;
  readonly #clock: () => string;

  constructor(options: { repository: MaterialSelectionRepository; clock?: () => string }) {
    this.#repository = options.repository;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  select(input: MaterialSelectionExecutionInputV1): MaterialSelectionResultV1 {
    const intent = materialSelectionIntentV1Schema.parse(input.intent);
    return this.#repository.runImmediate(() => {
      const committed = this.#repository.get(intent.selection_request_id);
      if (committed) return committed;
      const candidates = adaptCodeCCandidates(input.eligibleCandidates, intent.material_family);
      return this.#selectAndCommit(
        intent,
        candidates,
        computeMaterialCandidateSetHashV1(candidates),
      );
    });
  }

  selectFromCommittedCandidateSnapshot(
    input: SupplementalMaterialSelectionExecutionInputV1,
  ): MaterialSelectionResultV1 {
    if (input.selection_request_id === input.source_selection_request_id) {
      throw new Error('SUPPLEMENTAL_SELECTION_REQUEST_ID_REUSE');
    }
    return this.#repository.runImmediate(() => {
      const sourceStored = this.#repository.getCommittedEvidence(input.source_selection_request_id);
      if (!sourceStored) throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_NOT_FOUND');
      const source = verifyCommittedMaterialSelectionEvidenceV1(sourceStored);
      if (source.result.status !== 'SELECTED') {
        throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_MISMATCH');
      }
      const intent = materialSelectionIntentV1Schema.parse({
        schema_version: '1.0',
        selection_request_id: input.selection_request_id,
        batch_id: input.batch_id,
        video_id: input.video_id,
        slot_id: input.slot_id,
        material_family: input.material_family,
        candidate_set_id: source.request.candidate_set_id,
        candidate_set_contract_version: source.request.candidate_set_contract_version,
      });
      if (
        source.request.slot_id !== intent.slot_id ||
        source.request.material_family !== intent.material_family ||
        source.request.batch_id !== intent.batch_id ||
        source.request.video_id !== intent.video_id
      ) {
        throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_MISMATCH');
      }

      const committedStored = this.#repository.getCommittedEvidence(intent.selection_request_id);
      if (committedStored) {
        const committed = verifyCommittedMaterialSelectionEvidenceV1(committedStored);
        if (
          committed.request.batch_id !== intent.batch_id ||
          committed.request.video_id !== intent.video_id ||
          committed.request.slot_id !== intent.slot_id ||
          committed.request.material_family !== intent.material_family
        ) {
          throw new Error('SUPPLEMENTAL_SELECTION_IDEMPOTENCY_CONFLICT');
        }
        assertSameCandidateAuthority(source.request, committed.request);
        return committed.result;
      }
      return this.#selectAndCommit(
        intent,
        source.request.candidates,
        source.request.candidate_set_hash,
      );
    });
  }

  #selectAndCommit(
    intent: MaterialSelectionIntentV1,
    candidates: readonly MaterialCandidateV1[],
    candidateSetHash: string,
  ): MaterialSelectionResultV1 {
    const historySnapshot = this.#repository.listAuthoritativeUsage();
    const historySnapshotHash = computeMaterialUsageHistoryHashV1(historySnapshot);
    const policySnapshotHash = computeMaterialSelectionPolicyHashV1();
    const request = materialSelectionRequestV1Schema.parse({
      ...intent,
      candidates,
      usage_history_snapshot: historySnapshot,
      policy_id: MATERIAL_SELECTION_POLICY_V1.policy_id,
      policy_version: MATERIAL_SELECTION_POLICY_V1.policy_version,
      candidate_set_hash: candidateSetHash,
      history_snapshot_hash: historySnapshotHash,
      policy_snapshot_hash: policySnapshotHash,
    });
    const receipt = selectMaterial(request, MATERIAL_SELECTION_POLICY_V1);
    const result = materialSelectionResultV1Schema.parse({
      schema_version: '1.0',
      selection_request_id: receipt.selection_request_id,
      batch_id: receipt.batch_id,
      video_id: receipt.video_id,
      slot_id: receipt.slot_id,
      status: receipt.status,
      selected_asset_id: receipt.selected_asset_id,
      selected_shot_id: receipt.selected_shot_id,
      selected_semantic_rank: receipt.selected_semantic_rank,
      selected_semantic_score: receipt.selected_semantic_score,
      degradation_level: receipt.degradation_level,
      reason_codes: receipt.reason_codes,
      candidate_set_hash: receipt.candidate_set_hash,
      history_snapshot_hash: receipt.history_snapshot_hash,
      policy_snapshot_hash: receipt.policy_snapshot_hash,
      decision_receipt_hash: computeMaterialSelectionReceiptHashV1(receipt),
      committed_at: this.#clock(),
    });
    this.#repository.commit({ request, receipt, result });
    return result;
  }
}
