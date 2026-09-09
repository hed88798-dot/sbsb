# Quality Infrastructure Change Request — generic exact-wheel license evidence

Date: 2026-08-29 (Asia/Shanghai)

Status: `OPEN_MANDATORY_STOP`

Owner requested: Code F / Quality, Release & Compliance

Blocked work: Code C C-1 CPython 3.13.15 Candidate validation and PR #8

Required main quality baseline: `1bd82edb2e22e5038e29c2df63df779f86df2716`

Code C validation HEAD: `92550e038c43ff0b1d832c7819d3a3873d1a2972`

Remote validation run: `33243775925`

Build Context: `code-c-pyinstaller-c58ed4e81b3faba399eaf8af4fec57f2`

Candidate Worker SHA-256: `f974bd771fffe01004f0a51e432115ca8cd63952469e0b4de9d146843a09a5cb`

Final CArchive SHA-256: `7d146bee183903c93c73942a82c281e6740fa5f85545e5204eeeb45c08323734`

## First real failure

The exact Linux Candidate passed its locked interpreter, wheel graph, hash-lock installation, PyInstaller
build-evidence capture, Packaging Selection Evidence v1, and Native Reconciliation v3 gates. Native
Reconciliation reported 151 approved, 117 selected, 117 materialized, 117 final native entries, and 32
semantic CArchive symlinks.

The next executed gate was the shared Python wheel license first pass. Its first reported assertion failed on
`flatbuffers==25.12.19` because the exact wheel has no PEP 639 `License-Expression`; its legacy `License` value
is `Apache 2.0`, which is not an SPDX expression. The same gate reported equivalent evidence-shape failures
for six more exact artifacts before exiting nonzero:

| Package                          | Exact Linux wheel SHA-256                                          | `License-Expression` | Legacy `License` status         | Wheel license evidence files |
| -------------------------------- | ------------------------------------------------------------------ | -------------------- | ------------------------------- | ---------------------------- |
| flatbuffers 25.12.19             | `7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4` | absent               | `Apache 2.0`                    | none                         |
| numpy 2.3.5                      | `11e06aa0af8c0f05104d56450d6093ee639e15f24ecf62d417329d06e522e017` | absent               | full descriptive license bundle | 4                            |
| onnxruntime 1.29.0               | `e2128f31f449e922c62dbe5d8b6b7b079f0bcaf2d56a102fa203cb6e5bb5ab19` | absent               | `MIT License`                   | 1                            |
| opencv-python-headless 4.14.0.94 | `211e581f5a4670acbbe08fff36a35e9946039d2eea28b80394632d036d1be527` | absent               | `Apache 2.0`                    | 4                            |
| protobuf 7.36.0                  | `70f5ec8eb0da81a44360c0dc0beac99a0d78071d21956a7076bae8bd2051841b` | absent               | `3-Clause BSD License`          | 1                            |
| sentencepiece 0.2.1              | `c7f0fd2f2693309e6628aeeb2e2faf6edd221134dfccac3308ca0de01f8dab47` | absent               | absent                          | none                         |
| pyinstaller-hooks-contrib 2026.7 | `24257a04c7a5a7a034cf28e39dcee20fbeeb9f043076729480f2e1b69904408a` | absent               | absent                          | 1                            |

These are the exact artifacts selected by the Linux CPython 3.13.15 standard-GIL Candidate. The hashes were
reconfirmed against fresh downloads from their locked `files.pythonhosted.org` release artifacts, and their
metadata/license-file facts were reproduced with the repository wheel inspector.

PyInstaller 6.22.2 also reported a missing context-bound usage evaluation later in the same aggregated gate
output. That is a separate Code C workflow integration defect and is not used to justify this QICR. Under the
mandatory-stop rule, C is stopping on the earlier generic-wheel evidence failure and is not repairing the
later PyInstaller assertion in this continuation.

## Shared-contract reproduction

The shared `buildWheelLicenseEvidence` implementation currently has only these generic paths:

1. preserve the exact upstream legacy `License` value in the approved inventory; or
2. store an owner-reviewed SPDX expression in the approved inventory.

Both paths fail closed for these real artifacts:

- preserving `Apache 2.0` produces `FAIL` because the SPDX parser rejects the expression;
- recording reviewed `Apache-2.0` produces `MANUAL_REVIEW` because it differs from the legacy metadata;
- recording reviewed `BSD-3-Clause` for the exact NumPy wheel still produces `MANUAL_REVIEW`, even when the
  exact license-file hash is present;
- recording the already reviewed `Apache-2.0 OR GPL-2.0-or-later` identity for the exact
  `pyinstaller-hooks-contrib` wheel still produces `MANUAL_REVIEW`;
- a wheel with no discovered license file is forced to `MANUAL_REVIEW`, even when other immutable upstream
  evidence supports a reviewed expression;
- release mode converts every one of these `MANUAL_REVIEW` decisions into a blocking failure.

Artifact License Evidence v2 is publicly available, but the Python wheel license gate only consumes it
together with Artifact Usage Binding v1 for the exact PyInstaller build-tool role. The current replacement
logic explicitly requires `PYINSTALLER_BUILD_TOOL` and therefore cannot represent an ordinary runtime wheel
or an independent build dependency such as `pyinstaller-hooks-contrib`. Bundled License Evidence v1 is
separately consumed for Pillow; it is not a generic top-level license-decision input for these artifacts.

This leaves no shared, release-capable path for an exact legal wheel whose upstream metadata is legacy,
descriptive, or empty. A Code C package-name mapping, license-string rewrite, private evidence schema, or
private allowlist would hide the evidence conflict and is prohibited.

## Requested public change

Code F should provide an additive, shared, fail-closed way for the Python wheel license gate to consume a
reviewed exact-artifact license decision for ordinary runtime and build-dependency wheels:

1. bind the decision to the exact wheel filename, SHA-256, package/version, download provenance, metadata
   hash, complete license-candidate inventory, and every referenced license-file hash;
2. keep immutable artifact license facts separate from usage/distribution roles;
3. support absent, legacy, and descriptive metadata without rewriting the upstream field;
4. preserve path-scoped and bundled third-party license evidence rather than collapsing it into one top-level
   expression;
5. let the shared Python wheel license gate replace `MANUAL_REVIEW` only when the exact reviewed evidence and
   role/distribution context reconcile;
6. accept repeatable evidence inputs for multiple wheel artifacts in one inventory closure;
7. reject a changed artifact hash, metadata conflict, missing evidence file, changed evidence-file hash,
   ambiguous owner, wrong role, stale usage context, or unreviewed SPDX branch;
8. prove that PyInstaller's Bootloader exception cannot propagate to `pyinstaller-hooks-contrib` or any other
   artifact.

The public change must not be a package-name license exception and must not make descriptive legacy text
silently equivalent to SPDX.

## Mandatory-stop boundary

The current Linux Candidate's Stage A prerequisite, build context, Worker build, Packaging Selection Evidence
v1, Native Reconciliation v3, wheel inventory approval, and hash-lock generation remain passed evidence for
the exact validation HEAD and Build Context already produced by run `33243775925`.

The Python license gate is `FAIL`. CVE-2026-15806 Stage B, CVE-2026-15310 Stage B, real SigLIP ONNX E2E,
current-HEAD index/core regressions, subsequent Linux/Windows validation, F vulnerability review, PR #8 push,
and F Code C final review are `BLOCKED_NOT_RERUN_AFTER_MANDATORY_STOP`.

No Windows later-layer log is used in this finding. PR #8 remains unchanged.
