CREATE TABLE material_selection_decisions (
  selection_request_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  material_family TEXT NOT NULL CHECK(material_family IN ('ANIMAL', 'PRODUCT')),
  status TEXT NOT NULL CHECK(status IN ('SELECTED', 'NO_MATCH')),
  selected_asset_id TEXT,
  selected_shot_id TEXT,
  selected_semantic_rank INTEGER CHECK(selected_semantic_rank IS NULL OR selected_semantic_rank > 0),
  selected_semantic_score REAL,
  degradation_level INTEGER NOT NULL CHECK(degradation_level >= 0),
  reason_codes_json TEXT NOT NULL,
  candidate_set_id TEXT NOT NULL,
  candidate_set_contract_version TEXT NOT NULL,
  candidate_set_hash TEXT NOT NULL,
  history_snapshot_hash TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_snapshot_hash TEXT NOT NULL,
  decision_receipt_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  decision_receipt_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  CHECK(
    (status = 'SELECTED'
      AND selected_asset_id IS NOT NULL
      AND selected_shot_id IS NOT NULL
      AND selected_semantic_rank IS NOT NULL
      AND selected_semantic_score IS NOT NULL)
    OR
    (status = 'NO_MATCH'
      AND selected_asset_id IS NULL
      AND selected_shot_id IS NULL
      AND selected_semantic_rank IS NULL
      AND selected_semantic_score IS NULL
      AND degradation_level = 0)
  )
);

CREATE INDEX idx_material_selection_batch ON material_selection_decisions(batch_id, committed_at, selection_request_id);
CREATE INDEX idx_material_selection_selected_asset ON material_selection_decisions(selected_asset_id, committed_at)
  WHERE status = 'SELECTED';
CREATE INDEX idx_material_selection_selected_shot ON material_selection_decisions(selected_shot_id, committed_at)
  WHERE status = 'SELECTED';
