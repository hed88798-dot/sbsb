# Code B Baseline Dependency Security Remediation — Wave A

## Scope and authority

- Base: `684a5a776261529ea286331a876ff6ea3c5741db`
- Branch: `code-b/baseline-security-wave-a`
- Scope: Wave A dependency security remediation only
- PR #68 / PR #69: unchanged
- Main merge: forbidden for this wave

## Direct-root delta

| Root                   | Before   | After    | Rationale                                                                                                                                                            |
| ---------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `concurrently`         | `9.2.1`  | `10.0.6` | Removes the vulnerable `shell-quote@1.10.0` path.                                                                                                                    |
| Gateway `fastify`      | `5.12.1` | `5.12.6` | `5.12.5` was the originally identified floor, but the current audit also reports GHSA-389g-gv7q-r4x8 for `<5.12.6`; `5.12.6` is the smallest currently patched line. |
| `shell-quote` override | `1.10.0` | removed  | The override was introduced with supply-chain tooling and had no independent compatibility rationale; the upgraded parent naturally resolves `1.12.0`.               |

No other direct dependency was changed. The remaining lockfile changes are the necessary resolution consequences of these roots. No `fast-uri` direct dependency or permanent override was added.

## Resolved dependency paths

```text
shell-quote@1.12.0
└─ concurrently@10.0.6
   └─ ai-video-desktop@0.1.0 (devDependencies)
```

```text
fastify@5.12.6
└─ @app/gateway@0.2.0 (dependencies)
```

The Fastify-controlled direct compiler/stringifier dependency now resolves `fast-uri@4.1.5`. `fast-uri@4.1.3` is absent. The shared `fast-uri@3.1.6` graph remains unchanged and is explicitly residual for a later authorized wave. Its roots are:

- root `ajv` and `ajv-formats`;
- `electron-builder` / `app-builder-lib`;
- Fastify compiler/stringifier packages through their nested `ajv` and `ajv-formats` dependencies.

## Point-in-time security delta

Both sides were rescanned against the same current advisory view with Node `24.19.0` and pnpm `11.19.0`.

| Metric                |             Exact base |                 Wave A |
| --------------------- | ---------------------: | ---------------------: |
| Audit timestamp (UTC) | `2026-10-23T04:46:57Z` | `2026-10-23T04:47:12Z` |
| Total findings        |                     69 |                     59 |
| Critical              |                      1 |                      0 |
| High                  |                     31 |                     25 |
| Moderate              |                     28 |                     25 |
| Low                   |                      9 |                      9 |

Unique advisory IDs removed:

- `GHSA-4mh8-r7rc-xpvc`
- `GHSA-667r-xxjv-c9mm`
- `GHSA-9q9j-q6p8-xq58`
- `GHSA-hwr6-493r-vm6h`
- `GHSA-jvvf-x445-j334`
- `GHSA-p68q-wchp-6fh7`
- `GHSA-pqg4-j6r4-53mv`

New advisory IDs introduced by the Wave A graph: none.

The current audit contains no `shell-quote` or Fastify finding. The `fast-uri` 4.x findings, including the 4.x path for `GHSA-58mr-gqgx-xq4g`, are absent. That advisory remains visible only against `fast-uri@3.1.6`, together with `GHSA-qw65-cvwx-89v3` and `GHSA-hrr3-gc8f-f4qj`; these are not suppressed and are residual for a later wave.

The repository-wide vulnerability gate remains red because later-wave Electron/build/test/tooling findings remain. This is expected and is not merge authorization.

## Regression evidence

Passed locally:

- frozen pnpm install and package-resolution contract;
- Gateway auth and input-policy tests;
- Gateway idempotency ledger;
- mock Gateway and Provider fake-server tests;
- Provider protocol and existing real-provider canary definition (real canary remains skipped);
- 52 focused tests passed, 1 real-provider canary skipped;
- format, lint, typecheck, build;
- dependency direction, portability, workflow security, secret scan, first-pass license scan;
- golden and functional authority checks;
- `concurrently` process-start, failure-status propagation, and `-k` sibling termination probes.

The local full Vitest run reached 103 passed files and 1,031 passed tests. Five Python-dependent cases could not start because the host has Python `3.12.14`, while the repository requires exact Python `3.13.15`. The same local runtime limitation blocked `media-worker:test`. CI is configured with Python `3.13.15` and is the authoritative full-regression result.

The only repository-wide gate expected to remain red after functional checks is the vulnerability gate for authorized later waves. Windows packaged/native final security acceptance remains Wave B scope.
