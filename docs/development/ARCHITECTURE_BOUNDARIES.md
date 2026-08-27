# v0.1 Architecture Boundaries

## Runtime authority

```text
Sandboxed React Renderer
  → named DesktopApiV1 methods only
Preload contextBridge allowlist
  → validated IPC v1 channels only
Electron Main Process
  → Product/Copywriting/Job services
  → local-db (sole SQLite writer)
  → TextCapabilityClient (Gateway contract)
  → stdio NDJSON mock sidecar fixture
```

Renderer has no Node integration, filesystem, child process, SQLite handle, shell, generic IPC, arbitrary fetch capability, Provider Key, or access token persistence. Main validates sender window/frame/origin and every IPC request. Preload validates every response before returning it to React.

## Code ownership

| Boundary                                 | v0.1 status                          | Owner                             |
| ---------------------------------------- | ------------------------------------ | --------------------------------- |
| `apps/desktop`                           | Implemented                          | Code A                            |
| `packages/domain-product`                | Implemented                          | Code A                            |
| `packages/domain-copywriting`            | Implemented                          | Code A                            |
| `packages/local-db`                      | Implemented                          | Code A                            |
| `packages/provider-client`               | Text capability contract/client only | Code A contract boundary          |
| `apps/gateway`                           | NON_PRODUCTION mock only             | Code B owns formal implementation |
| `packages/provider-adapters`             | README boundary only                 | Code B                            |
| `sidecars/media-worker`                  | README boundary only                 | Code C                            |
| `packages/domain-media-index`            | README boundary only                 | Code C                            |
| `packages/domain-auto-edit` / `timeline` | README boundary only                 | Code D                            |
| `packages/domain-digital-human`          | README boundary only                 | Code E                            |

The Code A Python mock lives in `tests/fixtures/mock-sidecar/` and is not the formal media worker.

## Static dependency rules

CI fails on:

- `renderer → local-db / better-sqlite3 / Node fs / child_process`;
- `desktop → provider-adapters`;
- `domain-copywriting → vendor SDK / provider-adapters`;
- `domain-auto-edit → domain-digital-human`;
- `provider-adapters` as a Desktop dependency.

## Data and contracts

- IPC schema version: `1.0`.
- Sidecar protocol version: `1.0`.
- Migration version: `1`.
- SQLite uses WAL, `foreign_keys=ON`, a Main-only writer, version/checksum timestamps, and online backup before an existing database is upgraded.
- UI and domain objects never depend on raw SQLite rows.
- Every AI request saves request hash, Product Fact Snapshot, prompt template id/version, provider/model alias, raw output, normalized result and conflict evidence.
- A deterministic fact conflict yields `REVIEW_REQUIRED`; it never silently appears as an ordinary accepted result.

## Frozen contract escalation

If implementation requires changing IPC Contract, SQLite public Schema, Provider Protocol, Sidecar Protocol, public Job semantics, or a cross-module domain Contract, stop the affected work and submit:

```text
ARCHITECTURE QUESTION

问题：
现有契约：
为什么无法继续：
建议修改：
影响范围：
是否阻塞当前工作：
```

Do not edit accepted ADR history or continue behind an unreviewed contract change.
