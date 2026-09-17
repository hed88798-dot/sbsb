# Shot Plan Semantic Proposer v1

## Authority boundary

The proposer consumes one immutable `CanonicalSourceDocumentV1` and makes one whole-document semantic proposal. The model proposes segmentation, primary visual route, continuity action, review state, and concise rationale only. It does not own offsets, IDs, revisions, timestamps, or confirmation.

The application binds every exact fragment to one unambiguous continuous range in the canonical source, derives Unicode code-point offsets and `source_text`, creates opaque continuity-group identities, and delegates Candidate creation to the existing C3B `ShotPlanAuthorityService`.

Exact binding does not normalize punctuation, whitespace, or Unicode and does not use fuzzy matching. An ambiguous or missing binding is a structural failure eligible for the bounded structured-output retry. It is never converted to semantic `NEEDS_REVIEW`.

## Operation and idempotency

`ShotPlanProposerServiceV1.propose` accepts an explicit operation identity. The service derives a request snapshot hash from the source authority, versioned prompt, model alias, and complete prompt. An operation ID is single-flight and retains its successful result for the service lifetime. Replaying the same operation and snapshot returns the same Candidate; reusing the operation ID for another snapshot fails. Candidate persistence happens once, after the final response has passed strict parsing and exact reconciliation.

No proposer Job type is added in C3C. The existing generic Job contract has no durable Candidate-result binding and extending its lifecycle/IPC surface would exceed this internal, UI-free phase. A future product orchestration phase may introduce that binding only through an approved contract change. Migration 010 is not required.

## Provider and audit boundary

The implementation consumes the existing `TextCapabilityClient` using model alias `text.semantic-shot-planning`; it contains no vendor SDK or credential handling. Provider attempts are bounded to two and their answers are never merged.

Audit facts are limited to operation/candidate IDs, hashes, prompt version, provider/model aliases, attempt count, duration, and stable error code. Full narration, raw model output, credentials, and hidden reasoning are not logged.

## Semantic evaluation

The fixed synthetic veterinary e-commerce set contains 30 fixtures. Each fixture supports required semantic facts, one or more approved alternatives, must-have invariants, and forbidden outcomes. The evaluator reports independently:

- structural validity: strict schema plus exact ordered source coverage;
- segmentation: equality to one approved topology;
- route: all required facts use an approved primary route;
- continuity: actions match one approved alternative;
- `NEEDS_REVIEW`: actual and expected ambiguity behavior agree;
- forbidden outcomes: explicit high-value product mistakes such as keyword-only routing.

These metrics establish a reproducible product-review harness; they do not define a numeric production threshold. Mock results prove architecture only. The actual intended model must still be run and reviewed by the product owner before C3C can be closed.
