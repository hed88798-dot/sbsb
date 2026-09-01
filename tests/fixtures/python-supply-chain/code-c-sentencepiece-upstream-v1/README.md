# SentencePiece v0.2.1 upstream evidence fixture

This is an independent Code C diagnostic fixture for Code F review. It is not a
license approval and does not extend the Artifact License Evidence contract.

The fixture records the exact GitHub tag/commit identity, Release asset hashes,
the Sigstore `multiple.intoto.jsonl` artifact and the tagged source archive's
license-file hashes. The original downloaded bytes are retained in the local
diagnostic acquisition directory used for the run; no wheel or source archive
binary is committed to the repository. The manifest is the compact replay index
for those bytes and records the verification tool/version and fail-closed
regressions.

The v0.2.1 Release's official SLSA mechanism is present in `.github/workflows/wheel.yml`.
Its single published attestation covers the current Linux cp313 wheel subject,
but not the current Windows cp313 wheel subject. Release membership and license
coverage therefore remain separate: both wheels match the GitHub Release bytes,
the source license is exact and replayable, and coverage still requires review.
