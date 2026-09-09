# Code C — V1 Real Corpus / Golden Retrieval Closeout

This document records the Project Owner's authoritative Windows V3 evidence for
the Code C retrieval boundary. It is a fixed regression baseline, not a claim
that the 500-asset legacy corpus was executed.

## Frozen execution

The tested Worker is `e56b32c1d547df0391e40a656230cdb2924b8ba6fb94f1b062632c5b1ca05d99`
running on Python 3.13.15. The target was Windows Server 2019 Datacenter x64
(AMD EPYC, 2 physical cores / 4 logical processors, 15.7 GB RAM, no GPU) with
VC Runtime 14.51.36247.0.

The corpus contained 100 authorized real assets, all 100 indexed successfully,
and 103 shots. The manually reviewed set contained 40 canonical Golden Queries,
3 query variants, and 120 searches. All 120 searches completed with zero errors;
119 strict positives and 2 explicit negatives were recorded. Evaluation uses
`Unique Asset Top5` as a reporting view: the index and retrieval engine remain
shot-based, and repeated shots from one asset occupy one evaluation position.

The V3 cache was `C:\ai-video-smoke\batch-search-cache-v3` with signature
`fb20dae0be37cc347f975cdec9d630600f06696575f2f2677d412d1520731f6d`.

## Transport validity

V3 sends request JSON to the real Worker with
`System.Diagnostics.Process`, writing explicit UTF-8 bytes to stdin. This is the
only authoritative Golden Benchmark transport. Earlier PowerShell 5.1 native
text-pipe results (V1/V2) are rejected because the native text boundary changed
scripted Unicode requests even though the CSV, code points, UTF-8 bytes, lookup,
and manual exact-search checks were correct. `GQ006 / 猪喝水` is retained as a
fixed literal-Chinese regression; the expected Top5 asset order is captured in
`tests/fixtures/real-retrieval/gq006-pig-drinking-water.json`.

The repository regression path must use an explicit byte transport (or an
equivalent UTF-8-safe process API), never a PowerShell native text pipe for
non-ASCII benchmark requests. The reusable strategy harness is
`tests/performance/real_retrieval_v3_harness.py`; it consumes captured result
JSON and does not run a Worker, mutate embeddings, or alter the index.

## V3 metrics

| Query dimension | Top1 Accuracy | Hit@5 | Precision@5 | Recall@5 | Coverage@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `SHORT_ZH` | 42.5% | 67.5% | 28.5% | 50.1% | 51.3% |
| `VISUAL_ZH` | 52.5% | 77.5% | 37.0% | 59.2% | 61.5% |
| `VISUAL_EN` | 67.5% | 92.5% | 42.0% | 74.8% | 77.0% |

For production-core queries, `VISUAL_ZH Hit@5` was approximately 95.5%, while
`VISUAL_EN Top1` was approximately 77.3% and `VISUAL_EN Hit@5` approximately
95.5%.

`Coverage@5` is defined as
`relevant_in_top5 / min(5, strict_positive_count)`. A uniform `Recall@5 >= 0.9`
hard gate is therefore not applied: a query with seven strict positives cannot
recall more than five of them in a Top5 result.

## Retrieval boundary and follow-up diagnostics

The evidence supports keeping the SigLIP2 baseline. The principal improvement
lever is query formulation:

```text
business/user Chinese intent
  -> query normalization
  -> standard visual Chinese or English description
  -> SigLIP Top-N retrieval
```

The harness includes a deterministic, versioned `visual-zh-v1` expansion map and
optional route/species diagnostics. Route filtering is applied only when route
metadata is explicitly present in the captured result; the harness never infers
route from filenames. Species diagnostics report `SHEEP_TO_CATTLE` and
`CATTLE_TO_SHEEP` only when explicit candidate species metadata exists. These are
benchmark/reporting experiments, not Media Index Contract behavior.

No route filter, query expansion, reranker, or material-selection policy is
implemented in Code C by this closeout. Material rotation, cooldown, diversity,
and final selection remain Code D responsibilities. The three V3 dimensions and
the fixed 18-query sanity record are stored as machine-readable fixtures.

## Scope and governance

The Media Index Contract, Sidecar Protocol, embedding model, and embeddings are
unchanged. No FAISS/Qdrant index was introduced and no model was retrained. The
Project Owner's V1 evidence uses 100 diverse authorized assets; the legacy
500-asset gate was **not run** and requires governance/document reconciliation
before it can be treated as a release requirement.

Machine-readable records:

- `tests/fixtures/real-retrieval/code-c-v3-golden-baseline.json`
- `tests/fixtures/real-retrieval/gq006-pig-drinking-water.json`
- `tests/fixtures/real-retrieval/small-real-18-query-baseline.json`
