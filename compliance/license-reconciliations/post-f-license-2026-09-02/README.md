# Post-F License Reconciliation

This directory contains the deterministic final distribution binding, CycloneDX SBOM, NOTICE, and small provenance evidence. Worker binaries and full PyInstaller archives are intentionally not stored here.

`POST_F_LICENSE_RECONCILIATION.json` is the authoritative binding. It consumes Code F's immutable 18-record review set and replays the 37-use universe before binding the frozen Linux/Windows Worker and CArchive identities. The Windows MSVC v14 runtime remains an external `PREINSTALLED_COMPATIBLE_RUNTIME_ONLY` prerequisite; no VC_redist bytes are distributed here.

The consumer is reproducible with the repository-pinned formatter and the curated evidence under `evidence/`:

```text
python tools/code-c-python-supply-chain/reconcile_post_f_license.py \
  --evidence-root compliance/license-reconciliations/post-f-license-2026-09-02/evidence
```

This phase stops at `CVE_STAGE_A_REBIND=READY_NOT_RUN`; it does not rebuild a Worker or advance CVE, Stage B, SigLIP, or index validation.
