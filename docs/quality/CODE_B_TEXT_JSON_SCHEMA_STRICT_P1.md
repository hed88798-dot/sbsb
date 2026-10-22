# Generic text JSON Schema strict output — P1

Base: `684a5a776261529ea286331a876ff6ea3c5741db`.
Owner: Code B. Provider-infrastructure review: Brain1 / Code F.

## Additive request contract

`TextGatewayRequestV1.structured_output` and
`ProviderRequestV1` text `parameters.structured_output` accept the same optional,
vendor-neutral value:

```json
{
  "mode": "JSON_SCHEMA_STRICT",
  "schema_name": "synthetic_label-v1",
  "schema": {
    "type": "object",
    "properties": { "label": { "type": "string" } },
    "required": ["label"],
    "additionalProperties": false
  }
}
```

Only `JSON_SCHEMA_STRICT` is supported. Schema names match `[A-Za-z0-9_-]{1,64}`.
The schema root must be a plain JSON object (ordinary or null prototype), with:

- compact JSON UTF-8 encoding at most **65,536 bytes (64 KiB)**, counting keys,
  punctuation and escaped strings;
- maximum depth **32**, with root at depth 0;
- maximum **8,192 value nodes**, counting containers and each repeated occurrence.

Runtime checks reject non-finite numbers, undefined, functions, symbols, bigint,
class instances, Date/Map/Set/typed arrays, cycles, sparse/decorated arrays,
accessors and non-enumerable/symbol properties. Property descriptors are inspected
without invoking getters or `toJSON`. Traversal and serialization accounting are
bounded. This is a data-shape check; no caller schema is compiled or executed and
no remote `$ref` is fetched. JSON strings, including schema patterns, stay inert data.
Provider-specific JSON Schema support is decided by the Provider; keywords are
neither rewritten nor silently removed.

The published Provider/Text JSON Schema documents describe this additive field
and JSON data types. Serialized byte size, aggregate node count and depth are
additional runtime constraints, documented in their schema descriptions; standard
JSON Schema alone does not enforce those aggregate limits.

## Mapping and compatibility

The existing `HttpTextCapabilityClient` parses the extended shared contract and
signs its complete serialized request body without a client implementation change.
The Gateway forwards the validated structured configuration unchanged. The adapter
maps it to:

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "synthetic_label-v1",
      "strict": true,
      "schema": { "type": "object" }
    }
  }
}
```

Here `schema` stands for the exact caller-supplied schema, not an invented schema.
Absent `structured_output` means **no `response_format` property**. Existing
requests keep their previous model/messages, `temperature=0.7`, `max_tokens=2048`,
response text and error behavior. The optional field is omitted from the generic
request when absent, preserving the old Provider request serialization/hash.

Provider request identity remains SHA-256 of the complete validated generic
request. Schema presence, name and contents therefore participate in existing
idempotency conflict detection. Caller `request_snapshot_hash` remains unchanged
and echoed; P1 does not redefine any application's snapshot algorithm. Later
callers must include structured-output identity in their own snapshot calculation.
Request signing, authentication, authorization and legal approval are unchanged.

Allowed fallback receives the identical generic request, including strict output.
Provider `response_format` rejection remains `INVALID_PARAMS`, non-retryable at
the adapter; the Gateway records the existing failed-job outcome and text endpoint
error. There is no retry that removes strict output or substitutes prompt-only JSON.

## Output authority and known limitations

The adapter still returns **untrusted text**, including malformed or non-JSON text
if that is what the Provider returns. Domain callers must parse, validate, reconcile
sources and create authority through their existing rules. Strict request mode is
not proof of response validity or permission to execute an operation.

`STRUCTURED_OUTPUT_MAX_TOKENS_RISK: DOCUMENTED`: the existing explicit 2,048 output
token cap may truncate JSON. Brain1's P1 task flags Alibaba Cloud guidance to avoid
`max_tokens` with structured output. P1 preserves the existing cap; actual frozen
model compatibility and any necessary policy change require a separate preflight.
P1 does not verify that guidance or the model's live API compatibility.
Reasoning/thinking and `top_p` remain unexpressed by the contract; P1 adds neither.

## Verification and handoff

Synthetic contract tests cover JSON-only data and exact size/depth/node boundaries;
authenticated Gateway tests cover exact forwarding, signing, identity, rejection
and fallback; local HTTP capture verifies client serialization and adapter wire
mapping, old request compatibility and untrusted string responses. Existing
Provider regressions and repository CI remain required on the final PR HEAD.

Local verification on 2026-10-22 (Node 24.19.0, isolated pnpm 11.19.0):

- Frozen install, workspace preparation/build, format, lint, typecheck, dependency
  direction, portability, workflow security, secret scan and license scan passed.
- Focused contract/Gateway/HTTP adapter and existing Provider regressions: 89 tests
  across 9 files passed.
- Full local Vitest: 1,073 passed, 3 skipped; four suites could not initialize and
  one vertical smoke failed because this Mac lacks required Python 3.13.15.
  No interpreter version check was weakened. CI uses the pinned interpreter.
- The unchanged full-workspace Moderate vulnerability gate failed: 64 findings
  (6 Low, 26 Moderate, 31 High, 1 Critical). The Critical finding is the existing
  `shell-quote` dependency, GHSA-pqg4-j6r4-53mv. All package manifests, the lockfile
  and pnpm overrides are byte-identical to the specified base. These current
  advisory findings block an overall P1/merge PASS and require separate baseline
  dependency remediation; P1 does not suppress them or broaden into upgrades.

Final CI run identities and disposition are recorded in the Draft PR body after
submission. Local focused success does not substitute for required remote checks.

No dependencies, database migrations, Renderer, preload, IPC, feature/domain code,
Shot Plan schema/prompt/goldens, production credentials or Provider selection change.
No real Provider canary or 30-case semantic evaluation is run. PR #68 remains at
`fe486a793f2084af84e1c13ad82f2ccb571b35af`, Draft and unmerged.

Next ownership sequence: P1 infrastructure review and merge; Code A integrates the
generic capability in C3C; re-review that C3C HEAD; Code B performs environment
preflight and one isolated canary; Code A owns the formal semantic evaluation.
