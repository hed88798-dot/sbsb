# FFmpeg Required Capability Profile V1

- Status: `FROZEN_FOR_CODE_F_INTAKE`
- Owner: Code G — Render Execution
- Artifact governance owner: Code F
- Machine-readable authority: `docs/render/ffmpeg-required-capability-profile.v1.json`

## Purpose and authority boundary

This profile freezes the capabilities Code G requires from a future approved FFmpeg/ffprobe runtime.
It is not a build recipe, binary approval, license approval, vulnerability review, distribution
approval, or authorization to execute FFmpeg in R1A. Code F owns those artifact decisions and must
bind any candidate to the exact profile ID, version, hash, and checkpoint commit.

The profile is deliberately asymmetric:

- Local input decode coverage may not silently narrow the Code C executable-media universe. Code C
  currently accepts local `avi`, `m4v`, `mkv`, `mov`, `mp4`, `mpeg`, `mpg`, and `webm` files without
  persisting a frozen codec allowlist.
- Output and transformation capabilities are narrow: deterministic video trim/timestamp reset,
  rotation, scale/pad/explicit crop, SAR/fps/pixel-format normalization, ordered concat, H.264
  encode, exact narration decode/resample, AAC encode, and MP4 mux.
- R1 source video audio is dropped. Narration is the only audio authority. Subtitle, background
  music, audio mixing, fallback generation, and narration time-stretch are outside this profile.

## Required program and operation surface

The future companion must provide separately approved `ffmpeg` and `ffprobe` programs. Code G will
spawn only an exact verified absolute executable path, with an argument array, `shell: false`, no
PATH lookup, bounded logs, machine-readable progress, Main-owned timeouts, and graceful-then-forced
termination semantics.

Required filter capability names are intentionally explicit:

```text
video:
concat crop format fps pad scale setsar setpts trim

audio:
aformat aresample asetpts
```

`crop` may be used only when an exact RenderPolicy requests the frozen crop behavior. Audio trim,
padding, and time-stretch are not permitted to repair duration mismatch; mismatch fails closed.

The H.264 and AAC families belong to the portable RenderPolicy. The exact encoder implementations,
their ordered availability, the FFmpeg build, platform, shared members, and member hashes belong to
the machine execution snapshot and Code F approval. No encoder may silently fall back to another
implementation.

## Protocol and security surface

The declared protocol set is:

```text
file
pipe
```

`file` is restricted by Code G command construction to verified staging inputs and controlled
outputs. `pipe` is required only for machine-readable progress and controlled standard streams.
Build-time availability does not authorize arbitrary caller-selected URLs or pipe media inputs.

The runtime/build candidate must disable network behavior and reject undeclared protocols. HTTP,
HTTPS, FTP, RTMP, RTSP, device capture, server/listener behavior, GPL components, nonfree components,
libx264, libx265, ffplay, arbitrary shell invocation, Renderer-supplied paths/arguments, subtitle
processing, source-audio mixing, and background music are forbidden.

If Code F cannot disable a listed surface in the selected FFmpeg architecture, it must record the
exact residual capability, why removal is infeasible, how Code G's fixed operation builder makes it
unreachable, and the security/license disposition. Silence is not compatibility.

## Input coverage and narration

The profile carries a finite narration baseline suitable for already-generated local artifacts:

```text
containers: m4a, mp3, mp4, wav
codecs: aac, mp3, pcm_f32le, pcm_s16le, pcm_s24le, pcm_s32le
```

This does not choose a TTS provider, model, voice, speed, or regeneration policy. An upstream owner
must produce the artifact; Code G consumes only its exact ID, metadata, location, and SHA-256.

For source video, Code F must not infer that only the historical GQ006 codec is required. A candidate
must either preserve the pinned-release local demuxer/parser/decoder coverage needed by the Code C
format-neutral authority or return a documented compatibility gap for Brain1 resolution. This is
not a request for every FFmpeg encoder, muxer, protocol, device, or filter.

## Verification requirements

The paired approved ffprobe capability must expose JSON facts sufficient to verify:

- video codec, dimensions, frame rate, pixel format, and duration;
- audio codec, sample rate, channels, and duration;
- MP4 format, total duration, and size;
- exact final output SHA-256 calculated by Main.

R1A does not execute these capabilities. R1B remains unauthorized until Brain1 accepts both this
foundation and Code F's exact runtime intake.

## Canonical hash and drift rule

`profile_hash` is lowercase SHA-256 over repository `canonicalJson(...)` serialization of the JSON
object after removing only `profile_hash`. Array order is semantic. The JSON parser/contract must
reject unknown keys and verify this self-hash.

After the checkpoint is published, Code G may not silently edit profile version 1. Any required
change needs a version bump, new hash, new exact commit, and explicit Brain1/Code F notification.
Every candidate bound to the previous profile becomes `STALE`.
