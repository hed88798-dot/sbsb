import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShotSearchCandidateV1 } from '@app/contracts';
import {
  computeMaterialCandidateSetHashV1,
  computeMaterialSelectionReceiptHashV1,
  stableCanonicalJson,
  verifyCommittedMaterialSelectionEvidenceV1,
} from '../../apps/desktop/src/main/material-selection-service.js';
import { deriveSupplementalSelectionRequestIdV1 } from '../../apps/desktop/src/main/timeline-orchestration-service.js';
import {
  E6TimelineFixture,
  e6DurationPolicy,
  e6Sha256,
  type CrashBeforeTimelineCommitRepository,
  type E6SlotInput,
} from '../helpers/e6-timeline-fixture.js';

let fixture: E6TimelineFixture;

beforeEach(async () => {
  fixture = new E6TimelineFixture();
  await fixture.open();
});

afterEach(() => fixture.close());

function supplementalSelectionId(
  timelineId: string,
  parentVersion: number,
  durationPlanHash: string,
  requirementId: string,
  sourceSelectionRequestId: string,
): string {
  const source = fixture.materialRepository.getCommittedEvidence(sourceSelectionRequestId)!;
  return deriveSupplementalSelectionRequestIdV1({
    timeline_id: timelineId,
    parent_version: parentVersion,
    parent_duration_plan_hash: durationPlanHash,
    requirement_id: requirementId,
    source_candidate_selection_request_id: sourceSelectionRequestId,
    source_candidate_set_hash: source.request.candidate_set_hash,
  });
}

function commitSyntheticInitialTimeline(
  options: { durationMs?: number; timelineId?: string } = {},
) {
  const timelineId = options.timelineId ?? 'e6_recovery_timeline';
  const durationMs = options.durationMs ?? 1000;
  const candidate = fixture.seedSyntheticCandidate('asset_initial', 'shot_initial', 300, 0.9);
  const decision = fixture.select('selection_initial', 'slot_initial', [candidate]);
  const slots: E6SlotInput[] = [
    { slotId: 'slot_initial', route: 'ANIMAL', startMs: 0, endMs: durationMs },
  ];
  const version = fixture.orchestration.planAndCommitVersion({
    timeline_id: timelineId,
    expected_parent_version: null,
    planning_request: fixture.planningRequest('planning_initial', slots, [
      fixture.selectedRef(decision),
    ]),
    duration_policy: e6DurationPolicy(),
    committed_no_match_refs: [],
  });
  return { timelineId, slots, decision, version };
}

describe('Code E E6 recovery and continuation closeout', () => {
  it('recovers crash boundaries A-D, advances V1 to V3, and preserves initial NO_MATCH', async () => {
    const slotA = fixture.seedSyntheticCandidate('asset_slot_a', 'shot_slot_a', 100, 0.99);
    const c1 = fixture.seedSyntheticCandidate('asset_c1', 'shot_c1', 300, 0.9);
    const c2 = fixture.seedSyntheticCandidate('asset_c2', 'shot_c2', 300, 0.8);
    const c3 = fixture.seedSyntheticCandidate('asset_c3', 'shot_c3', 400, 0.7);
    const dA = fixture.select('selection_slot_a', 'slot_a', [slotA]);
    const dNoMatch = fixture.select('selection_slot_b_no_match', 'slot_b', []);
    const d1 = fixture.select('selection_slot_c_initial', 'slot_c', [c1, c2, c3]);
    const slots: E6SlotInput[] = [
      { slotId: 'slot_a', route: 'ANIMAL', startMs: 0, endMs: 100 },
      { slotId: 'slot_b', route: 'ANIMAL', startMs: 100, endMs: 200 },
      { slotId: 'slot_c', route: 'ANIMAL', startMs: 200, endMs: 1200 },
    ];
    const v1 = fixture.orchestration.planAndCommitVersion({
      timeline_id: 'e6_chain',
      expected_parent_version: null,
      planning_request: fixture.planningRequest('planning_v1', slots, [
        fixture.selectedRef(dA),
        fixture.selectedRef(d1),
      ]),
      duration_policy: e6DurationPolicy(),
      committed_no_match_refs: [
        { slot_id: 'slot_b', selection_request_id: dNoMatch.selection_request_id },
      ],
    });
    const parentV1Bytes = stableCanonicalJson(v1);
    const requirementV1 = v1.duration_plan.additional_selection_requirements[0]!;
    const beforeCrashId = supplementalSelectionId(
      'e6_chain',
      1,
      v1.duration_plan.duration_plan_hash,
      requirementV1.requirement_id,
      d1.selection_request_id,
    );

    // A: no supplemental write occurred before restart; identity is derived from immutable V1.
    await fixture.restart();
    const afterRestartId = supplementalSelectionId(
      'e6_chain',
      1,
      v1.duration_plan.duration_plan_hash,
      requirementV1.requirement_id,
      d1.selection_request_id,
    );
    expect(afterRestartId).toBe(beforeCrashId);
    expect(fixture.materialRepository.getCommittedEvidence(beforeCrashId)).toBeNull();

    // B: commit D2, lose process state, then resume without creating another D decision.
    fixture.materialService.selectFromCommittedCandidateSnapshot({
      source_selection_request_id: d1.selection_request_id,
      selection_request_id: beforeCrashId,
      batch_id: 'e6_batch',
      video_id: 'e6_video',
      slot_id: 'slot_c',
      material_family: 'ANIMAL',
    });
    const dCountAfterD2 = fixture.database
      .prepare('SELECT count(*) FROM material_selection_decisions')
      .pluck()
      .get();
    await fixture.restart();
    const v2 = fixture.orchestration.continueAdditionalSelection({
      timeline_id: 'e6_chain',
      parent_version: 1,
      requirement_id: requirementV1.requirement_id,
    });
    expect(v2.version).toBe(2);
    expect(
      fixture.database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(dCountAfterD2);
    expect(v2.duration_plan.additional_selection_requirements).toHaveLength(1);
    const requirementV2 = v2.duration_plan.additional_selection_requirements[0]!;
    const initialNoMatchV2 = v2.planning_facts.slots.find((slot) => slot.slot_id === 'slot_b')!;
    expect(initialNoMatchV2.fallback).toMatchObject({
      source: 'CODE_D_SELECTION_NO_MATCH',
      selection_request_id: dNoMatch.selection_request_id,
    });

    // C: E2/E3 child bytes are calculated, then the simulated process dies before E4 commit.
    const crashRepository: CrashBeforeTimelineCommitRepository = fixture.createCrashRepository();
    crashRepository.captureNextCommit = true;
    const crashingOrchestration = fixture.createOrchestration(crashRepository);
    expect(() =>
      crashingOrchestration.continueAdditionalSelection({
        timeline_id: 'e6_chain',
        parent_version: 2,
        requirement_id: requirementV2.requirement_id,
      }),
    ).toThrowError('SIMULATED_CRASH_BEFORE_E4_COMMIT');
    const preCrashChild = crashRepository.capturedInput!;
    expect(fixture.timelineRepository.getLatest('e6_chain')!.version).toBe(2);

    await fixture.restart();
    const v3 = fixture.orchestration.continueAdditionalSelection({
      timeline_id: 'e6_chain',
      parent_version: 2,
      requirement_id: requirementV2.requirement_id,
    });
    expect(v3.version).toBe(3);
    expect(v3.planning_request.planning_request_id).toBe(
      preCrashChild.planning_request.planning_request_id,
    );
    expect(v3.planning_facts.planning_facts_hash).toBe(
      preCrashChild.planning_facts.planning_facts_hash,
    );
    expect(v3.duration_plan.duration_plan_hash).toBe(
      preCrashChild.duration_plan.duration_plan_hash,
    );
    expect(stableCanonicalJson(v3.planning_request)).toBe(
      stableCanonicalJson(preCrashChild.planning_request),
    );
    expect(stableCanonicalJson(v3.planning_facts)).toBe(
      stableCanonicalJson(preCrashChild.planning_facts),
    );
    expect(stableCanonicalJson(v3.duration_plan)).toBe(
      stableCanonicalJson(preCrashChild.duration_plan),
    );

    // D: lose the successful response and replay the exact already committed V3.
    const committedV3Bytes = stableCanonicalJson(v3);
    await fixture.restart();
    const replayedV3 = fixture.orchestration.continueAdditionalSelection({
      timeline_id: 'e6_chain',
      parent_version: 2,
      requirement_id: requirementV2.requirement_id,
    });
    expect(stableCanonicalJson(replayedV3)).toBe(committedV3Bytes);

    const versions = fixture.timelineRepository.listVersions('e6_chain');
    expect(versions.map((version) => [version.version, version.parent_version])).toEqual([
      [1, null],
      [2, 1],
      [3, 2],
    ]);
    expect(stableCanonicalJson(versions[0])).toBe(parentV1Bytes);
    expect(versions[1]).toEqual(v2);
    expect(versions[2]).toEqual(v3);
    for (const version of versions.slice(1)) {
      const slotB = version.planning_facts.slots.find((slot) => slot.slot_id === 'slot_b')!;
      expect(slotB.fallback).toEqual(initialNoMatchV2.fallback);
    }

    const slotCRequestIds = v3.planning_request.committed_selection_refs
      .filter((reference) => reference.selection_request_id !== dA.selection_request_id)
      .map((reference) => reference.selection_request_id);
    expect(new Set(slotCRequestIds).size).toBe(3);
    const slotCEvidence = slotCRequestIds.map(
      (requestId) => fixture.materialRepository.getCommittedEvidence(requestId)!,
    );
    expect(new Set(slotCEvidence.map((entry) => entry.request.candidate_set_hash)).size).toBe(1);
    expect(
      new Set(slotCEvidence.map((entry) => stableCanonicalJson(entry.request.candidates))).size,
    ).toBe(1);
    expect(new Set(slotCEvidence.map((entry) => entry.request.history_snapshot_hash)).size).toBe(3);
  });

  it('recovery E rejects a stale parent before creating a supplemental D decision', () => {
    const { timelineId, slots, decision, version: v1 } = commitSyntheticInitialTimeline();
    fixture.orchestration.planAndCommitVersion({
      timeline_id: timelineId,
      expected_parent_version: 1,
      planning_request: fixture.planningRequest('planning_unrelated_v2', slots, [
        fixture.selectedRef(decision),
      ]),
      duration_policy: e6DurationPolicy(),
      committed_no_match_refs: [],
    });
    const before = fixture.database
      .prepare('SELECT count(*) FROM material_selection_decisions')
      .pluck()
      .get();
    expect(() =>
      fixture.orchestration.continueAdditionalSelection({
        timeline_id: timelineId,
        parent_version: 1,
        requirement_id: v1.duration_plan.additional_selection_requirements[0]!.requirement_id,
      }),
    ).toThrowError('TIMELINE_CONTINUATION_PARENT_STALE');
    expect(
      fixture.database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(before);
  });

  it('recovery F preserves committed D history and fails closed when its child parent is stale', () => {
    const { timelineId, slots, decision, version: v1 } = commitSyntheticInitialTimeline();
    const requirement = v1.duration_plan.additional_selection_requirements[0]!;
    const supplementalId = supplementalSelectionId(
      timelineId,
      1,
      v1.duration_plan.duration_plan_hash,
      requirement.requirement_id,
      decision.selection_request_id,
    );
    fixture.materialService.selectFromCommittedCandidateSnapshot({
      source_selection_request_id: decision.selection_request_id,
      selection_request_id: supplementalId,
      batch_id: 'e6_batch',
      video_id: 'e6_video',
      slot_id: 'slot_initial',
      material_family: 'ANIMAL',
    });
    fixture.orchestration.planAndCommitVersion({
      timeline_id: timelineId,
      expected_parent_version: 1,
      planning_request: fixture.planningRequest('planning_unrelated_v2', slots, [
        fixture.selectedRef(decision),
      ]),
      duration_policy: e6DurationPolicy(),
      committed_no_match_refs: [],
    });
    expect(() =>
      fixture.orchestration.continueAdditionalSelection({
        timeline_id: timelineId,
        parent_version: 1,
        requirement_id: requirement.requirement_id,
      }),
    ).toThrowError('TIMELINE_CONTINUATION_VERSION_CONFLICT');
    expect(
      fixture.materialRepository.getCommittedEvidence(supplementalId)?.result.selection_request_id,
    ).toBe(supplementalId);
  });

  it('fails closed on a forked D2 candidate authority before creating D3', () => {
    const c1 = fixture.seedSyntheticCandidate('asset_f1', 'shot_f1', 300, 0.9);
    const c2 = fixture.seedSyntheticCandidate('asset_f2', 'shot_f2', 300, 0.8);
    const c3 = fixture.seedSyntheticCandidate('asset_f3', 'shot_f3', 400, 0.7);
    const d1 = fixture.select('selection_fork_d1', 'slot_fork', [c1, c2, c3]);
    const slots: E6SlotInput[] = [
      { slotId: 'slot_fork', route: 'ANIMAL', startMs: 0, endMs: 1200 },
    ];
    const v1 = fixture.orchestration.planAndCommitVersion({
      timeline_id: 'e6_fork',
      expected_parent_version: null,
      planning_request: fixture.planningRequest('planning_fork_v1', slots, [
        fixture.selectedRef(d1),
      ]),
      duration_policy: e6DurationPolicy(),
      committed_no_match_refs: [],
    });
    const v2 = fixture.orchestration.continueAdditionalSelection({
      timeline_id: 'e6_fork',
      parent_version: 1,
      requirement_id: v1.duration_plan.additional_selection_requirements[0]!.requirement_id,
    });
    const d2Id = v2.planning_request.committed_selection_refs[1]!.selection_request_id;
    const d2 = fixture.materialRepository.getCommittedEvidence(d2Id)!;
    const candidates = structuredClone(d2.request.candidates);
    candidates[0] = {
      ...candidates[0]!,
      metadata: { ...candidates[0]!.metadata, injected_fork_marker: true },
    };
    const forkedCandidateHash = computeMaterialCandidateSetHashV1(candidates);
    expect(forkedCandidateHash).not.toBe(d2.request.candidate_set_hash);
    const request = { ...d2.request, candidates, candidate_set_hash: forkedCandidateHash };
    const receipt = { ...d2.receipt, candidate_set_hash: forkedCandidateHash };
    const receiptHash = computeMaterialSelectionReceiptHashV1(receipt);
    const result = {
      ...d2.result,
      candidate_set_hash: forkedCandidateHash,
      decision_receipt_hash: receiptHash,
    };
    fixture.database
      .prepare(
        `UPDATE material_selection_decisions
         SET candidate_set_hash = ?, decision_receipt_hash = ?,
             request_json = ?, decision_receipt_json = ?, result_json = ?
         WHERE selection_request_id = ?`,
      )
      .run(
        forkedCandidateHash,
        receiptHash,
        stableCanonicalJson(request),
        stableCanonicalJson(receipt),
        stableCanonicalJson(result),
        d2Id,
      );
    expect(
      verifyCommittedMaterialSelectionEvidenceV1(
        fixture.materialRepository.getCommittedEvidence(d2Id)!,
      ).request.candidate_set_hash,
    ).toBe(forkedCandidateHash);

    const before = fixture.database
      .prepare('SELECT count(*) FROM material_selection_decisions')
      .pluck()
      .get();
    expect(() =>
      fixture.orchestration.continueAdditionalSelection({
        timeline_id: 'e6_fork',
        parent_version: 2,
        requirement_id: v2.duration_plan.additional_selection_requirements[0]!.requirement_id,
      }),
    ).toThrowError('SUPPLEMENTAL_CANDIDATE_AUTHORITY_FORK');
    expect(
      fixture.database.prepare('SELECT count(*) FROM material_selection_decisions').pluck().get(),
    ).toBe(before);
  });
});

const realFileName = '猪_喝水_户外猪场_泥水坑_02.mp4';
const realFilePath = join(homedir(), 'Desktop', 'ai视频', realFileName);

describe('Code E E6 read-only real Code C/D provenance smoke', () => {
  it.skipIf(!existsSync(realFilePath))(
    'binds the authorized historical file through frozen Code C facts, committed D, and E5',
    () => {
      const root = resolve(import.meta.dirname, '../..');
      const corpusMap = readFileSync(
        resolve(
          root,
          'compliance/functional-acceptance/2026-09-09/v3/evidence/inputs/corpus-map-v3.csv',
        ),
        'utf8',
      );
      const expectedFileHash = '3a9c8026c5b83cd27ed9fa3ca0a72c21ac9f32312766a32267a57f392552162e';
      expect(corpusMap).toContain(
        `"v2_asset_084","${realFileName}","${expectedFileHash}","5549697","PASS",""`,
      );
      expect(e6Sha256(readFileSync(realFilePath))).toBe(expectedFileHash);

      const source = JSON.parse(
        readFileSync(
          resolve(
            root,
            'tests/fixtures/material-selection/code-d-gq006-eligible-candidates-v1.json',
          ),
          'utf8',
        ),
      ) as {
        eligible_candidates: Array<{
          asset_id: string;
          shot_id: string;
          semantic_score: number;
          start_ms: number;
          end_ms: number;
        }>;
      };
      const candidates: ShotSearchCandidateV1[] = source.eligible_candidates.map((entry) => ({
        schema_version: '1.0',
        ...entry,
        revision: 1,
        descriptor: {
          schema_version: '1.0',
          shot_id: entry.shot_id,
          species: ['pig'],
          scene: 'farm',
          action: ['drinking'],
          health_state: 'unknown',
          people_present: false,
          product_present: false,
          shot_type: 'unknown',
          description: 'pig drinking water',
          quality: { score: 0.8, blur: 0.1, dark: 0.1, overexposed: 0 },
          embedding_ref: `embedding_${entry.shot_id}`,
          industry_metadata: {},
          confidence: {},
          provenance: { source: 'code-c-v3' },
          evidence: {},
        },
      }));
      const selectedCandidate = candidates.find(
        (candidate) => candidate.asset_id === 'v2_asset_084',
      )!;
      fixture.registerHistoricalMedia({
        assetId: selectedCandidate.asset_id,
        revision: selectedCandidate.revision!,
        shotId: selectedCandidate.shot_id,
        startMs: selectedCandidate.start_ms!,
        endMs: selectedCandidate.end_ms!,
        sourcePath: realFilePath,
        expectedFileHash,
      });
      const decision = fixture.select(
        'e6_real_gq006_selection_v1',
        'slot_real_gq006',
        candidates,
        'code-c-v3-gq006-short-zh',
      );
      expect(decision).toMatchObject({
        status: 'SELECTED',
        selected_asset_id: 'v2_asset_084',
        selected_shot_id: 'shot_c66c5bd2-25c8-562e-ac29-3c88c847f8c6',
      });
      const committedEvidence = fixture.materialRepository.getCommittedEvidence(
        decision.selection_request_id,
      )!;
      expect(committedEvidence.request).toMatchObject({
        candidate_set_id: 'code-c-v3-gq006-short-zh',
        candidate_set_contract_version: 'code-c-shot-search-v1',
        candidate_set_hash: '8611fedd5ff52f15784f1b84772d01ade455146795dc1721d716639d42a2280f',
      });
      expect(decision.decision_receipt_hash).toBe(
        '9187616a782e7f80a6a77ba95350541844af97156d45a8044dfe06096ec79148',
      );
      expect(committedEvidence.request.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            asset_id: 'v2_asset_084',
            revision: 1,
            shot_id: 'shot_c66c5bd2-25c8-562e-ac29-3c88c847f8c6',
            start_ms: 0,
            end_ms: 5167,
          }),
        ]),
      );
      const timeline = fixture.orchestration.planAndCommitVersion({
        timeline_id: 'e6_real_timeline',
        expected_parent_version: null,
        planning_request: fixture.planningRequest(
          'e6_real_planning_v1',
          [{ slotId: 'slot_real_gq006', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
          [fixture.selectedRef(decision)],
        ),
        duration_policy: e6DurationPolicy(),
        committed_no_match_refs: [],
      });
      expect(timeline.duration_plan.segments[0]).toMatchObject({
        source_asset_id: 'v2_asset_084',
        source_revision: 1,
        source_shot_id: 'shot_c66c5bd2-25c8-562e-ac29-3c88c847f8c6',
        source_start_ms: 0,
        source_end_ms: 1000,
        selection_request_id: decision.selection_request_id,
        decision_receipt_hash: decision.decision_receipt_hash,
      });
    },
  );
});
