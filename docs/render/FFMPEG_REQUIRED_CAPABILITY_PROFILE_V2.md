# FFmpeg Required Capability Profile V2

- Status: `FROZEN_FOR_CODE_F_INTAKE`
- Owner: Code G — Render Execution
- Artifact approval owner: Code F
- Machine-readable authority: `docs/render/ffmpeg-required-capability-profile.v2.json`
- Profile ID: `code-g-r1-ffmpeg-required-capabilities`
- Profile version: `2`

## Purpose and authority boundary

Profile v2 is the forward capability contract required by rotation-capable R1B. It does not build,
select, approve, download, distribute, or execute an FFmpeg runtime. Code F must produce and approve
an exact Runtime v2 artifact bound to the exact Profile v2 ID, version, hash, and checkpoint commit.
`real_execution_authorized_by_this_profile` remains `false`.

Profile v1 remains the historical frozen capability contract. Runtime v1 remains historically
approved against Profile v1; that approval is not revoked or rewritten. Runtime v1 is incompatible
only with the current rotation-capable R1B contract because its approved filter surface does not
include the newly explicit rotation filters. Runtime v2 is not yet produced and remains Code F work.

## Forward delta from Profile v1

Every Profile v1 required capability remains required. Profile v2 adds exactly this video-filter
surface:

```text
transpose
hflip
vflip
rotate
```

Existing video filters remain required:

```text
concat crop format fps pad scale setsar setpts trim
```

`apply_declared_rotation` remains a required operation. No new protocol, encoder, audio mode,
subtitle mode, fallback behavior, or semantic editing authority is introduced.

## Rotation normalization: exactly once

The accepted input's declared rotation or display-matrix metadata is the orientation authority.
The runtime must consume that authority and normalize the pixels to the intended visual orientation
before final RenderPolicy canvas normalization. The order is:

```text
accepted declared/display-matrix rotation
→ autorotate and required rotation filters
→ visually normalized pixels
→ RenderPolicy scale/pad or scale/crop
→ SAR, CFR, and pixel-format normalization
→ normalized output
```

Rotation is applied exactly once. The output MP4 must carry no effective rotation metadata, or only
identity rotation metadata. An effective non-identity display matrix is forbidden. A conforming
player must display the intended orientation without applying another 90°, 180°, or 270° transform.

Rotation does not authorize material substitution, source interval changes, Timeline changes,
semantic duration changes, or extra/missing frames. The exact frozen frame count remains binding.

## Static Runtime v2 gate

Code F must inspect the built Runtime v2 candidate itself and prove that `transpose`, `hflip`,
`vflip`, and `rotate` are present and usable. Documentation or build configuration alone is not
sufficient. Code F must issue a new runtime identity, member hashes, manifest, and approval receipt;
no Runtime v1 evidence may be mutated.

## Dynamic rotation product gate

Final capability evidence requires real media fixtures carrying accepted 90°, 180°, and 270°
rotation/display-matrix metadata. Each fixture must pass through the actual Code G R1B product
service path. A standalone Code F runtime smoke may contribute evidence but cannot replace this
product-path gate.

Each fixture must prove both sides of normalization:

- Pixel normalization: correct visible orientation, target width/height, SAR, FPS, and exact frozen
  expected frame count.
- Metadata normalization: rotation applied exactly once, final effective rotation absent or
  identity, no non-identity display matrix, and no further player orientation transform required.

The output contract remains H.264 video plus AAC narration-only audio, with source-video audio
dropped and subtitle streams absent. Correct pixels with residual non-identity metadata fail; removed
metadata without correct pixel normalization also fails.

## Frozen non-rotation surface

The declared protocols remain exactly `file` and `pipe`. Network input/output, HTTP, HTTPS, FTP,
RTMP, RTSP, undeclared protocols, device capture, and server/listener behavior remain forbidden.
GPL and nonfree components remain forbidden. `libx264`, `libx265`, and `ffplay` remain forbidden.

The H.264 encoder remains `CODE_F_APPROVED_PLATFORM_RUNTIME_IDENTITY`; this profile does not select
a new encoder. Source-video audio remains `DROP`, narration remains the only output audio authority,
subtitle remains `OFF`, and fallback generation and Digital Human remain outside Render.

## Canonical hash and change rule

`profile_hash` is lowercase SHA-256 over repository `canonicalJson(...)` serialization of the JSON
object after removing only the top-level `profile_hash`. Object keys are recursively sorted; array
order is semantic.

After publication, changing Profile v2 requires another version bump, a new hash, a new exact
checkpoint commit, and explicit Code F notification. Any incompatibility label for Runtime v1 is
scoped only to current rotation-capable R1B compatibility and never invalidates historical approval
or provenance.
