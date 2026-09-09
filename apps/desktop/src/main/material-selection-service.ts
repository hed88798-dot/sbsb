import { createHash } from 'node:crypto';
import {
  materialSelectionIntentV1Schema,
  materialSelectionResultV1Schema,
  type MaterialSelectionIntentV1,
  type MaterialSelectionResultV1,
  type ShotSearchCandidateV1,
} from '@app/contracts';
import {
  MATERIAL_SELECTION_POLICY_V1,
  adaptCodeCCandidates,
  selectMaterial,
} from '@app/domain-auto-edit';
import type { MaterialSelectionRepository } from '@app/local-db';

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

export function stableSha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export interface MaterialSelectionExecutionInputV1 {
  intent: MaterialSelectionIntentV1;
  /** Already validated as semantically eligible by Code C. Main never expands this set. */
  eligibleCandidates: readonly ShotSearchCandidateV1[];
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
      const historySnapshot = this.#repository.listAuthoritativeUsage();
      const candidateSetHash = stableSha256(
        [...candidates].sort(
          (left, right) =>
            compareStableText(left.asset_id, right.asset_id) ||
            compareStableText(left.shot_id, right.shot_id),
        ),
      );
      const historySnapshotHash = stableSha256(historySnapshot);
      const policySnapshotHash = stableSha256(MATERIAL_SELECTION_POLICY_V1);
      const request = {
        ...intent,
        candidates,
        usage_history_snapshot: historySnapshot,
        policy_id: MATERIAL_SELECTION_POLICY_V1.policy_id,
        policy_version: MATERIAL_SELECTION_POLICY_V1.policy_version,
        candidate_set_hash: candidateSetHash,
        history_snapshot_hash: historySnapshotHash,
        policy_snapshot_hash: policySnapshotHash,
      };
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
        decision_receipt_hash: stableSha256(receipt),
        committed_at: this.#clock(),
      });
      this.#repository.commit({ request, receipt, result });
      return result;
    });
  }
}
