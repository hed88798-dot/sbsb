# Code F Status Report — Quality, Release & Compliance Foundation

报告日期：2026-08-27（Asia/Shanghai）

```text
BRANCH:
code-f/quality-release-foundation

BASELINE_SHA:
b04b8c152cd3e589b17246f53bab16262aefe313

VERIFIED_IMPLEMENTATION_SHA:
871c5baa13648b978043f0bc6f1f34c9b50a9799

FINAL_SHA:
SEE_FINAL_DELIVERY_MESSAGE — a committed file cannot contain its own Git object ID; the exact pushed head is reported after the final report commit.

MAIN_ARTIFACT_SHA:
NOT_AVAILABLE

ARTIFACT_SHA256:
NOT_AVAILABLE

BUILD_RUN_ID:
NOT_AVAILABLE

WINDOWS_CLEAN_VM:
BLOCKED

INSTALL:
FAIL — NO FORMAL MAIN ARTIFACT / VM EVIDENCE

LAUNCH:
FAIL — NO FORMAL MAIN ARTIFACT / VM EVIDENCE

UPDATE:
FAIL — NO APPROVED PREDECESSOR + MAIN CANDIDATE EVIDENCE

DATA_AFTER_UPDATE:
FAIL — UPDATE NOT EXECUTED

UNINSTALL:
FAIL — FORMAL MAIN INSTALLER NOT EXECUTED

DATA_AFTER_UNINSTALL:
FAIL — UNINSTALL NOT EXECUTED

ROLLBACK / UPDATE_FAILURE:
NOT_YET_AUTOMATED

CLEAN_CHECKOUT:
PASS — isolated store/worktree at 871c5baa13648b978043f0bc6f1f34c9b50a9799

PR_GATE:
PASS — local equivalent; remote PR checks not yet run on this branch

WINDOWS_E2E:
FAIL — WORKFLOW READY, NO MAIN RUN / CLEAN VM RESULT

SECRET_GATE:
PASS — tracked source + compiled output + local packaged asar; formal Windows installer evidence remains blocked

LICENSE_GATE:
PASS — PR first-pass (617 packages, 0 unknown/review) and local packaged asar inventory (81 packages); stable final-artifact/NOTICE review remains blocked

SBOM_SCAFFOLD:
PASS — CycloneDX 1.6, 617 source/build components, explicitly marked installer-incomplete

GOLDEN_SET_INFRASTRUCTURE:
PASS — schema, versioned manifest, authorization/provenance, SHA-256 integrity and locked test split

REQUIRED_CHECKS_REVIEW:
PASS — expected checks documented; remote branch-protection enforcement UNVERIFIED

CI_SECRET_SECURITY:
PASS — read-only PR permissions, commit-pinned Actions, no pull_request_target, signing secrets isolated to manual main environment

KNOWN_P0:
NONE

KNOWN_P1:
NONE

RELEASE_BLOCKERS:
1. Code F workflow/tooling is not yet merged to main; branch artifact cannot receive formal PASS.
2. No immutable signed main installer with SHA-256 and workflow run ID exists for this gate.
3. No resettable Windows 10/11 clean-VM runners are available/configured.
4. release-signing environment / Authenticode material is not configured or evidenced.
5. No approved predecessor installer artifact/run ID exists for update/rollback.
6. Update interruption, partial download and migration-failure recovery are NOT_YET_AUTOMATED.
7. Real Text Provider implementation is not merged to main; F cannot execute formal Desktop → Gateway → Provider smoke.
8. Installer-complete SBOM, final THIRD_PARTY_NOTICES and remote required-check enforcement are not yet evidenced.

ARCHITECTURE_QUESTIONS:
NONE
```

## Verification evidence

- Fixed toolchain local gate: Node `24.19.0`, pnpm `11.19.0`, Python `3.12.13`.
- `pnpm check`: `PASS` — format, lint, typecheck, 16 test files / 152 tests, dependency direction, full-repository portability, workflow security, source secret, license first-pass and Golden manifest.
- Detached clean checkout with no generated state and isolated pnpm store: `PASS` at `871c5baa13648b978043f0bc6f1f34c9b50a9799`.
- macOS arm64 unpacked Electron packaged native SQLite smoke: `PASS`（只作为打包工具回归，不替代 Windows）。
- Local compiled/release scan and extracted asar scan: `PASS`; dependency test directories are excluded from the installer to avoid shipping irrelevant test fixtures.
- Artifact license inventory against extracted local asar: `PASS` — 81 packages, 0 unknown/manual-review entries（不替代 Windows installer + Electron/Chromium/native NOTICE 复核）。
- `ALL_V0_1_ACCEPTANCE = BLOCKED`; no stable tag is authorized.
