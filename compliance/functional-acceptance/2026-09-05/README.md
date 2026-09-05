# Final Functional Acceptance Authority Inventory

This directory closes the authority-definition gap identified by Code C at the
current main baseline. It does not claim that model indexing, real-index
acceptance, Golden Retrieval, or Windows low-end measurements have run.

The SigLIP identity is an exact-byte rebind of accepted historical evidence
that was not previously published on `main`. The real-index corpus, Golden
Retrieval protocol, and Windows low-end profiles are narrow governance
definitions with explicit `NOT_YET_POPULATED`/`NOT_RUN` status. Their semantic
hashes bind the definitions; their raw SHA-256 sidecars bind the checked-in
JSON bytes.

The aggregate authority set binds the current FFprobe-v2 distribution
candidate and vulnerability authority. Any candidate, model, corpus, query,
ground-truth, retrieval, or profile change invalidates the relevant authority
and requires a new version. Code C owns the next functional revalidation; no
functional acceptance is performed by this publication.

## Cross-binding correction

`FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET.json` is the immutable v1 record
published by PR #45. It is superseded because its Golden category references
did not agree with the canonical protocol threshold and raw-file identity.
Consumers must select only
`FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V2.json`; the v2 record explicitly
marks v1 as `SUPERSEDED_DUE_TO_CROSS_BINDING_DEFECT` and fails closed on any
active reference to v1.

The v2 graph derives Golden threshold and protocol raw-file references from
`GOLDEN_RETRIEVAL_PROTOCOL.json` without changing that protocol. It also
publishes separate canonical identities for the Windows 4C/8GB and 4C/16GB
profile subjects in `WINDOWS_LOW_END_PROFILES_V2.json`. Both identities are
authority definitions only; all functional execution remains `NOT_RUN`.
