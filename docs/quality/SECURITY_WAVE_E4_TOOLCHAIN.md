# Security Wave E4 toolchain resolution

Base: c3a0d54dd4aa44c68201540e1a9dc171a861a11e. Phase A commit
49c8179 preserves wait-on 9.5.1 while refreshing follow-redirects to 1.16.2 and
Joi to 18.3.1. wait-on is used by the Desktop development startup script.

The sole import-plugin rule is replaced by SOURCE_RUNTIME_CYCLE_POLICY_V1.
Neither eslint-plugin-import nor import-x remains a dependency. Retirement removes
the legacy import-plugin -> minimatch 3 edge, not every old minimatch node by itself.

All final minimatch nodes resolve to 11.0.3 through parent-specific policies:

| Parent scope                                     | Reason and compatibility evidence                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @electron/asar 4.3.1                             | Modern named API; API/CLI pack/list/read/extract, unpack integrity and POSIX symlink tests                                                                                                                                                                                                                                                     |
| @electron/asar 4.3.1 -> glob 14.0.3              | Modern glob API; also removes the new glob cancellation Moderate affecting glob 13; same ASAR tests                                                                                                                                                                                                                                            |
| app-builder-lib 26.15.3 -> ASAR 4.3.1            | Replace exact legacy ASAR pin; same package entry used by builder, validated by package:dir/native smoke                                                                                                                                                                                                                                       |
| app-builder-lib 26.15.3 -> universal 3.0.6       | Modern ASAR ownership; retires legacy dir-compare callable-minimatch branch; builder uses dynamic named makeUniversalApp import                                                                                                                                                                                                                |
| app-builder-lib 26.15.3 -> Squirrel peer removal | Squirrel is not an accepted target: frozen Desktop config uses NSIS. Remove the unused auto-installed peer instead of replacing incompatible glob 7 inside its winstaller/temp/rimraf chain. NSIS config remains unchanged; package:dir/native smoke must pass. Squirrel tooling is intentionally unavailable; adding it later requires review |
| app-builder-lib 26.15.3 -> minimatch 11.0.3      | Modern named matching API; package:dir/native smoke                                                                                                                                                                                                                                                                                            |
| filelist 1.0.6 -> minimatch 11.0.3               | Existing module.match API; direct real FileList include/expansion regression                                                                                                                                                                                                                                                                   |
| typescript-estree 8.50.1 -> minimatch 11.0.3     | Modern parser matching; full ESLint/typecheck and fixture regressions                                                                                                                                                                                                                                                                          |
| eslint 9.39.2 -> minimatch 11.0.3                | Isolated same-version full-repository lint probe before adoption; then actual full lint                                                                                                                                                                                                                                                        |
| config-array 0.21.2 -> minimatch 11.0.3          | Minimatch constructor consumer; isolated core probe and actual full lint                                                                                                                                                                                                                                                                       |
| eslintrc 3.3.6 -> minimatch 11.0.3               | Minimatch constructor consumer; isolated core probe and actual full lint                                                                                                                                                                                                                                                                       |

No global minimatch override, fork, vendored source, audit suppression or severity
change is used. An attempted glob 7 -> minimatch 11 probe failed due to removed
internal pattern fields; that override was withdrawn rather than committed.
E1 ASAR 3 and E3 import-x failure evidence remain unchanged.

Direct ASAR CLI remains necessary for the existing Windows installer workflow.
ASAR 4 CLI is asar.mjs; repository code imports its named ESM API. Packaging config,
Electron 43.8.3, electron-builder 26.15.3, SQLite/native ownership and runtime v2
authority remain unchanged. ASAR is tested for unpacked native-file metadata and
archive content integrity. POSIX symlink reads are tested locally/Linux; the
symlink-only test is skipped on Windows to avoid adding OS privilege prerequisites.
Windows native rebuild/package:dir/required packaged smoke are separate mandatory
acceptance gates and must not be inferred from POSIX probes.

The inherited @eslint/js 10.0.1 -> ESLint 10 peer warning predates this change.
No ESLint major change or recommended-rule downgrade is made to hide it; no new
peer mismatch is introduced. License scanning reports no unresolved/manual review.
Only the historical esbuild Low is permitted; all Moderate-or-higher findings
must remain absent under the unchanged audit command.

Prompt v3, all goldens, schemas, Provider/Gateway, migrations, UI, Timeline and
Render are unchanged. No real Provider request or product Render is part of this
security task. This document records toolchain intent; actual CI run evidence is
reported separately in the Draft PR.
