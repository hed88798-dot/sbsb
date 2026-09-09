# Quality Infrastructure Change Request — PyInstaller WORKER_BUILD license evidence

Date: 2026-08-29 (Asia/Shanghai)

Status: `RESOLVED_BY_MAIN_B71B09B` (historical)

Resolution: Code F added Artifact License Evidence v2, Artifact Usage Binding v1 and License Policy
Evaluation v3 on `main@b71b09b90ddb905ac6703bdcf81e1dcdd13794c2`. Code C reran both exact wheel
scans and the shared contract suite: Windows/Linux worker-build usage binding and the Python license gate
passed under Policy `2026.08.29.1`, while wrong roles, stale contexts, cross-artifact evidence and bare GPL
remained fail closed.

Owner requested: Code F

Blocked work: Code C C-1 CPython 3.13.15 standard-GIL production supply-chain closure for PR #8

Historical failing baseline: `56e8233a93f0fbd69e7e0f752ce691e31624d69c`

Resolving baseline: `b71b09b90ddb905ac6703bdcf81e1dcdd13794c2`

Historical failing License Policy: `2026.08.28.2`

Resolving License Policy: `2026.08.29.1`

## Passed recovery gate

Before this new failure, Code C rebased onto the required main baseline and reran the historical license stop
with the public Code F evidence. The shared SPDX quality-tool lock and all 19 assertions in
`tests/contract/python-spdx-license-policy.test.ts` passed, including:

- PyInstaller toolchain and bootloader exception roles;
- packaging compound SPDX expression handling;
- exact Pillow Windows SHA-256
  `1cca606cd25738df4ed873d5ad46bbdb3d83b5cbca291f6b4ff13a4df6b0bbe8`;
- exact Pillow Linux SHA-256
  `0847a763afefb695bc912d7c131e7e0632d4edc1d8698f58ddabec8e46b8b6d3`;
- bundled-license SBOM records and notice materialization.

The previous MIT-CMU mandatory stop is resolved. This QICR records a different, subsequently executed
failure on the final WORKER_BUILD graph path.

## Exact failing artifact and metadata

The exact Windows build wheel was downloaded from its locked `files.pythonhosted.org` URL and verified:

```text
filename:
pyinstaller-6.22.2-py3-none-win_amd64.whl

SHA-256:
9b990fa6bbe143572f06644a984ad0d7aa2e2ccc6929d4916031343a5888e9a7

wheel METADATA License-Expression:
null

wheel METADATA legacy License:
GPLv2-or-later with a special exception which allows to use PyInstaller to build and distribute non-free programs (including commercial ones)

license file:
pyinstaller-6.22.2.dist-info/licenses/COPYING.txt

license file SHA-256:
dcf75fdb959db1e3b41c0f8505069d2ece781b5ec6b3d0a4d30975cfc6580245
```

The shared, reviewed toolchain identity is:

```text
GPL-2.0-or-later WITH Bootloader-exception
```

The Linux artifact is separately hash-locked as
`9622686ecc5d5fa492fe6cde29d47df9dd41138cff8177be9f901ca3260f2096`, but its independent formal
inventory/license assertion was not rerun after the Windows assertion triggered the mandatory stop.

## Actual shared assertion failure

Code C passed the exact wheel facts through the public
`tools/python-supply-chain/license.mjs#buildWheelLicenseEvidence` and then Policy `2026.08.28.2`.

```text
ARTIFACT_ROLE: PYTHON_BUILD_DEPENDENCY
DISTRIBUTION_ROLE: BUILD_ONLY_USE
DETECTED_LICENSE_EXPRESSION: GPL-2.0-or-later WITH Bootloader-exception
EVIDENCE_STATUS: MANUAL_REVIEW
EXCEPTION_EVIDENCE_COUNT: 0
POLICY_RESULT: FAIL
REASON: exception is not approved for this artifact/distribution role pair
```

This happens for two independent shared-contract reasons:

1. every non-runtime Python Artifact Inventory wheel is mapped to the generic
   `PYTHON_BUILD_DEPENDENCY` role, while the approved exception applicability requires
   `PYINSTALLER_BUILD_TOOL`;
2. wheel evidence always emits an empty `exception_evidence` array and Python Artifact Inventory v2 has no
   public, artifact-hash-bound field for the reviewed SPDX expression, exception source, or role decision.

The Toolchain Inventory path can express and pass the PyInstaller exception, but PyInstaller must also remain
in the complete WORKER_BUILD wheel graph. Omitting it from that graph, rewriting the wheel's descriptive
metadata, or treating the toolchain record as a reason to skip the wheel license gate would make the graph or
evidence false.

## Requested public change

Code F should provide one shared, fail-closed representation for an exact WORKER_BUILD wheel whose upstream
metadata is descriptive but whose license and exception have been reviewed:

1. bind the reviewed expression, artifact role, exception source, license-file hashes, and decision to the
   exact wheel SHA-256 through a public schema/contract;
2. let Artifact License Evidence consume that public record without a package-name exception or metadata
   rewrite;
3. preserve the distinction between PyInstaller build tool, PyInstaller bootloader, redistributed tool, and
   generated final Worker;
4. add contract tests for the exact Windows and Linux PyInstaller 6.22.2 wheel hashes;
5. prove bare/unknown GPL, a wrong artifact hash, a changed license file, missing exception evidence, and an
   inapplicable redistribution role still fail closed.

Code C must not add a private allowlist, private evidence schema, package-name role mapping, license rewrite,
verifier bypass, duplicate-graph omission, or one-file workaround.

## Mandatory-stop boundary

The new Windows WORKER_BUILD license assertion is `FAIL`. The historical MIT-CMU recovery gate, main ancestry,
continuation audit, standard-`cp313` negative-control unit check, and workflow security check are `PASS` because
they were executed before this failure.

Formal target inventories, hash installs, full graph SBOM/license/notice/vulnerability gates, Toolchain
Inventory approval, one-file builds, archive/native reconciliation, current-HEAD C regressions, remote Linux
CI, Windows native regression, push, and F review are
`BLOCKED_NOT_RERUN_AFTER_MANDATORY_STOP` for this resumed run.

That boundary applies only to the historical run. The exact-evidence recovery above cleared it for the current
C-1 continuation.
