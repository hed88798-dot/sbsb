# Controlled R1A new-authority operator

Run the explicit, versioned operator input with:

```text
pnpm r1a:authority:new -- /absolute/path/to/R1A_NEW_AUTHORITY_INPUT_V1.json
```

The operator creates a new SQLite database, invokes the accepted Code C indexing/search worker,
commits Code D selection evidence through `MaterialSelectionService`, commits the Timeline through
the accepted Code E orchestration service, registers a narration artifact derived from real bytes,
and calls `RenderPreparationService.prepare()` with the approved Runtime v2 identity.

It stops at `READY_FOR_EXECUTION`. It has no Renderer, IPC, HTTP, discovery, resume, or FFmpeg
product-execution surface. A failed acceptance root is retained as evidence; use a new empty root
for every new attempt.

The JSON Schema in this directory is the complete input contract. Absolute paths are execution
facts only and never appear in the successful machine-readable output.
