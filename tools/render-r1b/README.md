# Code G R1B Windows 11 product smoke

Run this only on a supported Windows 11 x64 Desktop after the approved Code F runtime and an
existing accepted R1A `READY_FOR_EXECUTION` database have been placed by Main-owned setup.

```powershell
pnpm build
pnpm render:r1b:windows-desktop-smoke -- C:\controlled\r1b-smoke-config.json
```

The configuration is strict and must contain exactly these fields:

```json
{
  "schema_version": "1.0",
  "authority_mode": "HISTORICAL_ACCEPTED_CHAIN",
  "job_id": "render_job_from_accepted_r1a",
  "db_path": "C:\\controlled\\app.db",
  "migrations_directory": "C:\\controlled\\migrations\\desktop-sqlite",
  "staging_root": "C:\\controlled\\render-staging",
  "output_root": "C:\\controlled\\render-output",
  "runtime_root": "C:\\controlled\\runtime\\ffmpeg\\win32\\x64\\bundle",
  "approval_receipt_path": "C:\\controlled\\FFMPEG_RENDER_RUNTIME_APPROVAL_V1.json",
  "expected_timeline_id": "accepted timeline id",
  "expected_timeline_version": 1,
  "expected_timeline_commit_receipt_hash": "64 lowercase hex characters",
  "expected_logical_render_hash": "64 lowercase hex characters"
}
```

The harness never runs C/D/E, never creates a Timeline, never selects material, and never accepts an
FFmpeg path, FFprobe path, output path, codec, filter graph, or raw argument array. It opens the
existing database, verifies the historical authority pins, and calls the real
`RenderExecutionServiceV1.executePreparedRender(job_id)` service. The service obtains all executable
facts from the immutable R1A plan/snapshot and re-verifies the exact approved runtime immediately
before spawn.

GitHub Windows Server remains build/static governance only. Its success cannot be reported as this
Windows 11 Desktop product gate.
