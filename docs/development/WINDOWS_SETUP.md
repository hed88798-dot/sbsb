# Windows Development and Packaging

## Fixed toolchain for v0.1

| Component                   |            Version |
| --------------------------- | -----------------: |
| Node.js                     |        24.19.0 x64 |
| pnpm                        |            11.19.0 |
| Electron                    |             43.4.1 |
| electron-builder            |            26.15.3 |
| better-sqlite3              |             13.0.3 |
| bundled SQLite              |             3.53.4 |
| Python for the mock sidecar | 3.12.x recommended |

Use Windows 10 22H2 or Windows 11 x64, Git for Windows, Visual Studio Build Tools with the Desktop C++ workload, and Python 3.12 x64. Do not use a network share for the repository, pnpm store, application database, or WAL files.

## Install and verify

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm secret:scan
pnpm license:scan
```

The local business database is stored under:

```text
%LOCALAPPDATA%\Company\AiVideoDesktop\app.db
```

Uninstall is configured with `deleteAppDataOnUninstall: false`; application removal must not silently delete business data.

## Native addon rebuild

`better-sqlite3` must be rebuilt against Electron, not only the development Node ABI:

```powershell
pnpm native:rebuild
```

The command uses electron-builder 26.15.3 → `@electron/rebuild` → Electron 43.4.1 for the current Windows architecture. The builder configuration also uses:

```yaml
npmRebuild: true
buildDependenciesFromSource: true
nativeRebuilder: sequential
asarUnpack:
  - '**/*.node'
```

## Build and unpacked smoke

```powershell
pnpm package:dir
$env:REQUIRE_PACKAGED_SMOKE='1'
pnpm test -- tests/integration/native-addon-packaging.test.ts
```

The packaged executable is launched with `DESKTOP_NATIVE_SMOKE=1`; it opens the packaged migration resource, creates a temporary SQLite database, writes and reads a value through better-sqlite3, and must print:

```text
NATIVE_SQLITE_SMOKE:PASS
```

This catches the common failure where development Node can load better-sqlite3 but packaged Electron cannot because of an ABI mismatch.

## Clean Windows release checklist

Run on a clean Windows 10 and Windows 11 VM, not only a developer machine:

1. Build the signed NSIS artifact from a clean lockfile checkout.
2. Install per-user and launch without Visual Studio or Node installed.
3. Create/update/delete a synthetic product and add a local image reference.
4. Run a mock product-copywriting job and inspect task history.
5. Run the packaged SQLite native smoke.
6. Install the next signed test build through the update path and verify database backup/migration.
7. Uninstall and verify `%LOCALAPPDATA%\Company\AiVideoDesktop\app.db` remains.
8. Reinstall and verify the existing data opens.

Record `PASS`, `FAIL`, or `BLOCKED` separately for Windows VM, code signing, update, install, launch, native SQLite, data retention, and uninstall. macOS/Linux build success is not a substitute.

## Troubleshooting native ABI

- Confirm `pnpm exec electron --version` is `v43.4.1`.
- Re-run `pnpm native:rebuild` after any Electron or better-sqlite3 change.
- Ensure the `.node` file is outside asar or listed in `asarUnpack`.
- Never copy a native addon from a different architecture or Node-only build.
- Do not bypass a rebuild failure by disabling SQLite or silently creating a second database.
