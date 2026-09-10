# Code E Open-Source Timeline Reference Review

Review date: 2026-09-10

Review mode: architecture-compatible timeline/editing patterns and commercial-use precheck only

Default outcome: `BORROW_PATTERN: YES`, `COPY_CODE: NO`, `PRODUCTION_DEPENDENCY: NO`

This review is not legal advice. Code E E0.5 copies no reviewed source and adds no reviewed
runtime, so none of these projects creates a distribution obligation for E1.

## Reviewed references

| Repository                                 | Exact reviewed commit                      | SPDX / commercial use                                                                                                                         | Relevant pattern                                                                                                      | Borrow                                                                           | Reject / Code 0 compatibility                                                                                                                                    | Obligations and risk if reused                                                                                                                              | Production dependency |
| ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `AcademySoftwareFoundation/OpenTimelineIO` | `31e3101e750be2aa992274ac02c0679077872e57` | Apache-2.0 / ALLOWED                                                                                                                          | Timeline as serializable editorial truth; ordered clips reference external media and separate available/source ranges | explicit source references, ordered composition and Timeline/Renderer separation | Reject OTIO C++/Python runtime, rational-frame time truth, adapters, plugins and NLE interchange scope; V0.1 uses integer milliseconds and a bounded TS contract | Apache-2.0 copyright/license retention and conditional NOTICE handling if code is copied; repository has no root NOTICE at this commit                      | NO                    |
| `FFmpeg/FFmpeg`                            | `cc7a69a36a67acb661ceb2339a41488fb7409b57` | LGPL-2.1-or-later baseline; optional GPL/nonfree configuration / CONDITIONALLY ALLOWED                                                        | explicit trim/concat/filtergraph execution from a fully specified plan                                                | Renderer must execute declared ranges and ordering without semantic decisions    | Reject FFmpeg execution in E1 and reject implicit defaults as Timeline truth; final distribution remains subject to the existing pinned LGPL-only build gate     | Build flags and linked libraries can change the effective license; LGPL relinking/source/notice duties and patent/codec review remain separate release work | NO                    |
| `Zulko/moviepy`                            | `211e4b15f6ce4f34a6a9efbfff40590e43a68f77` | MIT / ALLOWED                                                                                                                                 | clip source range, timeline start and duration are explicit composition inputs                                        | clear separation of clip mutation/composition operations                         | Reject Python runtime, MoviePy object graph, implicit FFmpeg discovery/defaults and additional media dependency closure                                          | MIT notice if copied; transitive Python, imageio-ffmpeg and FFmpeg artifact licensing avoided because no dependency is added                                | NO                    |
| `mltframework/mlt`                         | `0f8244a125872544fb34b88125ee18a88b4d0b85` | LGPL-2.1-or-later core / CONDITIONALLY ALLOWED                                                                                                | producer/playlist/tractor separates media sources, ordered entries and composition                                    | explicit blank/gap and source in/out modeling                                    | Reject MLT runtime, plugin ecosystem, Qt-facing integration and its broad media dependency closure                                                               | LGPL dynamic-link/relink/source duties; individual modules and linked libraries require exact component review                                              | NO                    |
| `KDE/kdenlive`                             | `95194a227af3c390099d882c48a481dd966905c2` | GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL for representative core files; mixed REUSE assets / COMMERCIAL USE PERMITTED WITH STRONG COPYLEFT | mature project-file concepts for clip identity, timeline ordering, gaps and recovery                                  | append-only/versioned project truth and explicit missing media state             | Reject source copying, Kdenlive/Qt/KDE/MLT runtime, editor UI architecture and project-format scope                                                              | GPL source/conveyance obligations and mixed per-file REUSE inventory make direct incorporation incompatible with the intended proprietary Electron V1       | NO                    |

## Architectural result

The references support these bounded patterns:

- a Timeline is serialized execution truth, not a media container or semantic selector;
- a physical clip has explicit source identity/range and deterministic timeline order;
- gaps and missing/fallback states are explicit rather than inferred by a renderer;
- the executor may validate ranges but must not change semantic decisions;
- complex NLE tracks, plugins, transitions and runtime frameworks are unnecessary for Code E V0.1.

They do not justify changing Desktop Main authority, SQLite truth, Code C retrieval, Code D
selection, integer-millisecond business time, or the Python Sidecar boundary.

```text
CODE0_ARCHITECTURE_COMPATIBILITY: PASS
COMMERCIAL_LICENSE_PRECHECK: PASS
CODE_COPIED: NO
NEW_PRODUCTION_DEPENDENCIES: NONE
TRANSITIVE_DEPENDENCIES_ADDED: NONE
STRONG_COPYLEFT_RUNTIME_ADDED: NO
```

## Pinned evidence links

- OpenTimelineIO: [timeline structure](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/tree/31e3101e750be2aa992274ac02c0679077872e57), [Apache-2.0 license](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/31e3101e750be2aa992274ac02c0679077872e57/LICENSE.txt)
- FFmpeg: [filter documentation source](https://github.com/FFmpeg/FFmpeg/blob/cc7a69a36a67acb661ceb2339a41488fb7409b57/doc/filters.texi), [license and configuration effects](https://github.com/FFmpeg/FFmpeg/blob/cc7a69a36a67acb661ceb2339a41488fb7409b57/LICENSE.md)
- MoviePy: [clip implementation](https://github.com/Zulko/moviepy/tree/211e4b15f6ce4f34a6a9efbfff40590e43a68f77/moviepy), [MIT license](https://github.com/Zulko/moviepy/blob/211e4b15f6ce4f34a6a9efbfff40590e43a68f77/LICENCE.txt)
- MLT: [framework API](https://github.com/mltframework/mlt/tree/0f8244a125872544fb34b88125ee18a88b4d0b85/src/framework), [LGPL-2.1 license](https://github.com/mltframework/mlt/blob/0f8244a125872544fb34b88125ee18a88b4d0b85/COPYING)
- Kdenlive: [project sources](https://github.com/KDE/kdenlive/tree/95194a227af3c390099d882c48a481dd966905c2/src), [GPL-3.0 license](https://github.com/KDE/kdenlive/blob/95194a227af3c390099d882c48a481dd966905c2/COPYING), [REUSE inventory](https://github.com/KDE/kdenlive/blob/95194a227af3c390099d882c48a481dd966905c2/REUSE.toml)
