# Code B Fastify 5.12.1 security remediation

Date: 2026-09-03. Owner: Code B. Independent quality/release reviewer: Code F (pending).

## Scope and baseline

Base: `main@06c4620e8738bd63f8674e15d1158042a65c1d28`.
Branch: `code-b/fastify-security-5.12.1`.

This is the narrow Gateway dependency remediation requested after PR #32 encountered the
existing-main Fastify blocker. It is not another foundation implementation or a release approval.
Fastify is pinned exactly from `5.8.5` to `5.12.1`; Node `24.19.0`, pnpm `11.19.0`,
better-sqlite3 `13.0.3`, Gateway source, public contracts, workflows and vulnerability policy
are unchanged. No advisory suppression or exception is added.

## Advisory evidence

- [GHSA-w2qp-rph6-63g4](https://github.com/advisories/GHSA-w2qp-rph6-63g4):
  root primitive body coercion mismatch; affected `<5.12.1`, fixed `5.12.1`.
- [GHSA-3m5p-2c4r-xxw2](https://github.com/advisories/GHSA-3m5p-2c4r-xxw2):
  numeric `trustProxy` forwarded-header spoofing; affected `>=5.8.3 <5.12.1`, fixed `5.12.1`.
- [Upstream release](https://github.com/fastify/fastify/releases/tag/v5.12.1).

Both upstream advisories are Moderate; Code F designated the remediation a project P1 blocker.
The unchanged Gateway uses `Fastify({ logger: false, bodyLimit: 1024 * 1024 })`, not numeric
`trustProxy` or root primitive Fastify body schemas. This observation does not exempt the
installed dependency from the existing all-workspace Moderate-or-higher audit gate.

## Exact artifact and dependency intake

Fastify is a direct server-only Gateway production dependency, not a Provider SDK or Desktop
runtime dependency. Code B prepared this engineering intake; independent Code F review and
final artifact/NOTICE review remain required. Re-review on any version, hash, graph, advisory,
deployment or policy change; this document grants no time-unlimited approval or exception.

| Artifact                    | Official package URL                                                             | Downloaded tarball SHA-256                                         | License |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| `fastify@5.12.1`            | <https://registry.npmjs.org/fastify/-/fastify-5.12.1.tgz>                        | `ecd2c7b23757e069ad8484a328b69707842729a01e7d6a27890987d5cc4b051a` | MIT     |
| `fast-json-stringify@7.0.1` | <https://registry.npmjs.org/fast-json-stringify/-/fast-json-stringify-7.0.1.tgz> | `a887740fd16ad88d84b0669ca182cdb06776750739752166d63e184569356a31` | MIT     |

The registry SHA-512 integrities are pinned in `pnpm-lock.yaml`. Source projects are
[fastify/fastify](https://github.com/fastify/fastify) and
[fastify/fast-json-stringify](https://github.com/fastify/fast-json-stringify).
Installed LICENSE files identify the Fastify team, and additionally Matteo Collina for
fast-json-stringify. MIT permits commercial use, modification and redistribution subject
to retaining copyright and permission notices; no source-offer obligation was identified.
The downloaded package/hash and installed license text were checked, but no independent
upstream signature/provenance attestation verification or final installer acceptance is claimed.

Minimal lockfile delta:

- Replace `fastify@5.8.5` with `5.12.1`.
- Fastify's direct `fast-json-stringify` edge changes `6.4.0` to `7.0.1` (upstream now requires
  major 7). `7.0.1` was already locked through `@fastify/fast-json-stringify-compiler@5.1.0`;
  the unused `6.4.0` record is removed. No new transitive package/version is introduced.
- Every other package resolution, including both existing AJV 8 versions, is preserved.

## Local verification

Fresh branch worktree, newly installed node_modules, frozen lockfile; shared pnpm download
store. This is not claimed as an isolated-cache clean-checkout PASS.

- PASS: `pnpm install --frozen-lockfile`, `ci:prepare`, full workspace `build`, `format:check`,
  `lint`, `ci:typecheck`, `package:resolution` (2 tests).
- PASS: Gateway auth/input-policy, idempotency/ledger, migration/backup and mock-Gateway
  targeted regressions: 5 files / 21 tests.
- PASS: direct installed-Fastify checks for root primitive coercion (`"10"` is delivered as
  number 10), range rejection (`"11"` rejected), and numeric `trustProxy` ignoring spoofed
  forwarded host/protocol/IP. These were one-off local diagnostic checks, not new CI tests.
- PASS: dependency direction, portability, workflow security, secret scan, license scan
  (664 npm packages, 0 manual-review licenses), Python supply-chain and current-target gates,
  approval contract, golden manifest, license-policy/artifact-license/coverage and runtime
  prerequisite verification. Existing external runtime prerequisite remains BLOCKED.
- PASS: full-workspace `pnpm audit --audit-level moderate`: Moderate 0, High 0, Critical 0;
  one existing development-only Low finding remains below the unchanged gate threshold:
  `esbuild@0.27.7`, [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).
  Its locked version is unchanged; it is outside this Gateway remediation. No zero-vulnerability claim.
- PASS: manifest, lockfile, installed `pnpm --filter @app/gateway why fastify`, production
  dependency graph and generated SBOM all select only Fastify `5.12.1`.
- SBOM generated by the unchanged tool: 664 npm + 6 compliance-tool components. It remains
  a release-blocking scaffold, not an installer-complete release SBOM. CI regenerates it
  with the exact tested commit and uploads the existing compliance artifact.

`pnpm check` is **not locally PASS**: 305 tests passed, one paid canary skipped, four suites
could not initialize and one vertical smoke failed because this host has Python `3.12.13`,
not the mandatory `3.12.10`. No Python code, expected version or tests were weakened.
Linux and Windows workflows already install exact `3.12.10`; their results must bind this
PR's current HEAD. Isolated clean-checkout verification is delegated to the existing Linux job.

## Required handoff gates

At source submission: Linux `quality`, Linux `isolated-clean-checkout`, Windows
`packaged-native-addon` and independent Code F review are PENDING. Record final run URLs,
tested HEAD and regenerated SBOM evidence in the PR after checks finish, without changing
the tested code solely to record those results. PR #32/main remain blocked by the old
dependency until this remediation is reviewed, normally merged and consumed by that branch.
No direct main push, PR #32 mutation, automatic merge or final release approval is authorized here.

```text
CONTRACT_BASELINE_CHANGED: NO
PRODUCTION_PROVIDER_APPROVAL: BLOCKED
REAL_TEXT_PROVIDER_SMOKE: BLOCKED
REAL_BUCKET_CANARY: BLOCKED
CODE_B_FOUNDATION_ACCEPTANCE: BLOCKED
V0_2_ACCEPTANCE: BLOCKED
```

Ordinary PR CI remains mock/fake/deterministic only and receives no real Provider or bucket
credentials. Gateway fail-closed production defaults and all known foundation limitations
are unchanged.
