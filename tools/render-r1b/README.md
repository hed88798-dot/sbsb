# Code G R1B portable Windows 11 product smoke

The smoke reuses an existing accepted R1A `READY_FOR_EXECUTION` job. It never reruns C, D, or E;
never creates a Timeline; never changes material selection; and never regenerates narration.

Runtime v1 is historically approved but is not compatible with the rotation-capable R1B contract.
Do not run product acceptance until the separately approved Runtime v2 and its runtime identity file
exist. Hosted Windows Server remains build/static governance only.

## 1. Export accepted authority on the source machine

After `pnpm build`, run one controlled export command against the existing application database:

```powershell
pnpm render:r1b:smoke-bundle:export -- <app.db> <migrations-directory> <accepted-job-id> <new-bundle-directory>
```

The destination must be new and empty. The command copies only already staged source/narration bytes
and portable accepted authority records. `manifest.json` binds every relative file by role, SHA-256,
and size, plus Timeline, policy, logical render, original execution snapshot, manifest, and aggregate
bundle identities. Source-machine absolute paths are not transported as business authority.

If no real accepted R1A job exists, stop with `HISTORICAL_R1A_PRODUCT_FIXTURE: NONE_AVAILABLE`.
Never substitute a test or synthesized authority.

## 2. Verify and import on Windows 11 Desktop

Transfer the bundle directory without changing bytes. After `pnpm build`, use one import command:

```powershell
pnpm render:r1b:smoke-bundle:import -- <bundle-directory> <new-controlled-root> <migrations-directory> <approved-runtime-v2-root> <runtime-v2-identity.json> <runtime-v2-approval-receipt.json>
```

The runtime identity is supplied by the approved Code F runtime; the user does not compose hashes.
Import rejects absolute/traversal bundle entries, case-normalized duplicates, symlinks/reparse-style
escapes, undeclared files, and any size/hash mismatch. It materializes bytes below the new controlled
root, preserves the logical render hash, creates only a new Windows machine execution snapshot, and
writes `<new-controlled-root>/smoke-config.json`.

## 3. Run success and cancellation product smoke

```powershell
pnpm render:r1b:windows-desktop-smoke -- <new-controlled-root>\smoke-config.json
```

This one command first starts the real approved FFmpeg through
`RenderExecutionServiceV1.executePreparedRender(job_id)`, cancels it through the product service,
proves the Windows `taskkill /T` lifecycle, checks bounded graceful/forced behavior, absence of an
orphan process, non-promotion of partial output, zero `VERIFIED_OUTPUT`, and an immutable CANCELLED
receipt. It then retries the same frozen preparation through the product service and requires full
FFprobe verification, output SHA-256, `VERIFIED_OUTPUT`, and a SUCCEEDED receipt.

The smoke output includes the bundle/manifest hashes and never relabels Unix signals or Windows
Server results as Windows 11 Desktop evidence.
