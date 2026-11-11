# Demo timeline, formal render and caption sidecar

Build first with `pnpm ci:prepare`. These tools make no Provider requests and use the existing production authorities. Commands emit JSON and fail with exit code 1 on a missing authority or file. They never import the historical smoke bundle into a fresh Demo DB.

1. Start a new app data directory / fresh DB, persist the user's script, propose offline candidates, and explicitly confirm them through the Demo UI. Keep the confirmed plan ID/version.
2. Index actual local materials through the controlled Media Worker and commit its verified manifest. Submit real search candidates through MaterialSelectionService. Keep one selection request ID for each confirmed slot.
3. Register actual local narration in NarrationAudioRepository. Supply exact slot timings tied to the confirmed plan and sample-derived duration; do not estimate exact timings from text. Save the complete hashed NarrationTimingSnapshotV1 as JSON.
4. Commit a new timeline using `node tools/demo-render/run.mjs timeline config.json`:

```json
{
  "db_path": "C:\\Demo\\fresh\\app.db",
  "shot_plan_id": "confirmed plan ID from this DB",
  "shot_plan_version": 1,
  "timing_snapshot_path": "C:\\Demo\\fresh\\timing.json",
  "selection_request_ids": ["selection for first slot", "selection for second slot"]
}
```

The bridge loads the confirmed plan, verifies registered narration bytes and duration, then calls TimelineOrchestrationService. It supports 2–3 ANIMAL/PRODUCT slots and 15–30 seconds. Missing/short media stays subject to the existing timeline planner and formal preparation gates; no fake selections or receipts are made.

5. On Windows x64, stage the exact approved runtime with the repository's existing `desktop:runtime:v2:stage` procedure. Test it with `node tools/demo-render/run.mjs preflight config.json` where config contains an absolute `runtime_root`. Existing approval is Windows-specific. macOS is not an authorized replacement for that runtime.
6. Execute `node tools/demo-render/run.mjs render config.json`:

```json
{
  "db_path": "C:\\Demo\\fresh\\app.db",
  "user_data_path": "C:\\Demo\\fresh",
  "runtime_root": "C:\\Demo\\runtime\\ffmpeg-render-v2",
  "timeline_id": "ID returned by timeline command",
  "timeline_version": 1
}
```

Preparation, execution and verification use createDesktopRenderCompositionV1, DesktopRenderTimelineHandoffV1 and DesktopRenderOrchestratorV1. The tool additionally hashes the final on-disk MP4 and emits the actual formal receipt. Capture stdout as run evidence. This is a core render step, not proof of the entire fresh DB UI workflow.

7. Optional standalone subtitles: `node tools/demo-render/run.mjs captions config.json` with `db_path`, `timeline_id`, `timeline_version` and absolute `srt_path`. The new file is written exclusively, without overwrite. Text and timings come from the committed timeline's bound confirmed plan. It does not change the MP4 or formal Render Receipt.

## Observed blockers on 2026-11-12

The execution host is macOS. The checked-in approved V2 runtime identity is `code-f-ffmpeg-render-windows-x86_64-34699695106`; its transport SHA is `a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01`. Checked Desktop frozen candidates include other Windows build identities; they cannot substitute for this approved identity. No staged runtime was present in the examined repository. Windows render execution remains untested here.

The tracked repository has no actual user MP4/WAV inputs. Real Media Worker execution and selection receipts, narration and exact slot timings remain required inputs. The tool cannot manufacture them. Core V1 subtitle mode remains OFF; no independently approved subtitle runtime was found, so caption postprocessing is deferred and only an SRT sidecar is implemented.
