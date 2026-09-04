# Code F: Native Runtime Companion Loader Policy Decision

Status: PASS for loader-policy authority only. This record does not build or approve an
ffprobe binary.

## Frozen authority

The policy is independently versioned as
`code-f-native-runtime-companion-loader-policy-flat-app-local-bundle-20260904-v1`.
Its semantic SHA-256 is recorded in
`compliance/runtime-dependency-intake/native-runtime-companion-v1/RUNTIME_LOADER_POLICY_RECORD_V1.json`
and its exact-byte SHA-256 is bound by the adjacent `.sha256` sidecar.

The policy binds the approved Generic Native Runtime Companion QICR and the immutable
FFprobe Build Profile v1. It does not change either authority. The current Worker already
supports an explicit ffprobe locator, so no Worker rebuild or modification is required.

## Bundle layout and resolution authority

`FLAT_APP_LOCAL_BUNDLE_V1` places the explicit entrypoint and only approved runtime
closure members at the companion bundle root. Runtime resolution is companion-bundle-only;
global `PATH`, the working directory, runner-preinstalled libraries, and user-installed
FFmpeg libraries are never authorities. External OS prerequisites remain a separate,
explicit allowlist and any undeclared prerequisite fails closed.

## Linux

Linux uses `ELF_RUNPATH_ORIGIN_V1`. The entrypoint and every ELF member that has bundled
`DT_NEEDED` dependencies must carry `DT_RUNPATH=$ORIGIN` themselves. `DT_RPATH`, absolute
RPATH/RUNPATH, and `LD_LIBRARY_PATH` authority are forbidden. Every `DT_NEEDED` import name
or declared SONAME/symlink must uniquely map to one manifest member; undeclared aliases and
symlinks fail closed. Code C must prove the complete transitive closure member by member.

## Windows

Windows uses `APP_LOCAL_SAME_DIRECTORY_V1`. The entrypoint is an explicit absolute bundle
path and all bundled DLLs are in the same approved companion directory. `PATH` and CWD are
not authorities. PE import names must uniquely map to manifest members, and runtime traces
must show every non-OS DLL loading from the companion root. Controlled benign decoy DLLs in
CWD and PATH are required negative tests and must not be consumed.

## Evidence and rechecks

The next artifact review must combine static import/dependency evidence with runtime loader
traces. For every requested name it records the resolved absolute location, classification,
manifest member identity when bundled, and exact resolved-file SHA-256 where applicable.
Version probes and a benign media probe run with the companion outside CWD and PATH; Linux
also runs with `LD_LIBRARY_PATH` unset. System-library shadowing is fail closed.

Any change to layout, linkage, RUNPATH/DLL strategy, member or import-name semantics,
external OS allowlist, PATH authority, Worker resolver semantics, Build Profile linkage,
or relevant source/profile authority reopens this policy before artifact build.

## Downstream boundary

Linux and Windows exact ffprobe artifacts remain unproduced and unapproved. License,
SBOM/NOTICE, native, final-distribution, vulnerability, SigLIP/index, and version-acceptance
rebinds are not run in this decision. After this policy is merged to `main`, Code C may begin
the separate exact Linux/Windows ffprobe source builds and artifact-level evidence review.
