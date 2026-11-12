# Demo local media and narration

Main-only entry points in `apps/desktop/src/main/demo-local-media.ts`:

- `commitDemoWorkerManifest({output_root, manifest_path, expected_manifest_sha256, source_path, repository})`: consume a controlled Media Worker indexing result, verify contained manifest bytes and exact source hash, then use existing MediaIndexRepository validation to commit descriptors/embeddings and record the real local location. This does not invent a semantic index or run an unapproved binary.
- `registerDemoSlotNarration({plan, slot_audio, output_path, repository})`: fetch a confirmed plan from authority, supply 2–3 real per-slot recordings/offline TTS WAVs in slot order, and concatenate measured PCM into an exclusively-created output. Returns `{artifact,timing,path}`; artifact is registered by NarrationAudioRepository, timing uses exact sample-count boundaries and existing timing self-hash. Input must be uncompressed 16-bit mono/stereo RIFF WAV, same sample rate/channels, total 15–30 seconds. No text-length timing guesses. An existing output file is never overwritten.

The caller must require authority confirmation before invoking downstream actions. These helpers are not exposed directly to renderer IPC. They do not synthesize audio, claim speech correctness, or treat a user path as a trusted model/executable. A person must check each recording speaks its corresponding confirmed slot. Source paths are not returned as renderer DTOs.

`searchAndSelectDemoSlot` executes the real worker exact search, constrains search to committed descriptor shot IDs, validates and hydrates returned scores against those exact rows, verifies source executability, and invokes existing MaterialSelectionService to persist its own receipt. Empty/unsuccessful results throw `DEMO_MEDIA_NO_MATCH` after retaining the real decision. Its runtime/model/cache paths must be activated and verified by the existing trust chain before invocation. This helper does not publish a cache.

After the normal workspace build, run `node tools/demo-media/run.mjs index|narration|ingest|select config.json evidence.json`. The evidence file is created exclusively. Each config contains `db_path`; narration/select additionally use `shot_plan_id` and `shot_plan_version`, which are loaded from the authority repository. Other config fields follow the corresponding helper options above (`repository`, `media` and `selection` are constructed by the CLI). Select requires an operator assertion `runtime_activation_verified: true`; this is not an approval or automatic verification mechanism. Use only paths already verified by the existing runtime activation tools. Output evidence is labeled DEMO_UNRELEASED. Main UI integration must apply its runtime verification rather than relying on this developer assertion.

For real indexing, reuse `media.index.asset.v1` in the existing approved Media Worker, with Main-owned validated ffprobe/model/output paths. Publish the existing exact-search cache from committed embedding truth, then call the search helper. No empty search or NO_MATCH is converted to synthetic material. The developer `index` command now invokes the Worker and publishes verified cache bytes from committed embeddings. UI import remains an integration task.

Current host discovery: no customer `.mp4`, `.wav`, `.mp3` or model `.onnx` exists in tracked repository artifacts. Repository README intentionally excludes customer material, model and worker executables. Runtime candidates may exist in the local frozen-candidates directory; their presence alone is not approved-runtime activation or Windows proof. No real media run was claimed. Unit audio is synthetic byte-accounting data only.

Real Provider requests: 0. Frozen Render policy/receipts and historical evaluations are unchanged. Windows local recordings (or previously generated offline TTS WAVs) are supported without installing a TTS engine; automatic Windows speech synthesis is not implemented in this increment.

## Index a real local material batch

After normal runtime/model activation and build, run:

```powershell
node tools/demo-media/run.mjs index C:\Demo\index.json C:\Demo\index-evidence.json
```

Example `index.json` (replace paths and model versions with the activated identities):

```json
{
  "db_path": "C:/Demo/fresh/app.db",
  "runtime_activation_verified": true,
  "worker": { "executablePath": "C:/Demo/activated/media-worker.exe" },
  "ffprobe_path": "C:/Demo/activated/ffprobe.exe",
  "model_root": "C:/Demo/activated/model-pack",
  "output_root": "C:/Demo/index-output",
  "cache_root": "C:/Demo/search-cache",
  "embedding_model_version": "REPLACE_WITH_LOCKED_VERSION",
  "embedding_preprocess_version": "REPLACE_WITH_LOCKED_VERSION",
  "dimension": 768,
  "shot_detector_parameters": {},
  "media": [
    { "source_path": "C:/Demo/input/one.mp4", "asset_id": "demo_one", "revision": 1 },
    { "source_path": "C:/Demo/input/two.mp4", "asset_id": "demo_two", "revision": 1 },
    { "source_path": "C:/Demo/input/three.mp4", "asset_id": "demo_three", "revision": 1 }
  ]
}
```

This is a developer prerequisite assertion, not automatic runtime verification. The command is intentionally not renderer IPC. It requires at least three unique asset IDs, checks returned identity/source/manifest/artifact hashes through the existing ingestion path, and rejects mixed generation keys or unexpected active embedding assets. Use a fresh DB and include the full batch. Each asset commit is durable; a failed later asset leaves earlier imports for diagnosis, without publishing a new generation. Restart interrupted trials in another fresh workspace; revision retries are not an automatic recovery flow.

Cache matrices contain only committed SQLite embedding bytes. Each attempt gets an isolated cache root; only a verified cache is recorded as an active DB generation. Failure can leave diagnostic cache files, but never returns selection configuration. Use `result.cache_root`, `result.signature_hash`, and `result.generation_key_hash` from successful index evidence for `select`, rather than the parent cache directory. Confirmation and narration registration remain separate explicit operations.

This command does not prove real indexing succeeded until run with actual materials and an activated Worker/model. Unit/integration worker responses remain synthetic test evidence. No real AI provider is invoked.
