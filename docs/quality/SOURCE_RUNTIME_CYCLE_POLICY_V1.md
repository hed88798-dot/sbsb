# SOURCE_RUNTIME_CYCLE_POLICY_V1

Brain1 authorized POLICY_STRENGTHENING_V1: retire the sole import-plugin rule,
`import/no-cycle`, in favor of repository-owned TypeScript-aware static dependency
cycle detection. The old rule could not resolve many emitted-extension imports,
aliases and workspace source edges; preserving those misses gave false confidence.

`pnpm lint` must run ESLint and `tools/source-cycle-check.mjs`. The tool depends
only on the existing TypeScript package and Node standard library. It parses all
TS/TSX/MTS/CTS source (including tests and tools) and resolves static imports and
runtime re-exports through project compiler options. Workspace declaration/output
entries map back to compiler-derived source files, including before a build.

Pure type-only imports and re-exports do not contribute edges. A mixed import
with a value binding does. Dynamic imports, require-only dependencies and direct
self imports are not new policy. Unresolved/external dependencies do not create
guessed internal edges. Declaration-only files have no runtime edges.

Generated/output trees (`node_modules`, `.git`, `dist*`, `release`, `coverage`,
`artifacts`, `generated`, `out`, `frozen-candidates`, `.runtime-stage`) are excluded;
source tests/fixtures are otherwise included. The contract separately exercises
temporary cyclic fixtures outside the normal checkout graph.

Discovery and edges are sorted. A visited/active DFS produces deterministic
cycle witnesses, capped at 20; it does not enumerate every possible path. Cycle
evidence is relative to the repository root and exits nonzero. No baseline-cycle
allowlist exists. Invalid source/config fails closed. Local baseline measurement:
266 files, 468 edges, approximately 0.3 seconds (machine-dependent, not a budget).

`tests/fixtures/source-cycle-oracle.json` retains all twelve historical old-rule
results and explicit new expectations. Seven old PASS results intentionally
become FAIL: static, three-file, re-export, mixed value/type, relative, path-alias
and workspace cycles. Five cases retain PASS: acyclic, pure type-only, dynamic,
require-only and self-import. These are approved policy changes, not old-rule parity.

`tests/contract/source-cycle-policy.test.ts` additionally covers emitted extension
resolution, pre-build workspace package exports, type-only re-exports, unresolved
external modules, generated output exclusion, deterministic CLI failure and
mandatory lint composition. No C3C/product/runtime semantics are changed.
