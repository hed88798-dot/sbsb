# Runtime prerequisite evidence

This directory records external runtime prerequisites without approving raw packaging observations.

The contract has four layers:

- `O`: immutable raw packaging observations, including selected path and SHA-256;
- `Q`: normalized consumer runtime requirements proven by application/import closure;
- `I`: approved providers materialized inside the product;
- `E`: approved external providers supplied by an installer or prerequisite layer.

The required partition is `Q = I ∪ E` and `I ∩ E = ∅`. An observation does not become an
approved distribution artifact merely because its requirement is assigned to `E`.

`pnpm compliance:runtime-prerequisite:verify` validates structure, hashes, application evidence
bindings, provider coverage, and the provider partition. It may report a valid record whose release
state is `BLOCKED`. `pnpm compliance:runtime-prerequisite:release` additionally requires current
signature/install/license/approval evidence and fails closed on expiry or revocation.

Windows probe evidence binds the immutable `provider_identity_sha256`, not the mutable approval
manifest hash. This allows a probe to remain auditable when its result is recorded in the approval
manifest without creating a self-referential hash.

The current MSVC record deliberately remains blocked until repository evidence identifies the
licensed Visual Studio user/product, applicable terms, and commercial redistribution entity. Public
download availability is not distribution approval.
