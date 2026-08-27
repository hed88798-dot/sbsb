# Code C local benchmark snapshot

Date: 2026-08-27  
Commit: Code C working tree before final delivery commit  
Host: Apple M3, 8 physical cores, 8 GB RAM, macOS 15.5 arm64  
Runtime: Python 3.12.13, NumPy 2.3.5

## 50k exact search

Command:

```text
python tests/performance/benchmark_50k_exact_search.py --rows 50000 --dimension 768 --queries 30
```

Result:

```text
P50: 16.32 ms
P95: 23.30 ms
Max: 24.27 ms
Threshold: P95 < 200 ms
Result: PASS
```

The matrix is continuous little-endian float16 and read through NumPy mmap; every query is normalized and
uses float32 chunked dot products. The benchmark fixture is deterministic synthetic data and the measured
process generated its matrix in bounded chunks. It verifies the performance shape, not veterinary retrieval
quality.

## Scope warning

This is a macOS algorithm baseline, not either formal Windows CPU profile. The workspace does not contain the
authorized ≥500-video Golden Set, official exported ONNX artifacts, a Windows 4-core/8 GB machine, or a
Windows 4-core/16 GB machine. First-index wall time, realtime factor, thermal behavior, UI responsiveness,
FP32/ONNX Top-5 and optional INT8 recall remain external milestone measurements and are marked `BLOCKED` in
the completion report rather than inferred from this search-only result.
