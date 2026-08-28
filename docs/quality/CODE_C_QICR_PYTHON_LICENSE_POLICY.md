# Quality Infrastructure Change Request — Python wheel license decisions

Date: 2026-08-28 (Asia/Shanghai)

Status: `RESOLVED_BY_MAIN_84E7BEF` (historical)

Resolution: License Policy Evaluation v2 and Artifact License Evidence v1 on
`main@84e7befb53cbcbc28fb39924ad36cce408d0760b` now pass the PyInstaller bootloader exception and packaging
compound expression. The current, separate runtime-wheel blocker is recorded in
`CODE_C_QICR_PYTHON_RUNTIME_LICENSE_POLICY.md`.

Owner requested: Code F

Blocked work: Code C C-1 Python/Wheel/Native/PyInstaller supply-chain closure for PR #8

## Reproduction

Code C evaluated the exact Windows and Linux dependency closures from real wheel `METADATA` for CPython
3.13.15. The shared `auditPythonLicenses` assertion was then executed against two exact downloaded wheels:

| Component | Exact artifact SHA-256 | Required/metadata expression | Shared result |
| --- | --- | --- | --- |
| PyInstaller 6.22.2 Windows | `9b990fa6bbe143572f06644a984ad0d7aa2e2ccc6929d4916031343a5888e9a7` | `GPL-2.0-or-later WITH Bootloader-exception` | `rejected/unknown license` |
| packaging 26.3 universal | `d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c` | `Apache-2.0 OR BSD-2-Clause` | `rejected/unknown license` |

The Linux PyInstaller wheel has SHA-256
`9622686ecc5d5fa492fe6cde29d47df9dd41138cff8177be9f901ca3260f2096` and the same required license
decision.

This is an internal contract contradiction, not a request to waive licensing:

- Toolchain Inventory v1 requires PyInstaller and PyInstaller bootloader licenses to preserve the
  `Bootloader-exception` text.
- The shared wheel license policy applies blocked patterns before exact allow/manual-review decisions, so
  every expression containing `GPL` is rejected, including the required PyInstaller exception.
- Omitting PyInstaller from `WORKER_BUILD`, changing its license to MIT, or representing its wheel only as a
  toolchain component would make the dependency graph or provenance false.

Other exact upstream `License-Expression` values in the approved graph are also currently unrepresentable by
the shared policy, including:

- `Apache-2.0 OR BSD-2-Clause` (packaging 26.3)
- `MIT-CMU` (Pillow 12.3.0)
- `Apache-2.0 AND CNRI-Python` (regex 2026.7.19)
- `PSF-2.0` (typing-extensions 4.16.0)
- `MPL-2.0 AND MIT` (tqdm 4.70.0)
- PyTorch 2.13.0's exact composite SPDX expression

Several legal wheels also provide license files but omit `License-Expression`/legacy `License`. Inventory v2
can store an owner-reviewed expression, but the release-mode shared audit has no structured,
artifact-hash-bound decision object that can resolve this state.

## Requested public change

Code F should make one shared, fail-closed change for all owners:

1. support explicit, reviewed exact SPDX expressions before generic blocked-pattern matching, so a narrow
   exception such as `GPL-2.0-or-later WITH Bootloader-exception` does not weaken the default GPL block;
2. publish the reviewed allowed/manual decisions for the exact legal expressions above;
3. add a shared, structured artifact-hash-bound license decision/evidence mechanism for wheels whose metadata
   is legacy, descriptive, or empty, and have release mode consume that evidence;
4. add contract tests proving unknown GPL remains rejected, the exact PyInstaller exception is accepted only
   when explicitly reviewed, metadata conflicts still fail, and unbound/manual text cannot approve an
   artifact.

Code C must not add a private allowlist, private schema, package-name override, or verifier bypass while this
request is open.

## Unblocked work already proven

- required main baseline ancestry: PASS (`c7f1b1db4d60eb75127b7b2c7f8462794d7a42b1`)
- old continuation workaround audit: PASS
- exact current maintained CPython target: 3.13.15
- Windows cross-target metadata preflight: PASS (runtime 13, build 7, export 31, evaluation 31)
- Linux cross-target metadata preflight: PASS (runtime 12, build 5)
- pinned pip 26.2.1 bootstrap without runner pip: PASS
- wrong hash, user pip config, extra index, sdist, VCS, floating URL, and arbitrary local input rejection: PASS
- shared Python supply-chain contract tests on CPython 3.13.15: PASS (22 passed, 1 platform skip)
- frozen media-worker regression on CPython 3.13.15 candidate wheels: PASS (18 tests)

Remote candidate generation, formal inventory approval, final one-file reconciliation, CI integration, and
push are intentionally not performed after this mandatory stop.
