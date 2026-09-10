import { canonicalJson } from '@app/domain-media-index';
import type {
  MaterialSelectionRepository,
  MediaIndexRepository,
  NarrationAudioRepository,
  RenderPolicyRepository,
  RenderPreparationRecordV1,
  RenderPreparationRepository,
  TimelinePlanRepository,
  VerifiedStagedArtifactRecordV1,
} from '@app/local-db';
import {
  assertNarrationMatchesTimelineV1,
  buildExecutionSnapshotV1,
  buildLogicalRenderPlanV1,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  renderAcceptedTimelineRequestV1Schema,
  renderRuntimeIdentityV1Schema,
  resolvedRenderSourceV1Schema,
  validateRenderEntryV1,
  type RenderAcceptedTimelineRequestV1,
  type RenderExecutionSnapshotV1,
  type RenderRuntimeIdentityV1,
  type VerifiedCodeDDecisionV1,
} from '@app/render';
import { verifyCommittedMaterialSelectionEvidenceV1 } from './material-selection-service.js';
import type { RenderStagingService, VerifiedStagingResultV1 } from './render-staging-service.js';

export interface ReadyRenderPreparationV1 {
  job: RenderPreparationRecordV1;
  snapshot: RenderExecutionSnapshotV1;
}

function errorIdentity(error: unknown): { code: string; message: string } {
  if (error instanceof Error) return { code: error.message, message: error.message };
  return { code: 'RENDER_PREPARATION_FAILED', message: 'Render preparation failed' };
}

function attemptId(job: RenderPreparationRecordV1): string {
  return `${job.job_id.replaceAll('-', '_')}_attempt_${job.attempt_number}`;
}

export class RenderPreparationService {
  readonly #timelinePlans: TimelinePlanRepository;
  readonly #materialSelections: MaterialSelectionRepository;
  readonly #mediaIndex: MediaIndexRepository;
  readonly #narrationAudio: NarrationAudioRepository;
  readonly #renderPolicies: RenderPolicyRepository;
  readonly #preparations: RenderPreparationRepository;
  readonly #staging: RenderStagingService;
  readonly #runtimeIdentity: RenderRuntimeIdentityV1;
  readonly #allowMockRuntime: boolean;

  constructor(options: {
    timelinePlans: TimelinePlanRepository;
    materialSelections: MaterialSelectionRepository;
    mediaIndex: MediaIndexRepository;
    narrationAudio: NarrationAudioRepository;
    renderPolicies: RenderPolicyRepository;
    preparations: RenderPreparationRepository;
    staging: RenderStagingService;
    runtimeIdentity: RenderRuntimeIdentityV1;
    allowMockRuntimeForTests?: boolean;
  }) {
    this.#timelinePlans = options.timelinePlans;
    this.#materialSelections = options.materialSelections;
    this.#mediaIndex = options.mediaIndex;
    this.#narrationAudio = options.narrationAudio;
    this.#renderPolicies = options.renderPolicies;
    this.#preparations = options.preparations;
    this.#staging = options.staging;
    this.#runtimeIdentity = renderRuntimeIdentityV1Schema.parse(options.runtimeIdentity);
    this.#allowMockRuntime = options.allowMockRuntimeForTests ?? false;
    if (
      this.#runtimeIdentity.capability_profile_id !==
        FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id ||
      this.#runtimeIdentity.capability_profile_version !==
        FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_version ||
      this.#runtimeIdentity.capability_profile_hash !==
        FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash
    ) {
      throw new Error('RENDER_RUNTIME_CAPABILITY_PROFILE_MISMATCH');
    }
    if (this.#runtimeIdentity.approval_status !== 'APPROVED' && !this.#allowMockRuntime) {
      throw new Error('RENDER_RUNTIME_NOT_APPROVED');
    }
  }

  async prepare(requestValue: RenderAcceptedTimelineRequestV1): Promise<ReadyRenderPreparationV1> {
    const request = renderAcceptedTimelineRequestV1Schema.parse(requestValue);
    let job = this.#preparations.begin(request);
    if (job.state === 'READY_FOR_EXECUTION') {
      const snapshot = this.#preparations.getReadySnapshot(job.job_id);
      if (!snapshot) throw new Error('RENDER_READY_SNAPSHOT_MISSING');
      try {
        await this.#staging.verify(this.#stagingFacts(snapshot));
        return { job, snapshot };
      } catch (error) {
        const failure = errorIdentity(error);
        this.#preparations.interruptReady(job.job_id, failure.code, failure.message);
        throw error;
      }
    }
    if (job.state !== 'PREPARING') throw new Error('RENDER_PREPARATION_ALREADY_ACTIVE');

    try {
      const timeline = this.#timelinePlans.getVersion(
        request.timeline_id,
        request.timeline_version,
      );
      if (!timeline) throw new Error('RENDER_TIMELINE_VERSION_NOT_FOUND');
      const policy = this.#renderPolicies.require(
        request.render_policy_id,
        request.render_policy_version,
      );
      if (policy.policy_hash !== request.render_policy_hash) {
        throw new Error('RENDER_POLICY_EXACT_PIN_MISMATCH');
      }
      const codeDDecisions = this.#loadCodeDDecisions(
        timeline.duration_plan.segments.map((segment) => segment.selection_request_id),
      );
      const boundSegments = validateRenderEntryV1({
        request,
        timeline,
        code_d_decisions: codeDDecisions,
      });
      job = this.#preparations.markEntryValidated(job.job_id);

      const sources = boundSegments.map((segment) => {
        const source = this.#mediaIndex.assertExactShotExecutable({
          asset_id: segment.asset_id,
          revision: segment.revision,
          shot_id: segment.shot_id,
          start_ms: segment.shot_start_ms,
          end_ms: segment.shot_end_ms,
        });
        return resolvedRenderSourceV1Schema.parse({
          schema_version: '1.0',
          ...segment,
          resolved_source_path: source.sourcePath,
          verified_file_sha256: source.fileHash,
        });
      });
      const narrationTiming = timeline.planning_request.narration_timing_snapshot;
      const narration = await this.#narrationAudio.resolveExact({
        narration_audio_id: narrationTiming.narration_audio_id,
        expected_sha256: narrationTiming.narration_audio_hash,
      });
      assertNarrationMatchesTimelineV1({
        narration,
        narration_audio_id: narrationTiming.narration_audio_id,
        narration_audio_hash: narrationTiming.narration_audio_hash,
        total_duration_ms: narrationTiming.total_duration_ms,
        policy,
      });
      const logicalPlan = buildLogicalRenderPlanV1({
        timeline_id: timeline.timeline_id,
        timeline_version: timeline.version,
        timeline_commit_receipt_hash: timeline.commit_receipt.commit_receipt_hash,
        duration_plan_hash: timeline.duration_plan.duration_plan_hash,
        total_timeline_duration_ms: narrationTiming.total_duration_ms,
        policy,
        sources,
        narration,
      });
      job = this.#preparations.recordLogicalPlan(job.job_id, logicalPlan);
      job = this.#preparations.markStaging(job.job_id);
      const staged = await this.#staging.stage({
        attempt_id: attemptId(job),
        sources,
        narration,
      });
      const snapshot = buildExecutionSnapshotV1({
        logical_render_hash: logicalPlan.logical_render_hash,
        platform: this.#runtimeIdentity.platform,
        architecture: this.#runtimeIdentity.architecture,
        staging_root: staged.staging_root,
        output_root: staged.output_root,
        source_artifacts: staged.source_artifacts,
        narration_artifact: staged.narration_artifact,
        runtime_identity: this.#runtimeIdentity,
      });
      job = this.#preparations.recordReady({
        job_id: job.job_id,
        snapshot,
        artifacts: this.#artifactRecords(job, staged),
      });
      return { job, snapshot };
    } catch (error) {
      const failure = errorIdentity(error);
      this.#preparations.fail(job.job_id, failure.code, failure.message);
      throw error;
    }
  }

  async recoverInterrupted(): Promise<ReadyRenderPreparationV1[]> {
    const interrupted = this.#preparations.recoverInterrupted();
    const ready = this.#preparations.listReady();
    const recovered: ReadyRenderPreparationV1[] = [];
    for (const job of interrupted) {
      await this.#staging.cleanupAttempt(attemptId(job));
      recovered.push(await this.prepare(job.request));
    }
    for (const job of ready) {
      try {
        recovered.push(await this.prepare(job.request));
      } catch {
        recovered.push(await this.prepare(job.request));
      }
    }
    return recovered;
  }

  #loadCodeDDecisions(selectionRequestIds: readonly string[]): VerifiedCodeDDecisionV1[] {
    return [...new Set(selectionRequestIds)].map((selectionRequestId) => {
      const stored = this.#materialSelections.getCommittedEvidence(selectionRequestId);
      if (!stored) throw new Error('RENDER_CODE_D_EVIDENCE_NOT_FOUND');
      const evidence = verifyCommittedMaterialSelectionEvidenceV1(stored);
      if (
        evidence.result.status !== 'SELECTED' ||
        evidence.result.selected_asset_id === null ||
        evidence.result.selected_shot_id === null
      ) {
        throw new Error('RENDER_CODE_D_EVIDENCE_NOT_SELECTED');
      }
      const selectedCandidates = evidence.request.candidates.filter(
        (candidate) =>
          candidate.asset_id === evidence.result.selected_asset_id &&
          candidate.shot_id === evidence.result.selected_shot_id,
      );
      if (selectedCandidates.length !== 1) {
        throw new Error('RENDER_CODE_D_SELECTED_CANDIDATE_NOT_EXACTLY_ONE');
      }
      const selectedCandidate = selectedCandidates[0]!;
      if (
        selectedCandidate.revision === undefined ||
        selectedCandidate.start_ms === undefined ||
        selectedCandidate.end_ms === undefined
      ) {
        throw new Error('RENDER_CODE_D_SELECTED_CANDIDATE_SOURCE_IDENTITY_MISSING');
      }
      return {
        selection_request_id: evidence.result.selection_request_id,
        decision_receipt_hash: evidence.result.decision_receipt_hash,
        slot_id: evidence.result.slot_id,
        status: 'SELECTED',
        asset_id: evidence.result.selected_asset_id,
        shot_id: evidence.result.selected_shot_id,
        revision: selectedCandidate.revision,
        shot_start_ms: selectedCandidate.start_ms,
        shot_end_ms: selectedCandidate.end_ms,
      };
    });
  }

  #artifactRecords(
    job: RenderPreparationRecordV1,
    staged: VerifiedStagingResultV1,
  ): VerifiedStagedArtifactRecordV1[] {
    return [
      ...staged.source_artifacts.map((artifact, index) => ({
        artifact_record_id: `${job.job_id}:attempt:${job.attempt_number}:source:${index}`,
        artifact_role: 'STAGED_SOURCE' as const,
        authority_sha256: artifact.authority_sha256,
        artifact_sha256: artifact.staged_sha256,
        size_bytes: artifact.size_bytes,
        managed_path: artifact.staged_path,
        artifact_json: canonicalJson(artifact),
      })),
      {
        artifact_record_id: `${job.job_id}:attempt:${job.attempt_number}:narration`,
        artifact_role: 'STAGED_NARRATION',
        authority_sha256: staged.narration_artifact.authority_sha256,
        artifact_sha256: staged.narration_artifact.staged_sha256,
        size_bytes: staged.narration_artifact.size_bytes,
        managed_path: staged.narration_artifact.staged_path,
        artifact_json: canonicalJson(staged.narration_artifact),
      },
    ];
  }

  #stagingFacts(snapshot: RenderExecutionSnapshotV1): VerifiedStagingResultV1 {
    return {
      staging_root: snapshot.staging_root,
      output_root: snapshot.output_root,
      source_artifacts: snapshot.source_artifacts,
      narration_artifact: snapshot.narration_artifact,
    };
  }
}
