# Code F — Exact FFmpeg source release and ffprobe Build Profile v1

Status: PASS (source authority and semantic build intent only)

Baseline: `fc6816214b7d4f56d691309ed6b2fd628ad25f79`

This decision closes the pre-build governance blocker for the generic native runtime
companion. It pins an upstream FFmpeg release, its exact source archive identity, and one
platform-neutral ffprobe build profile. It does not download or build ffprobe, approve a
future executable, or change the Worker.

## Product capability authority

The capability set is derived from the frozen V1 product and Local Media Index documents:

- `PRODUCT_V1_SCOPE.md` defines local-folder media indexing and the end-to-end probe → index flow.
- `LOCAL_MEDIA_INDEX_ARCHITECTURE.md` defines the probe fields (duration, streams, rotation,
  frame rate, resolution, pixel format and audio) and the local-only input boundary.
- `TEST_STRATEGY.md` defines the malformed-media and fixture obligations.

Those documents intentionally do not freeze a finite extension allowlist. The capability record
therefore uses a format-neutral local-media scope and explicitly preserves all upstream
container, demuxer and parser capabilities at the pinned release. No “common formats” guess or
silent size-driven narrowing is allowed. A future finite format decision must create a new
versioned capability set and re-evaluate this profile.

The authoritative record is
`compliance/runtime-dependency-intake/ffprobe-v2/REQUIRED_MEDIA_CAPABILITY_SET_V1.json`.

## Release and source authority

The selected release is FFmpeg `9.0.1`, tag `n9.0.1`, commit
`bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa`. It was the latest stable release in the reviewed
upstream release table. The source authority is the upstream archive, not a URL alone:

```text
ffmpeg-9.0.1.tar.xz
https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz
SHA-256: cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635
```

The release-level security intake is recorded separately in
`FFMPEG_RELEASE_SECURITY_INTAKE_V1.json`. It considered the upstream security table and
published fixed boundaries for the relevant prior 8.0 advisories. The result is acceptable for
this source/build-intent decision; exact Linux and Windows binaries still require their own
vulnerability, native, license and final-distribution reviews.

## Semantic Build Profile v1

`FFPROBE_BUILD_PROFILE_V1.json` is one shared semantic profile. Linux and Windows must each
bind their own recipe, environment descriptor and build context later; platform output bytes and
linker closure are not assumed identical.

The profile requires the `ffprobe` program and disables `ffmpeg` and `ffplay` executables. It
declares only the `file` protocol, disables network protocols, forbids undeclared protocols and
external libraries, and makes configure autodetection fail closed. The profile requires shared
FFmpeg support libraries, with platform prerequisites governed by an explicit allowlist.

The license-oriented intent is `--disable-gpl` and `--disable-nonfree`, with GPL, nonfree,
`libx264` and `libx265` forbidden. LGPL obligations are not concluded here; they are reviewed
from the exact source/configuration/runtime closure and distributed members.

The profile's capability coverage is PASS because the provided capability policy is exactly the
required format-neutral set. Its artifact status remains `NOT_YET_PRODUCED` and
`NOT_PERFORMED` for both platforms.

## Recheck triggers and downstream handoff

Any release, source hash, capability, program, protocol, network, external-library, linkage,
GPL/nonfree-policy or relevant advisory change invalidates the pin. Once this PR is merged and
the merged bytes are verified, Code C may sync main and begin the separate Linux/Windows exact
source builds. Worker rebuild, Native rebind, License/SBOM/NOTICE regeneration, vulnerability
rebind, SigLIP/index evaluation and Code C version acceptance remain out of scope.

Authority records and the verifier are exercised in PR/clean-checkout CI through
`compliance:ffprobe:profile:contract`.
