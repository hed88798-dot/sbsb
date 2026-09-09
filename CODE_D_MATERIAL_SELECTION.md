# Code D Material Selection V0.1

## Responsibility

Code C owns semantic eligibility. Code D never searches, embeds, changes semantic scores or adds candidates. It selects exactly one candidate from the upstream eligible set, or returns `NO_MATCH`.

```text
Code C eligible candidate set
  -> compatibility adapter
  -> candidate snapshot
  -> hard filter
  -> policy facts
  -> scarcity pool
  -> lexicographic preference order
  -> stable asset_id/shot_id tie-break
  -> Main + SQLite IMMEDIATE commit
  -> decision result and receipt
```

## Policy identity

- `policy_id`: `material-selection-policy-v1`
- `policy_version`: `1.0.0`
- Snapshot identity: SHA-256 of canonical policy JSON
- Tie-break: `asset_id`, then `shot_id`

ANIMAL prioritizes freshness and batch diversity before recency/frequency/semantic rank. PRODUCT prioritizes unused Shot, recency and asset-frequency balance before semantic rank, while allowing prior global use to weigh less strongly than in ANIMAL. Both profiles are industry-generic configuration; there are no pig/cattle/veterinary-product branches.

## Hard constraints

- candidate schema and identity must validate;
- candidate must be present in the supplied upstream set;
- candidate material family must match the slot;
- disabled candidates are rejected;
- exact Shot reuse in the same video is forbidden.

Hard constraints are never relaxed. If every candidate is hard-invalid, the committed result is `NO_MATCH / ALL_CANDIDATES_HARD_REJECTED`.

## Scarcity levels

| Level | Allowed pool                                                      | Meaning                              |
| ----- | ----------------------------------------------------------------- | ------------------------------------ |
| 0     | no asset or Shot repetition in this batch                         | normal selection                     |
| 1     | same Asset allowed; Shot must still be unused in the batch        | same-source, different-Shot fallback |
| 2     | batch Shot repetition allowed across multiple eligible candidates | balanced repeat                      |
| 3     | only one hard-valid candidate remains and must repeat             | terminal eligible repeat             |

Degradation is represented only by `status = SELECTED`, `degradation_level > 0` and reason codes. There is no third top-level status.

## Authority and transaction

External input is a selection intent plus the Code C eligible candidate set. It cannot contain authoritative history. Desktop Main opens one SQLite `IMMEDIATE` transaction, checks for an existing committed request, reads only `status = SELECTED` decisions, constructs and hashes the history snapshot, executes the pure selector, persists the full request/receipt/result, and returns the committed result.

`NO_MATCH` is persisted and idempotent but never contributes to usage. Retrying the same `selection_request_id` returns the original decision without recomputation, even if history or candidates have changed. A new attempt requires a new request ID.

## Audit fields

Every decision preserves candidate/history/policy hashes, policy identity, selected semantic evidence, degradation, reason codes, candidate facts, receipt hash and commit time. Usage counts are derived from selected committed decisions; no unexplained mutable counter is authoritative.
