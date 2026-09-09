Golden Benchmark V3

Root cause targeted by V3:
Windows PowerShell 5.1 native text piping can collapse Chinese characters during
scripted calls to a native executable. V3 bypasses the PowerShell text pipeline
and writes the NDJSON request to media-worker.exe as explicit UTF-8 bytes.

Use:
1. Put these three files in the same folder:
   - run-golden-benchmark-v3.ps1
   - benchmark-queries-v1.csv
   - ground-truth-v1.csv

2. Run:
   Set-ExecutionPolicy -Scope Process Bypass -Force
   .\run-golden-benchmark-v3.ps1

V3 runs all 120 searches. At GQ006_SHORT_ZH it automatically checks the manually
validated "猪喝水" result. If the first four assets are not 084, 085, 088, 086,
the script stops immediately. If it passes, it continues the full benchmark.

Output:
golden-results-v3
