# Post-F License Reconciliation

This directory contains the deterministic final distribution binding, CycloneDX SBOM, NOTICE, and small provenance evidence. Worker binaries and full PyInstaller archives are intentionally not stored here.

`POST_F_LICENSE_RECONCILIATION.json` is the authoritative binding. It consumes Code F's immutable 18-record review set and replays the 37-use universe before binding the frozen Linux/Windows Worker and CArchive identities. The Windows MSVC v14 runtime remains an external `PREINSTALLED_COMPATIBLE_RUNTIME_ONLY` prerequisite; no VC_redist bytes are distributed here.

The consumer is reproducible with the repository-pinned formatter and the curated evidence under `evidence/`:

```text
python tools/code-c-python-supply-chain/reconcile_post_f_license.py \
  --candidate-id-prefix <candidate-id-prefix> \
  --expected-head <workflow-execution-head> \
  --usage-replay-report <37-usage-replay.json> \
  --linux-manifest frozen-candidates/<candidate-id>-linux/linux/manifest.json \
  --linux-retention <linux-retention-receipt.json> \
  --linux-recovery <linux-recovery-receipt.json> \
  --windows-manifest frozen-candidates/<candidate-id>-windows/windows/manifest.json \
  --windows-retention <windows-retention-receipt.json> \
  --windows-recovery <windows-recovery-receipt.json> \
  --evidence-root <curated-current-head-evidence>
```

Candidate selection is explicit and manifest-bound. The consumer never scans
`frozen-candidates/` for a latest directory and rejects wrong or historical
Candidate IDs before producing a distribution binding.

This phase stops at `CVE_STAGE_A_REBIND=READY_NOT_RUN`; it does not rebuild a Worker or advance CVE, Stage B, SigLIP, or index validation.
