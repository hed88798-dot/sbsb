import type {
  CommittedMaterialSelectionRefV1,
  MaterialCandidateV1,
  TimelinePlanningRequestV1,
} from '@app/contracts';
import type {
  CommittedMaterialSelectionEvidenceV1,
  CommittedTimelinePlanVersionV1,
  MaterialSelectionRepository,
  MediaIndexRepository,
  TimelinePlanRepository,
} from '@app/local-db';
import {
  computeTimelinePlanningRequestHash,
  normalizeTimelinePlanningFactsV1,
  parseTimelineDurationPolicyV1,
  parseTimelinePlanningRequestV1,
  planTimelineDurationV1,
  type ResolvedMaterialDecisionEvidenceV1,
  type TimelineAdditionalSelectionRequirementV1,
  type TimelineDurationPlanV1,
  type TimelineDurationPolicyV1,
  type TimelineMaterialSlotPlanningFactV1,
} from '@app/timeline';
import { resolveTimelineSupplementalNoMatchV1 } from '@app/timeline/supplemental-no-match';
import {
  stableCanonicalJson,
  stableSha256,
  type MaterialSelectionService,
  verifyCommittedMaterialSelectionEvidenceV1,
} from './material-selection-service.js';

export interface CommittedNoMatchDecisionRefV1 {
  slot_id: string;
  selection_request_id: string;
}

export interface TimelinePlanAndCommitVersionInputV1 {
  timeline_id: string;
  expected_parent_version: number | null;
  planning_request: TimelinePlanningRequestV1;
  duration_policy: TimelineDurationPolicyV1;
  committed_no_match_refs: readonly CommittedNoMatchDecisionRefV1[];
}

export interface TimelineContinueAdditionalSelectionInputV1 {
  timeline_id: string;
  parent_version: number;
  requirement_id: string;
}

interface ChildArtifacts {
  planningRequest: TimelinePlanningRequestV1;
  resolvedDecisions: ResolvedMaterialDecisionEvidenceV1[];
  durationPlan: TimelineDurationPlanV1;
}

function identity(value: string, code: string): string {
  if (value.length === 0 || value.length > 256 || value.trim() !== value) throw new Error(code);
  return value;
}

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(code);
  return value;
}

function exactCandidate(evidence: CommittedMaterialSelectionEvidenceV1): MaterialCandidateV1 {
  if (evidence.result.status !== 'SELECTED') {
    throw new Error('SELECTED_EXACT_CANDIDATE_NOT_RECOVERABLE');
  }
  const matches = evidence.request.candidates.filter(
    (candidate) =>
      candidate.asset_id === evidence.result.selected_asset_id &&
      candidate.shot_id === evidence.result.selected_shot_id,
  );
  const candidate = matches[0];
  if (
    matches.length !== 1 ||
    !candidate ||
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision === undefined ||
    candidate.revision < 1 ||
    !Number.isSafeInteger(candidate.start_ms) ||
    candidate.start_ms === undefined ||
    candidate.start_ms < 0 ||
    !Number.isSafeInteger(candidate.end_ms) ||
    candidate.end_ms === undefined ||
    candidate.end_ms <= candidate.start_ms
  ) {
    throw new Error('SELECTED_EXACT_CANDIDATE_NOT_RECOVERABLE');
  }
  return candidate;
}

function sameCandidateAuthority(
  source: CommittedMaterialSelectionEvidenceV1,
  evidence: CommittedMaterialSelectionEvidenceV1,
): boolean {
  return (
    evidence.request.candidate_set_id === source.request.candidate_set_id &&
    evidence.request.candidate_set_contract_version ===
      source.request.candidate_set_contract_version &&
    evidence.request.candidate_set_hash === source.request.candidate_set_hash &&
    stableCanonicalJson(evidence.request.candidates) ===
      stableCanonicalJson(source.request.candidates)
  );
}

export function deriveSupplementalSelectionRequestIdV1(input: {
  timeline_id: string;
  parent_version: number;
  parent_duration_plan_hash: string;
  requirement_id: string;
  source_candidate_selection_request_id: string;
  source_candidate_set_hash: string;
}): string {
  return `timeline-supplemental-selection-${stableSha256({
    purpose: 'timeline-supplemental-selection-v1',
    ...input,
  })}`;
}

export function deriveSupplementalPlanningRequestIdV1(input: {
  timeline_id: string;
  parent_version: number;
  parent_commit_receipt_hash: string;
  parent_duration_plan_hash: string;
  requirement_id: string;
  supplemental_selection_request_id: string;
  supplemental_decision_receipt_hash: string;
}): string {
  return `timeline-supplemental-planning-${stableSha256({
    purpose: 'timeline-supplemental-planning-v1',
    ...input,
  })}`;
}

export class TimelineOrchestrationService {
  readonly #materialSelectionRepository: MaterialSelectionRepository;
  readonly #mediaIndexRepository: MediaIndexRepository;
  readonly #timelinePlanRepository: TimelinePlanRepository;
  readonly #materialSelectionService: MaterialSelectionService;

  constructor(options: {
    materialSelectionRepository: MaterialSelectionRepository;
    mediaIndexRepository: MediaIndexRepository;
    timelinePlanRepository: TimelinePlanRepository;
    materialSelectionService: MaterialSelectionService;
  }) {
    this.#materialSelectionRepository = options.materialSelectionRepository;
    this.#mediaIndexRepository = options.mediaIndexRepository;
    this.#timelinePlanRepository = options.timelinePlanRepository;
    this.#materialSelectionService = options.materialSelectionService;
  }

  planAndCommitVersion(input: TimelinePlanAndCommitVersionInputV1): CommittedTimelinePlanVersionV1 {
    const timelineId = identity(input.timeline_id, 'TIMELINE_ORCHESTRATION_INPUT_INVALID');
    const planningRequest = parseTimelinePlanningRequestV1(input.planning_request);
    const durationPolicy = parseTimelineDurationPolicyV1(input.duration_policy);
    const resolvedDecisions = this.#resolveInitialDecisions(
      planningRequest,
      input.committed_no_match_refs,
      true,
    );
    const planningFacts = normalizeTimelinePlanningFactsV1({
      request: planningRequest,
      resolved_material_decisions: resolvedDecisions,
    });
    const durationPlan = planTimelineDurationV1({
      planning_facts: planningFacts,
      duration_policy: durationPolicy,
    });
    return this.#timelinePlanRepository.commitVersion({
      timeline_id: timelineId,
      expected_parent_version: input.expected_parent_version,
      planning_request: planningRequest,
      planning_facts: planningFacts,
      duration_policy: durationPolicy,
      duration_plan: durationPlan,
    });
  }

  continueAdditionalSelection(
    input: TimelineContinueAdditionalSelectionInputV1,
  ): CommittedTimelinePlanVersionV1 {
    const timelineId = identity(input.timeline_id, 'TIMELINE_CONTINUATION_INPUT_INVALID');
    const parentVersion = positiveInteger(
      input.parent_version,
      'TIMELINE_CONTINUATION_INPUT_INVALID',
    );
    const requirementId = identity(input.requirement_id, 'TIMELINE_CONTINUATION_INPUT_INVALID');
    const parent = this.#timelinePlanRepository.getVersion(timelineId, parentVersion);
    if (!parent) throw new Error('TIMELINE_CONTINUATION_PARENT_NOT_FOUND');
    const requirement = this.#uniqueAdditionalRequirement(parent.duration_plan, requirementId);
    const sourceMaterial = this.#firstAuthoritativeSelectedMaterial(parent, requirement);
    const sourceEvidence = this.#getVerifiedEvidence(sourceMaterial.selection_request_id);
    this.#assertSourceCandidateAuthority(parent, requirement, sourceEvidence);
    this.#assertSupplementalCandidateAuthorityChain(parent, requirement, sourceEvidence);

    const supplementalSelectionRequestId = deriveSupplementalSelectionRequestIdV1({
      timeline_id: timelineId,
      parent_version: parentVersion,
      parent_duration_plan_hash: parent.duration_plan.duration_plan_hash,
      requirement_id: requirement.requirement_id,
      source_candidate_selection_request_id: sourceEvidence.request.selection_request_id,
      source_candidate_set_hash: sourceEvidence.request.candidate_set_hash,
    });
    let supplementalEvidence = this.#getOptionalVerifiedEvidence(supplementalSelectionRequestId);
    if (!supplementalEvidence) {
      const latest = this.#timelinePlanRepository.getLatest(timelineId);
      if (!latest || latest.version !== parentVersion) {
        throw new Error('TIMELINE_CONTINUATION_PARENT_STALE');
      }
      this.#assertAllCandidatesExecutable(sourceEvidence.request.candidates);
      this.#materialSelectionService.selectFromCommittedCandidateSnapshot({
        source_selection_request_id: sourceEvidence.request.selection_request_id,
        selection_request_id: supplementalSelectionRequestId,
        batch_id: sourceEvidence.request.batch_id,
        video_id: sourceEvidence.request.video_id,
        slot_id: requirement.slot_id,
        material_family: requirement.route,
      });
      supplementalEvidence = this.#getVerifiedEvidence(supplementalSelectionRequestId);
    }
    this.#assertSupplementalDecisionAuthority(supplementalEvidence, sourceEvidence, requirement);

    const childPlanningRequestId = deriveSupplementalPlanningRequestIdV1({
      timeline_id: timelineId,
      parent_version: parentVersion,
      parent_commit_receipt_hash: parent.commit_receipt.commit_receipt_hash,
      parent_duration_plan_hash: parent.duration_plan.duration_plan_hash,
      requirement_id: requirement.requirement_id,
      supplemental_selection_request_id: supplementalEvidence.result.selection_request_id,
      supplemental_decision_receipt_hash: supplementalEvidence.result.decision_receipt_hash,
    });
    const expectedChild = this.#buildChildArtifacts(
      parent,
      requirement,
      supplementalEvidence,
      childPlanningRequestId,
      false,
    );
    const committedChild =
      this.#timelinePlanRepository.getByPlanningRequestId(childPlanningRequestId);
    if (committedChild) {
      this.#assertCommittedChildReplay(committedChild, timelineId, parentVersion, expectedChild);
      return committedChild;
    }

    const latestAfterDecision = this.#timelinePlanRepository.getLatest(timelineId);
    if (!latestAfterDecision || latestAfterDecision.version !== parentVersion) {
      throw new Error('TIMELINE_CONTINUATION_VERSION_CONFLICT');
    }
    if (supplementalEvidence.result.status === 'SELECTED') {
      try {
        this.#resolvedSelected(supplementalEvidence, true);
      } catch {
        throw new Error('SUPPLEMENTAL_SELECTED_MEDIA_NOT_EXECUTABLE');
      }
    }
    const child = this.#buildChildArtifacts(
      parent,
      requirement,
      supplementalEvidence,
      childPlanningRequestId,
      true,
    );
    try {
      return this.#timelinePlanRepository.commitVersion({
        timeline_id: timelineId,
        expected_parent_version: parentVersion,
        planning_request: child.planningRequest,
        planning_facts: normalizeTimelinePlanningFactsV1({
          request: child.planningRequest,
          resolved_material_decisions: child.resolvedDecisions,
        }),
        duration_policy: parent.duration_policy,
        duration_plan: child.durationPlan,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'TIMELINE_PLAN_VERSION_CONFLICT') {
        throw new Error('TIMELINE_CONTINUATION_VERSION_CONFLICT', { cause: error });
      }
      throw error;
    }
  }

  #getOptionalVerifiedEvidence(
    selectionRequestId: string,
  ): CommittedMaterialSelectionEvidenceV1 | null {
    const evidence = this.#materialSelectionRepository.getCommittedEvidence(selectionRequestId);
    return evidence ? verifyCommittedMaterialSelectionEvidenceV1(evidence) : null;
  }

  #getVerifiedEvidence(selectionRequestId: string): CommittedMaterialSelectionEvidenceV1 {
    const evidence = this.#getOptionalVerifiedEvidence(selectionRequestId);
    if (!evidence) throw new Error('COMMITTED_MATERIAL_SELECTION_EVIDENCE_NOT_FOUND');
    return evidence;
  }

  #assertCandidateExecutable(candidate: MaterialCandidateV1): void {
    if (
      candidate.revision === undefined ||
      candidate.start_ms === undefined ||
      candidate.end_ms === undefined
    ) {
      throw new Error('SUPPLEMENTAL_CANDIDATE_SNAPSHOT_NOT_EXECUTABLE');
    }
    this.#mediaIndexRepository.assertExactShotExecutable({
      asset_id: candidate.asset_id,
      revision: candidate.revision,
      shot_id: candidate.shot_id,
      start_ms: candidate.start_ms,
      end_ms: candidate.end_ms,
    });
  }

  #assertAllCandidatesExecutable(candidates: readonly MaterialCandidateV1[]): void {
    try {
      for (const candidate of candidates) this.#assertCandidateExecutable(candidate);
    } catch {
      throw new Error('SUPPLEMENTAL_CANDIDATE_SNAPSHOT_NOT_EXECUTABLE');
    }
  }

  #resolvedSelected(
    evidence: CommittedMaterialSelectionEvidenceV1,
    verifyMedia: boolean,
  ): ResolvedMaterialDecisionEvidenceV1 {
    const candidate = exactCandidate(evidence);
    if (verifyMedia) {
      this.#mediaIndexRepository.assertExactShotExecutable({
        asset_id: candidate.asset_id,
        revision: candidate.revision!,
        shot_id: candidate.shot_id,
        start_ms: candidate.start_ms!,
        end_ms: candidate.end_ms!,
      });
    }
    return {
      selection_request_id: evidence.result.selection_request_id,
      decision_receipt_hash: evidence.result.decision_receipt_hash,
      batch_id: evidence.result.batch_id,
      video_id: evidence.result.video_id,
      slot_id: evidence.result.slot_id,
      status: 'SELECTED',
      asset_id: candidate.asset_id,
      shot_id: candidate.shot_id,
      revision: candidate.revision!,
      shot_start_ms: candidate.start_ms!,
      shot_end_ms: candidate.end_ms!,
    };
  }

  #resolvedNoMatch(
    evidence: CommittedMaterialSelectionEvidenceV1,
  ): ResolvedMaterialDecisionEvidenceV1 {
    if (evidence.result.status !== 'NO_MATCH') {
      throw new Error('EXPLICIT_NO_MATCH_DECISION_REQUIRED');
    }
    return {
      selection_request_id: evidence.result.selection_request_id,
      decision_receipt_hash: evidence.result.decision_receipt_hash,
      batch_id: evidence.result.batch_id,
      video_id: evidence.result.video_id,
      slot_id: evidence.result.slot_id,
      status: 'NO_MATCH',
    };
  }

  #resolveSelectedReferences(
    planningRequest: TimelinePlanningRequestV1,
    verifyMedia: boolean,
  ): ResolvedMaterialDecisionEvidenceV1[] {
    const slotById = new Map(
      planningRequest.confirmed_shot_plan.slots.map((slot) => [slot.slot_id, slot]),
    );
    return planningRequest.committed_selection_refs.map((reference) => {
      const evidence = this.#getVerifiedEvidence(reference.selection_request_id);
      const slot = slotById.get(evidence.result.slot_id);
      if (
        evidence.result.status !== 'SELECTED' ||
        evidence.result.decision_receipt_hash !== reference.decision_receipt_hash ||
        evidence.result.selected_asset_id !== reference.asset_id ||
        evidence.result.selected_shot_id !== reference.shot_id ||
        !slot ||
        slot.route === 'NO_MATCH' ||
        evidence.request.material_family !== slot.route
      ) {
        throw new Error('COMMITTED_SELECTED_REFERENCE_MISMATCH');
      }
      return this.#resolvedSelected(evidence, verifyMedia);
    });
  }

  #resolveInitialDecisions(
    planningRequest: TimelinePlanningRequestV1,
    noMatchRefs: readonly CommittedNoMatchDecisionRefV1[],
    verifyMedia: boolean,
  ): ResolvedMaterialDecisionEvidenceV1[] {
    const selected = this.#resolveSelectedReferences(planningRequest, verifyMedia);
    const selectedSlots = new Set(selected.map((evidence) => evidence.slot_id));
    const noMatchBySlot = new Map<string, CommittedNoMatchDecisionRefV1>();
    const noMatchSelectionIds = new Set<string>();
    for (const reference of noMatchRefs) {
      identity(reference.slot_id, 'EXPLICIT_NO_MATCH_REFERENCE_INVALID');
      identity(reference.selection_request_id, 'EXPLICIT_NO_MATCH_REFERENCE_INVALID');
      if (
        noMatchBySlot.has(reference.slot_id) ||
        noMatchSelectionIds.has(reference.selection_request_id)
      ) {
        throw new Error('EXPLICIT_NO_MATCH_REFERENCE_INVALID');
      }
      noMatchBySlot.set(reference.slot_id, reference);
      noMatchSelectionIds.add(reference.selection_request_id);
    }
    const noMatches: ResolvedMaterialDecisionEvidenceV1[] = [];
    for (const slot of planningRequest.confirmed_shot_plan.slots) {
      const explicit = noMatchBySlot.get(slot.slot_id);
      if (slot.route === 'NO_MATCH') {
        if (explicit || selectedSlots.has(slot.slot_id)) {
          throw new Error('UNEXPECTED_DECISION_FOR_UPSTREAM_NO_MATCH_SLOT');
        }
        continue;
      }
      if (selectedSlots.has(slot.slot_id)) {
        if (explicit) throw new Error('CONFLICTING_FINAL_OUTCOME_FOR_SAME_SLOT');
        continue;
      }
      if (!explicit) throw new Error('INITIAL_NO_MATCH_EXPLICIT_CARRIER_REQUIRED');
      const evidence = this.#getVerifiedEvidence(explicit.selection_request_id);
      if (
        evidence.result.slot_id !== explicit.slot_id ||
        evidence.result.status !== 'NO_MATCH' ||
        evidence.request.material_family !== slot.route
      ) {
        throw new Error('EXPLICIT_NO_MATCH_DECISION_MISMATCH');
      }
      noMatches.push(this.#resolvedNoMatch(evidence));
      noMatchBySlot.delete(slot.slot_id);
    }
    if (noMatchBySlot.size > 0) throw new Error('EXPLICIT_NO_MATCH_REFERENCE_UNKNOWN_SLOT');
    return [...selected, ...noMatches];
  }

  #uniqueAdditionalRequirement(
    plan: TimelineDurationPlanV1,
    requirementId: string,
  ): TimelineAdditionalSelectionRequirementV1 {
    const matches = plan.additional_selection_requirements.filter(
      (requirement) => requirement.requirement_id === requirementId,
    );
    if (matches.length !== 1) throw new Error('TIMELINE_ADDITIONAL_REQUIREMENT_NOT_FOUND');
    return matches[0]!;
  }

  #firstAuthoritativeSelectedMaterial(
    parent: CommittedTimelinePlanVersionV1,
    requirement: TimelineAdditionalSelectionRequirementV1,
  ) {
    const slot = parent.planning_facts.slots.find(
      (entry): entry is TimelineMaterialSlotPlanningFactV1 =>
        entry.slot_id === requirement.slot_id &&
        entry.route !== 'NO_MATCH' &&
        entry.fallback === null,
    );
    if (
      !slot ||
      slot.route !== requirement.route ||
      slot.visual_continuity_group_id !== requirement.visual_continuity_group_id
    ) {
      throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_MISMATCH');
    }
    const material = slot?.selected_materials[0];
    if (!material) throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_NOT_FOUND');
    return material;
  }

  #assertSourceCandidateAuthority(
    parent: CommittedTimelinePlanVersionV1,
    requirement: TimelineAdditionalSelectionRequirementV1,
    source: CommittedMaterialSelectionEvidenceV1,
  ): void {
    const context = parent.planning_facts.material_context;
    if (
      source.result.status !== 'SELECTED' ||
      source.request.slot_id !== requirement.slot_id ||
      source.request.material_family !== requirement.route ||
      !context ||
      source.request.batch_id !== context.batch_id ||
      source.request.video_id !== context.video_id
    ) {
      throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_MISMATCH');
    }
  }

  #assertSupplementalCandidateAuthorityChain(
    parent: CommittedTimelinePlanVersionV1,
    requirement: TimelineAdditionalSelectionRequirementV1,
    source: CommittedMaterialSelectionEvidenceV1,
  ): void {
    const slot = parent.planning_facts.slots.find(
      (entry): entry is TimelineMaterialSlotPlanningFactV1 =>
        entry.slot_id === requirement.slot_id &&
        entry.route !== 'NO_MATCH' &&
        entry.fallback === null,
    );
    if (!slot) throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_NOT_FOUND');
    for (const material of slot.selected_materials) {
      const evidence = this.#getVerifiedEvidence(material.selection_request_id);
      if (
        evidence.result.status !== 'SELECTED' ||
        evidence.result.slot_id !== material.slot_id ||
        evidence.result.decision_receipt_hash !== material.decision_receipt_hash ||
        evidence.result.selected_asset_id !== material.asset_id ||
        evidence.result.selected_shot_id !== material.shot_id ||
        !sameCandidateAuthority(source, evidence)
      ) {
        throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_FORK');
      }
    }
  }

  #assertSupplementalDecisionAuthority(
    supplemental: CommittedMaterialSelectionEvidenceV1,
    source: CommittedMaterialSelectionEvidenceV1,
    requirement: TimelineAdditionalSelectionRequirementV1,
  ): void {
    if (
      supplemental.request.slot_id !== requirement.slot_id ||
      supplemental.request.material_family !== requirement.route ||
      supplemental.request.batch_id !== source.request.batch_id ||
      supplemental.request.video_id !== source.request.video_id ||
      !sameCandidateAuthority(source, supplemental)
    ) {
      throw new Error('SUPPLEMENTAL_CANDIDATE_AUTHORITY_FORK');
    }
  }

  #restoreParentInitialNoMatches(
    parent: CommittedTimelinePlanVersionV1,
  ): ResolvedMaterialDecisionEvidenceV1[] {
    const restored: ResolvedMaterialDecisionEvidenceV1[] = [];
    for (const slot of parent.planning_facts.slots) {
      const fallback = slot.fallback;
      if (!fallback || fallback.source !== 'CODE_D_SELECTION_NO_MATCH') continue;
      const matchingFallbacks = parent.duration_plan.fallback_requirements.filter(
        (requirement) =>
          requirement.source === 'CODE_D_SELECTION_NO_MATCH' &&
          requirement.slot_id === slot.slot_id &&
          requirement.timeline_start_ms === slot.timeline_start_ms &&
          requirement.timeline_end_ms === slot.timeline_end_ms &&
          requirement.committed_no_match?.selection_request_id === fallback.selection_request_id &&
          requirement.committed_no_match.decision_receipt_hash === fallback.decision_receipt_hash &&
          requirement.committed_no_match.batch_id === fallback.batch_id &&
          requirement.committed_no_match.video_id === fallback.video_id,
      );
      if (matchingFallbacks.length !== 1) {
        throw new Error('PARENT_INITIAL_NO_MATCH_AUTHORITY_UNRECOVERABLE');
      }
      let evidence: CommittedMaterialSelectionEvidenceV1;
      try {
        evidence = this.#getVerifiedEvidence(fallback.selection_request_id);
      } catch {
        throw new Error('PARENT_INITIAL_NO_MATCH_AUTHORITY_UNRECOVERABLE');
      }
      if (
        evidence.result.status !== 'NO_MATCH' ||
        evidence.result.decision_receipt_hash !== fallback.decision_receipt_hash ||
        evidence.result.batch_id !== fallback.batch_id ||
        evidence.result.video_id !== fallback.video_id ||
        evidence.result.slot_id !== fallback.slot_id
      ) {
        throw new Error('PARENT_INITIAL_NO_MATCH_AUTHORITY_UNRECOVERABLE');
      }
      restored.push(this.#resolvedNoMatch(evidence));
    }
    return restored;
  }

  #childPlanningRequest(
    parent: CommittedTimelinePlanVersionV1,
    planningRequestId: string,
    supplemental: CommittedMaterialSelectionEvidenceV1,
  ): TimelinePlanningRequestV1 {
    const refs: CommittedMaterialSelectionRefV1[] =
      supplemental.result.status === 'SELECTED'
        ? [
            ...parent.planning_request.committed_selection_refs,
            {
              selection_request_id: supplemental.result.selection_request_id,
              decision_receipt_hash: supplemental.result.decision_receipt_hash,
              asset_id: supplemental.result.selected_asset_id!,
              shot_id: supplemental.result.selected_shot_id!,
            },
          ]
        : [...parent.planning_request.committed_selection_refs];
    const preimage: Omit<TimelinePlanningRequestV1, 'timeline_request_hash'> = {
      schema_version: parent.planning_request.schema_version,
      planning_request_id: planningRequestId,
      confirmed_shot_plan: parent.planning_request.confirmed_shot_plan,
      narration_timing_snapshot: parent.planning_request.narration_timing_snapshot,
      committed_selection_refs: refs,
      timeline_policy_id: parent.planning_request.timeline_policy_id,
      timeline_policy_version: parent.planning_request.timeline_policy_version,
      timeline_policy_snapshot_hash: parent.planning_request.timeline_policy_snapshot_hash,
    };
    return parseTimelinePlanningRequestV1({
      ...preimage,
      timeline_request_hash: computeTimelinePlanningRequestHash(preimage),
    });
  }

  #buildChildArtifacts(
    parent: CommittedTimelinePlanVersionV1,
    requirement: TimelineAdditionalSelectionRequirementV1,
    supplemental: CommittedMaterialSelectionEvidenceV1,
    childPlanningRequestId: string,
    verifyMedia: boolean,
  ): ChildArtifacts {
    const planningRequest = this.#childPlanningRequest(
      parent,
      childPlanningRequestId,
      supplemental,
    );
    const selected = this.#resolveSelectedReferences(planningRequest, verifyMedia);
    const restoredNoMatches = this.#restoreParentInitialNoMatches(parent);
    const resolvedDecisions = [...selected, ...restoredNoMatches];
    const planningFacts = normalizeTimelinePlanningFactsV1({
      request: planningRequest,
      resolved_material_decisions: resolvedDecisions,
    });
    const ordinaryDurationPlan = planTimelineDurationV1({
      planning_facts: planningFacts,
      duration_policy: parent.duration_policy,
    });
    const durationPlan =
      supplemental.result.status === 'NO_MATCH'
        ? resolveTimelineSupplementalNoMatchV1({
            parent_duration_plan: parent.duration_plan,
            child_duration_plan: ordinaryDurationPlan,
            supplemental_no_match_resolutions: [
              {
                parent_duration_plan_hash: parent.duration_plan.duration_plan_hash,
                parent_requirement_id: requirement.requirement_id,
                selection_request_id: supplemental.result.selection_request_id,
                decision_receipt_hash: supplemental.result.decision_receipt_hash,
                batch_id: supplemental.result.batch_id,
                video_id: supplemental.result.video_id,
                slot_id: supplemental.result.slot_id,
                status: 'NO_MATCH',
              },
            ],
          })
        : ordinaryDurationPlan;
    return { planningRequest, resolvedDecisions, durationPlan };
  }

  #assertCommittedChildReplay(
    committed: CommittedTimelinePlanVersionV1,
    timelineId: string,
    parentVersion: number,
    expected: ChildArtifacts,
  ): void {
    if (
      committed.timeline_id !== timelineId ||
      committed.parent_version !== parentVersion ||
      committed.planning_request.timeline_request_hash !==
        expected.planningRequest.timeline_request_hash ||
      committed.duration_plan.duration_plan_hash !== expected.durationPlan.duration_plan_hash
    ) {
      throw new Error('TIMELINE_CONTINUATION_CHILD_REPLAY_CONFLICT');
    }
  }
}
