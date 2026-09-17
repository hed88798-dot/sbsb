import { randomUUID } from 'node:crypto';
import {
  candidateShotPlanV1Schema,
  confirmedShotPlanV1Schema,
  type CandidateShotPlanV1,
  type ConfirmedShotPlanV1,
  type ShotPlanCandidateResolutionV1,
  type ShotPlanCandidateSlotV1,
  type ShotPlanCandidateWarningV1,
  type ShotPlanRouteV1,
} from '@app/contracts';
import {
  type ConfirmedShotPlanRecordV1,
  type ShotPlanAuthorityRepository,
  type ShotPlanCandidateRecordV1,
  type ShotPlanConfirmationIntentV1,
  type SourceDocumentRepository,
} from '@app/local-db';
import { computeConfirmedShotPlanHash } from '@app/timeline';

export interface CandidateSlotDraftV1 {
  order_index: number;
  source_start: number;
  source_end: number;
  source_text: string;
  route: ShotPlanRouteV1 | null;
  route_state: ShotPlanCandidateResolutionV1;
  visual_continuity_group_id: string | null;
  continuity_state: ShotPlanCandidateResolutionV1;
  rationale?: string;
  review_warnings?: ShotPlanCandidateWarningV1[];
}

interface SourceSelectorV1 {
  source_document_id: string;
  source_document_version: number;
  source_document_hash: string;
}

type IdKind = 'candidate' | 'slot' | 'shot_plan';

function fail(code: string): never {
  throw new Error(code);
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

function exactSlice(text: string, start: number, end: number): string {
  return codePoints(text).slice(start, end).join('');
}

function isUnicodeWhitespaceOnly(value: string): boolean {
  return /^\p{White_Space}*$/u.test(value);
}

function validateTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    return fail('SHOT_PLAN_TIMESTAMP_INVALID');
  }
  return value;
}

export class ShotPlanAuthorityService {
  readonly #repository: ShotPlanAuthorityRepository;
  readonly #sourceDocuments: Pick<SourceDocumentRepository, 'getVersion'>;
  readonly #clock: () => string;
  readonly #id: (kind: IdKind) => string;

  constructor(options: {
    repository: ShotPlanAuthorityRepository;
    sourceDocuments: Pick<SourceDocumentRepository, 'getVersion'>;
    clock?: () => string;
    id?: (kind: IdKind) => string;
  }) {
    this.#repository = options.repository;
    this.#sourceDocuments = options.sourceDocuments;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#id =
      options.id ??
      ((kind) => `${kind === 'shot_plan' ? 'shot_plan' : `shot_${kind}`}_${randomUUID()}`);
  }

  createCandidate(
    input: SourceSelectorV1 & {
      segmentation_state: ShotPlanCandidateResolutionV1;
      review_warnings?: ShotPlanCandidateWarningV1[];
      slots: CandidateSlotDraftV1[];
    },
  ): ShotPlanCandidateRecordV1 {
    const source = this.#requireSource(input);
    const now = validateTimestamp(this.#clock());
    const candidate = candidateShotPlanV1Schema.parse({
      schema_version: '1.0',
      candidate_id: this.#id('candidate'),
      candidate_revision: 1,
      candidate_status: 'ACTIVE',
      source_document_id: source.source_document_id,
      source_document_version: source.source_document_version,
      source_document_hash: source.source_document_hash,
      source_offset_unit: 'UNICODE_CODE_POINT',
      segmentation_state: input.segmentation_state,
      review_warnings: input.review_warnings ?? [],
      slots: input.slots.map((slot) => ({
        ...slot,
        slot_id: this.#id('slot'),
        rationale: slot.rationale ?? '',
        review_warnings: slot.review_warnings ?? [],
      })),
      created_at: now,
      updated_at: now,
    });
    this.#validateCandidateStructure(candidate, source.text);
    return this.#repository.createCandidate(candidate);
  }

  createCandidateFromConfirmed(input: {
    shot_plan_id: string;
    shot_plan_version: number;
  }): ShotPlanCandidateRecordV1 {
    const confirmed = this.#repository.getConfirmedVersion(
      input.shot_plan_id,
      input.shot_plan_version,
    );
    if (!confirmed) return fail('CONFIRMED_SHOT_PLAN_NOT_FOUND');
    const plan = confirmed.plan;
    const source = this.#requireSource({
      source_document_id: plan.source_document_id,
      source_document_version: plan.source_document_version,
      source_document_hash: plan.source_document_hash,
    });
    const latest = this.#repository.getLatestConfirmedBySource(
      plan.source_document_id,
      plan.source_document_version,
    );
    if (!latest || latest.plan.shot_plan_version !== plan.shot_plan_version) {
      return fail('SHOT_PLAN_CONFIRMED_BASE_NOT_LATEST');
    }
    const now = validateTimestamp(this.#clock());
    const candidate = candidateShotPlanV1Schema.parse({
      schema_version: '1.0',
      candidate_id: this.#id('candidate'),
      candidate_revision: 1,
      candidate_status: 'ACTIVE',
      source_document_id: plan.source_document_id,
      source_document_version: plan.source_document_version,
      source_document_hash: plan.source_document_hash,
      source_offset_unit: 'UNICODE_CODE_POINT',
      segmentation_state: 'RESOLVED',
      review_warnings: [],
      slots: plan.slots.map((slot) => ({
        ...slot,
        route_state: 'RESOLVED',
        continuity_state: 'RESOLVED',
        rationale: '',
        review_warnings: [],
      })),
      created_at: now,
      updated_at: now,
    });
    this.#validateCandidateStructure(candidate, source.text);
    return this.#repository.createCandidate(candidate, {
      shot_plan_id: plan.shot_plan_id,
      base_confirmed_version: plan.shot_plan_version,
    });
  }

  getCandidate(candidateId: string): ShotPlanCandidateRecordV1 | null {
    return this.#repository.getCandidate(candidateId);
  }

  editRoute(input: {
    candidate_id: string;
    expected_candidate_revision: number;
    slot_id: string;
    route: ShotPlanRouteV1;
    rationale?: string;
  }): ShotPlanCandidateRecordV1 {
    return this.#mutate(input, (candidate) => {
      this.#requireSlot(candidate, input.slot_id);
      return {
        ...candidate,
        slots: candidate.slots.map((slot) =>
          slot.slot_id === input.slot_id
            ? {
                ...slot,
                route: input.route,
                route_state: 'RESOLVED',
                rationale: input.rationale ?? slot.rationale,
              }
            : slot,
        ),
      };
    });
  }

  editContinuity(input: {
    candidate_id: string;
    expected_candidate_revision: number;
    slot_id: string;
    visual_continuity_group_id: string;
  }): ShotPlanCandidateRecordV1 {
    return this.#mutate(input, (candidate) => {
      this.#requireSlot(candidate, input.slot_id);
      return {
        ...candidate,
        slots: candidate.slots.map((slot) =>
          slot.slot_id === input.slot_id
            ? {
                ...slot,
                visual_continuity_group_id: input.visual_continuity_group_id,
                continuity_state: 'RESOLVED',
              }
            : slot,
        ),
      };
    });
  }

  editBoundary(input: {
    candidate_id: string;
    expected_candidate_revision: number;
    slot_id: string;
    source_start: number;
    source_end: number;
  }): ShotPlanCandidateRecordV1 {
    const source = this.#sourceForCandidate(input.candidate_id);
    return this.#mutate(input, (candidate) => {
      this.#requireSlot(candidate, input.slot_id);
      const slots = candidate.slots.map((slot) =>
        slot.slot_id === input.slot_id
          ? {
              ...slot,
              source_start: input.source_start,
              source_end: input.source_end,
              source_text: exactSlice(source.text, input.source_start, input.source_end),
            }
          : slot,
      );
      return { ...candidate, slots: this.#canonicalOrder(slots) };
    });
  }

  splitSlot(input: {
    candidate_id: string;
    expected_candidate_revision: number;
    slot_id: string;
    split_at: number;
  }): ShotPlanCandidateRecordV1 {
    const source = this.#sourceForCandidate(input.candidate_id);
    return this.#mutate(input, (candidate) => {
      const index = candidate.slots.findIndex((slot) => slot.slot_id === input.slot_id);
      const original = candidate.slots[index];
      if (!original) return fail('SHOT_PLAN_CANDIDATE_SLOT_NOT_FOUND');
      if (input.split_at <= original.source_start || input.split_at >= original.source_end) {
        return fail('SHOT_PLAN_CANDIDATE_SPLIT_INVALID');
      }
      const children: ShotPlanCandidateSlotV1[] = [
        {
          ...original,
          slot_id: this.#id('slot'),
          source_end: input.split_at,
          source_text: exactSlice(source.text, original.source_start, input.split_at),
        },
        {
          ...original,
          slot_id: this.#id('slot'),
          source_start: input.split_at,
          source_text: exactSlice(source.text, input.split_at, original.source_end),
        },
      ];
      const slots = [...candidate.slots];
      slots.splice(index, 1, ...children);
      return { ...candidate, slots: this.#canonicalOrder(slots) };
    });
  }

  mergeSlots(input: {
    candidate_id: string;
    expected_candidate_revision: number;
    slot_ids: string[];
    route: ShotPlanRouteV1;
    visual_continuity_group_id: string;
    rationale?: string;
  }): ShotPlanCandidateRecordV1 {
    const source = this.#sourceForCandidate(input.candidate_id);
    return this.#mutate(input, (candidate) => {
      if (input.slot_ids.length < 2) return fail('SHOT_PLAN_CANDIDATE_MERGE_INVALID');
      const indexes = input.slot_ids.map((slotId) =>
        candidate.slots.findIndex((slot) => slot.slot_id === slotId),
      );
      if (
        indexes.some((index) => index < 0) ||
        indexes.some((index, offset) => index !== indexes[0]! + offset)
      ) {
        return fail('SHOT_PLAN_CANDIDATE_MERGE_INVALID');
      }
      const firstIndex = indexes[0]!;
      const selected = indexes.map((index) => candidate.slots[index]!);
      const first = selected[0]!;
      const last = selected.at(-1)!;
      const merged: ShotPlanCandidateSlotV1 = {
        slot_id: this.#id('slot'),
        order_index: first.order_index,
        source_start: first.source_start,
        source_end: last.source_end,
        source_text: exactSlice(source.text, first.source_start, last.source_end),
        route: input.route,
        route_state: 'RESOLVED',
        visual_continuity_group_id: input.visual_continuity_group_id,
        continuity_state: 'RESOLVED',
        rationale: input.rationale ?? '',
        review_warnings: [],
      };
      const slots = [...candidate.slots];
      slots.splice(firstIndex, selected.length, merged);
      return { ...candidate, slots: this.#canonicalOrder(slots) };
    });
  }

  resolveReview(input: {
    candidate_id: string;
    expected_candidate_revision: number;
    segmentation_state?: ShotPlanCandidateResolutionV1;
    review_warnings?: ShotPlanCandidateWarningV1[];
    slot_updates?: Array<{
      slot_id: string;
      route?: ShotPlanRouteV1;
      route_state?: ShotPlanCandidateResolutionV1;
      visual_continuity_group_id?: string;
      continuity_state?: ShotPlanCandidateResolutionV1;
      rationale?: string;
      review_warnings?: ShotPlanCandidateWarningV1[];
    }>;
  }): ShotPlanCandidateRecordV1 {
    return this.#mutate(input, (candidate) => {
      for (const update of input.slot_updates ?? []) this.#requireSlot(candidate, update.slot_id);
      return {
        ...candidate,
        segmentation_state: input.segmentation_state ?? candidate.segmentation_state,
        review_warnings: input.review_warnings ?? candidate.review_warnings,
        slots: candidate.slots.map((slot) => {
          const update = input.slot_updates?.find((entry) => entry.slot_id === slot.slot_id);
          return update ? { ...slot, ...update, slot_id: slot.slot_id } : slot;
        }),
      };
    });
  }

  rejectCandidate(input: {
    candidate_id: string;
    expected_candidate_revision: number;
  }): ShotPlanCandidateRecordV1 {
    return this.#mutate(input, (candidate) => ({ ...candidate, candidate_status: 'REJECTED' }));
  }

  confirmCandidate(intent: ShotPlanConfirmationIntentV1): ConfirmedShotPlanRecordV1 {
    const duplicate = this.#repository.findConfirmation(intent);
    if (duplicate) return duplicate;
    const record = this.#repository.requireCandidate(intent.candidate_id);
    if (record.candidate.candidate_revision !== intent.candidate_revision) {
      return fail('SHOT_PLAN_CONFIRMATION_STALE');
    }
    const source = this.#requireSource(intent);
    this.#validateForConfirmation(record.candidate, source.text);
    return this.#repository.confirmCandidate({
      intent,
      new_shot_plan_id: this.#id('shot_plan'),
      created_at: validateTimestamp(this.#clock()),
      build: (candidate, allocation) => {
        this.#validateForConfirmation(candidate, source.text);
        const preimage: Omit<ConfirmedShotPlanV1, 'shot_plan_hash'> = {
          schema_version: '1.0',
          shot_plan_id: allocation.shot_plan_id,
          shot_plan_version: allocation.shot_plan_version,
          source_document_id: candidate.source_document_id,
          source_document_version: candidate.source_document_version,
          source_document_hash: candidate.source_document_hash,
          review_state: 'CONFIRMED',
          source_offset_unit: 'UNICODE_CODE_POINT',
          slots: candidate.slots.map((slot) => {
            if (slot.route === null || slot.visual_continuity_group_id === null) {
              return fail('SHOT_PLAN_CANDIDATE_UNRESOLVED');
            }
            return {
              slot_id: slot.slot_id,
              order_index: slot.order_index,
              source_start: slot.source_start,
              source_end: slot.source_end,
              source_text: slot.source_text,
              route: slot.route,
              visual_continuity_group_id: slot.visual_continuity_group_id,
            };
          }),
        };
        return confirmedShotPlanV1Schema.parse({
          ...preimage,
          shot_plan_hash: computeConfirmedShotPlanHash(preimage),
        });
      },
    });
  }

  getConfirmedVersion(shotPlanId: string, version: number): ConfirmedShotPlanRecordV1 | null {
    return this.#repository.getConfirmedVersion(shotPlanId, version);
  }

  #mutate(
    input: { candidate_id: string; expected_candidate_revision: number },
    update: (candidate: CandidateShotPlanV1) => CandidateShotPlanV1,
  ): ShotPlanCandidateRecordV1 {
    return this.#repository.mutateCandidate(
      input.candidate_id,
      input.expected_candidate_revision,
      (current) => {
        const source = this.#requireSource({
          source_document_id: current.candidate.source_document_id,
          source_document_version: current.candidate.source_document_version,
          source_document_hash: current.candidate.source_document_hash,
        });
        const next = candidateShotPlanV1Schema.parse({
          ...update(current.candidate),
          candidate_revision: current.candidate.candidate_revision + 1,
          updated_at: validateTimestamp(this.#clock()),
        });
        this.#validateCandidateStructure(next, source.text);
        return next;
      },
    );
  }

  #sourceForCandidate(candidateId: string) {
    const candidate = this.#repository.requireCandidate(candidateId).candidate;
    return this.#requireSource({
      source_document_id: candidate.source_document_id,
      source_document_version: candidate.source_document_version,
      source_document_hash: candidate.source_document_hash,
    });
  }

  #requireSource(selector: SourceSelectorV1) {
    const source = this.#sourceDocuments.getVersion(
      selector.source_document_id,
      selector.source_document_version,
    );
    if (!source) return fail('SHOT_PLAN_SOURCE_DOCUMENT_NOT_FOUND');
    if (source.source_document_hash !== selector.source_document_hash) {
      return fail('SHOT_PLAN_SOURCE_DOCUMENT_HASH_MISMATCH');
    }
    if (source.source_offset_unit !== 'UNICODE_CODE_POINT') {
      return fail('SHOT_PLAN_SOURCE_OFFSET_UNIT_MISMATCH');
    }
    return source;
  }

  #canonicalOrder(slots: ShotPlanCandidateSlotV1[]): ShotPlanCandidateSlotV1[] {
    return [...slots]
      .sort((left, right) => left.source_start - right.source_start)
      .map((slot, orderIndex) => ({ ...slot, order_index: orderIndex }));
  }

  #requireSlot(candidate: CandidateShotPlanV1, slotId: string): ShotPlanCandidateSlotV1 {
    return (
      candidate.slots.find((slot) => slot.slot_id === slotId) ??
      fail('SHOT_PLAN_CANDIDATE_SLOT_NOT_FOUND')
    );
  }

  #validateCandidateStructure(candidate: CandidateShotPlanV1, sourceText: string): void {
    const sourceLength = codePoints(sourceText).length;
    let previousEnd = -1;
    for (const [index, slot] of candidate.slots.entries()) {
      if (slot.order_index !== index) return fail('SHOT_PLAN_ORDER_INDEX_INVALID');
      if (
        slot.source_start < 0 ||
        slot.source_end > sourceLength ||
        slot.source_end <= slot.source_start
      ) {
        return fail('SHOT_PLAN_SOURCE_RANGE_INVALID');
      }
      if (slot.source_start < previousEnd) return fail('SHOT_PLAN_SOURCE_RANGE_OVERLAP');
      if (exactSlice(sourceText, slot.source_start, slot.source_end) !== slot.source_text) {
        return fail('SHOT_PLAN_SOURCE_TEXT_MISMATCH');
      }
      previousEnd = slot.source_end;
    }
  }

  #validateForConfirmation(candidate: CandidateShotPlanV1, sourceText: string): void {
    this.#validateCandidateStructure(candidate, sourceText);
    if (candidate.candidate_status !== 'ACTIVE') return fail('SHOT_PLAN_CANDIDATE_NOT_ACTIVE');
    if (candidate.segmentation_state !== 'RESOLVED') {
      return fail('SHOT_PLAN_SEGMENTATION_UNRESOLVED');
    }
    if (candidate.review_warnings.some((warning) => warning.severity === 'BLOCKING')) {
      return fail('SHOT_PLAN_BLOCKING_WARNING');
    }

    let cursor = 0;
    let previousGroup: string | null = null;
    let previousRoute: ShotPlanRouteV1 | null = null;
    const completedGroups = new Set<string>();
    for (const slot of candidate.slots) {
      const gap = exactSlice(sourceText, cursor, slot.source_start);
      if (!isUnicodeWhitespaceOnly(gap)) return fail('SHOT_PLAN_NON_WHITESPACE_GAP');
      if (slot.route_state !== 'RESOLVED' || slot.route === null) {
        return fail('SHOT_PLAN_ROUTE_UNRESOLVED');
      }
      if (slot.continuity_state !== 'RESOLVED' || slot.visual_continuity_group_id === null) {
        return fail('SHOT_PLAN_CONTINUITY_UNRESOLVED');
      }
      if (slot.review_warnings.some((warning) => warning.severity === 'BLOCKING')) {
        return fail('SHOT_PLAN_BLOCKING_WARNING');
      }
      const group = slot.visual_continuity_group_id;
      if (previousGroup !== null && group !== previousGroup) completedGroups.add(previousGroup);
      if (completedGroups.has(group)) return fail('SHOT_PLAN_CONTINUITY_GROUP_REUSED');
      if (group === previousGroup && previousRoute !== null && slot.route !== previousRoute) {
        return fail('SHOT_PLAN_CONTINUITY_ROUTE_MISMATCH');
      }
      previousGroup = group;
      previousRoute = slot.route;
      cursor = slot.source_end;
    }
    if (!isUnicodeWhitespaceOnly(exactSlice(sourceText, cursor, codePoints(sourceText).length))) {
      return fail('SHOT_PLAN_NON_WHITESPACE_GAP');
    }
  }
}
