# QICR-002: PyInstaller file-level license and worker-build usage binding

- Status: Resolved by shared contract extension
- Date: 2026-08-29
- Owner: Code F / Quality, Release & Compliance
- Trigger: Code C C-1 mandatory stop on the exact Windows PyInstaller 6.22.2 wheel

## Mandatory-stop finding

Artifact License Evidence v1 stores `artifact_role` and `distribution_role` beside immutable
artifact facts. It cannot represent one wheel as both a dependency-graph build dependency and a
functional PyInstaller build tool in one build context without changing the meaning of the old
field. It also cannot preserve package-level and path-scoped license evidence from the same wheel.

The exact Windows and Linux wheels were downloaded and hash-verified before inspection:

- Windows `9b990fa6bbe143572f06644a984ad0d7aa2e2ccc6929d4916031343a5888e9a7`
- Linux `9622686ecc5d5fa492fe6cde29d47df9dd41138cff8177be9f901ca3260f2096`

Both contain one `pyinstaller-6.22.2.dist-info/licenses/COPYING.txt` with SHA-256
`dcf75fdb959db1e3b41c0f8505069d2ece781b5ec6b3d0a4d30975cfc6580245`. The text provides the
package GPL-2.0-or-later terms, the Bootloader exception for `PyInstaller/bootloader/` and
`PyInstaller/loader/`, Apache-2.0 for `PyInstaller/hooks/rthooks/`, and GPL-2.0-or-later or MIT for
`PyInstaller/isolated/`. No second LICENSE/NOTICE candidate exists in either exact wheel.

## Resolution

Artifact License Evidence v2 records only canonical artifact identity and package/file-level
license facts. Artifact Usage Binding v1 independently binds the exact SHA-256 to Build Artifact
Provenance v1, dependency role, functional role, distribution role, exception sources, current
policy identity and reachability. License Policy Evaluation v3 evaluates the joined records.

The v1 evidence reader and License Policy Evaluation v2 remain unchanged for historical replay.
No old field is reinterpreted. Policy `2026.08.28.2` is archived unchanged; policy
`2026.08.29.1` identifies the new context-bound evaluation behavior without broadening the
underlying SPDX allow/deny rules.

## Fail-closed conditions

The shared evaluator rejects a mismatched SBOM/toolchain/evidence hash, stale or different build
context, exception artifact/context/role/policy mismatch, wrong functional/distribution role,
bare GPL, and exception evidence borrowed by `pyinstaller-hooks-contrib` or another artifact.

Build-only PyInstaller remains in the build SBOM and internal compliance evidence. It is excluded
from the runtime SBOM and customer notices unless a later, separately reviewed distribution
binding says that its bytes are reachable from the shipped artifact. The final worker and
bootloader retain their separate existing roles.
