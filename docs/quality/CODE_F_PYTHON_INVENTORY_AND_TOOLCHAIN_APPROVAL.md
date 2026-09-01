# Code F — Python Inventory v3 and Toolchain Provenance Approval

## Decision

This review issues six Approval Provenance v2 records for the frozen Code C factual
subjects: four Python Artifact Inventory v3 subjects and two Python toolchain intake
evidence subjects. The records are provenance approvals only. They do not approve
licenses, vulnerabilities, native reconciliation, packaging selection, or distribution.

The reviewed subject bytes are unchanged from the frozen bundle. No Code C subject was
regenerated, and no subject-side contract drift was found. The old bundle was bound to
Approval Provenance v1, so this review performs an explicit review-side rebind using a
new immutable v2 Review Evidence Snapshot.

## Frozen identities and baselines

| Item                                      | Identity                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Subject generation baseline               | `849e386862c042619357d284b71f9c6d2b27c130`                              |
| Approval contract baseline / current main | `2dedad3d0f403769b6367fad72e2b5bc3f489d3f`                              |
| Reviewed Code C HEAD                      | `ce5590e262a522e1ebff6039c6acae7423a3e778`                              |
| Review bundle ID                          | `code-c-python-inventory-review-ce5590e262a5-a809279fe384ac9b`          |
| Review bundle SHA-256                     | `a809279fe384ac9b2360faf31c9978d035583467c21e480748316b3b4b5d8b8a`      |
| Actions archive SHA-256                   | `0b74a0bace6d597d88f3be3c242782dc598ef46f507e637af3ae34fb4126d456`      |
| Bundle expected Approval contract         | `9d1b5b0db328a44e128666083f4bdfc4f5dd7fd026e306fe724a8d81c42e90f2` (v1) |
| Current Approval v2 contract              | `9c21394ab131599f1b8e9c4e2cfa01a40c79afa43a54d107eacef36ad2db5a56`      |
| Reviewer authority policy                 | `e4f8eb4eb82e9ae5a12764b5f950211e2ef18b8727647e65108efd452ea4aa12`      |

`BUNDLE_APPROVAL_CONTRACT_BINDING: STALE` and `REVIEW_BUNDLE_REBIND_REQUIRED: YES`.
This is a Review-side binding update only; `CODE_C_SUBJECT_REGENERATION_REQUIRED: NO`.

## Immutable v2 snapshot

| Snapshot ID                                              | SHA-256                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `review-snapshot-code-c-python-inventory-v3-v2-20260901` | `198a199992e5e5895569f063102886196ba094c8143bdfc824ef94ea4967ae78` |

The snapshot uses `json-utf8-lf-v1`, binds the exact six subject identities, target
descriptors, graph digests, resolver digests, toolchain evidence hashes, bundle hash,
Approval v2 contract hash, and reviewer authority hash.

## Issued approvals

### Python Artifact Inventory v3 (4)

| Approval ID                                    | Subject SHA-256                                                    | Role           | Target  | Approval record SHA-256                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ | -------------- | ------- | ------------------------------------------------------------------ |
| `approval-code-c-linux-runtime-py31315`        | `b6397a493afb9c555dde18a5c44947aee88692cf837f84f226bb9cdab451e9f2` | `RUNTIME`      | Linux   | `af829ef0232f25c3e4130ae8384fe819a1d64e2458278a1da51460f7a5029d67` |
| `approval-code-c-linux-worker-build-py31315`   | `de1538e8753bbee056f238f6483d3f9d080eb018ec74b5f5926a58a078fcf56c` | `WORKER_BUILD` | Linux   | `2a768d3ecd93a5321558d1bcfcc9b6ab709adad308c9b247b021e0be19dffa79` |
| `approval-code-c-windows-runtime-py31315`      | `5d7cd9e0e93af5606f33af97d54588f1fdfb9949089c658e62ad5b185f0cce8a` | `RUNTIME`      | Windows | `d79169914111f50d439d1aa326bdea2c6af6964fe6519e693c076f72a99f76e8` |
| `approval-code-c-windows-worker-build-py31315` | `c7ed5092c627fdbad3d28c7cd85246a03c1cacbbb65664c377fce94d23de7cc7` | `WORKER_BUILD` | Windows | `2ad1ba91864c094756f229c70400f316a120cc246de3855734e2226c07096563` |

### Toolchain provenance (2)

| Approval ID                                         | Evidence SHA-256                                                   | Target  | Approval record SHA-256                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------ |
| `approval-code-c-linux-toolchain-intake-evidence`   | `4e6a5e8a7b5ef245124ff188f8c2a74cba61a4ce37cfc8e4b2a6079f6fd4f95f` | Linux   | `cd7a10b79446af8b082767ac4c1d968022424e8b0712b330a921cf376a907c66` |
| `approval-code-c-windows-toolchain-intake-evidence` | `f19a6ef7a06bcfe2f804afb0f61c2f04fa4bc8638d5af61e8262f8e7c4fa5f88` | Windows | `1941af69b1a92c051a8589df432ea2b11ba23552cc64055102cc6131b8c68e7c` |

`TOOLCHAIN_PROVENANCE_DOES_NOT_IMPLY_LICENSE: PASS` and
`TOOLCHAIN_PROVENANCE_DOES_NOT_IMPLY_VULNERABILITY: PASS`; CVE Stage A remains
`PENDING` and the Python License Gate is `NOT_RUN` by scope.

## Independent review evidence

- `INVENTORY_V3_SCHEMA_SHA_RECOMPUTED: PASS` — trusted schema SHA
  `7a4999d4e31c83f3691ad69be6dc49822c4d0eebd77330964401ae349ae64e0e`.
- `TOOLCHAIN_SCHEMA_SHA_RECOMPUTED: PASS` — trusted schema SHA
  `b5e1035ccde3adcdffc1dbf1d73418c1585d0e292669020622b9b42acb3e9bd2`.
- `RAW_V3_SCHEMA_VALIDATION: PASS` — all four subjects validated independently.
- `FACTUAL_GRAPH_COMPLETENESS: PASS` and `RAW_RESOLVER_PROVENANCE_BINDING: PASS`.
- `TARGET_DESCRIPTOR_CONTRACT_DRIFT: NONE`; Linux descriptor SHA
  `2b71b8be5739e2ef139ac4e6d3e15a6bdd7dd1805484ce227dbfcf094a36da67`, Windows
  descriptor SHA `713f76e0a170611b00700e3a9705a6046b0f0f5869836420b51e342e8233d418`.
- `TOOLCHAIN_EVIDENCE_IDENTITY_UNCHANGED: PASS`.
- Artifact, dependency, resolver, target, and role drift counts: `0` unexpected.
- `APPROVAL_LIFECYCLE_EMBEDDED_IN_SUBJECT: NO`; `SUBJECT_BYTES_IMMUTABLE: PASS`.
- Current v3 license-evidence reference integrity was re-evaluated against the exact
  wheel members in the local cold archive: `57` references, `0` missing, `0`
  mismatches. `LICENSE_EVIDENCE_REFERENCE_INTEGRITY: PASS`; this is not a license
  approval.

## Fail-closed regression coverage

The Approval v2 verifier was exercised for wrong subject SHA, wrong schema SHA, same
schema version with different schema bytes, wrong target, wrong scope, wrong snapshot,
wrong authority, revocation, expiry/recheck, and conflicting active approval cases.
Each is required to block. Historical rejected candidates remain unapproved, and v1 is
verify-only for historical records.

## Environment classification and scope boundary

There are five known local failures under the developer's CPython `3.12.10` environment.
The current reviewed target is CPython `3.13.15` / `cp313`; the failures are not
reproducible in required CI and are classified `STALE_NON_TARGET_ENVIRONMENT`.
`CURRENT_APPROVAL_ACCEPTANCE_BLOCKER: NO` only with required Approval PR CI green.

This PR intentionally does not run Worker, Native, Python License, CVE Stage A Rebind,
or Stage B gates. Code C remains on hold until the merged records are reconciled.
After merge, the only permitted next phase is
`PYTHON_INVENTORY_APPROVAL_RECONCILIATION_ONLY`.
