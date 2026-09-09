param(
    [string]$Worker = "C:\ai-video-smoke\candidate-latest\media-worker.exe",
    [string]$CacheRoot = "C:\ai-video-smoke\batch-search-cache-v3",
    [string]$ModelRoot = "C:\ai-video-smoke\model",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
    $ScriptRoot = (Get-Location).Path
}

$QueriesCsv = Join-Path $ScriptRoot "benchmark-queries-v1.csv"
$GroundTruthCsv = Join-Path $ScriptRoot "ground-truth-v1.csv"

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $ScriptRoot "golden-results-v3"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $Worker)) { throw "Worker not found: $Worker" }
if (-not (Test-Path $CacheRoot)) { throw "Cache root not found: $CacheRoot" }
if (-not (Test-Path $ModelRoot)) { throw "Model root not found: $ModelRoot" }
if (-not (Test-Path $QueriesCsv)) { throw "Queries CSV not found: $QueriesCsv" }
if (-not (Test-Path $GroundTruthCsv)) { throw "Ground Truth CSV not found: $GroundTruthCsv" }

if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force $OutputDir | Out-Null

$activePath = Join-Path $CacheRoot "active.json"
if (-not (Test-Path $activePath)) { throw "active.json not found: $activePath" }

$active = Get-Content $activePath -Raw -Encoding UTF8 | ConvertFrom-Json
$signature = [string]$active.signature_hash
if ([string]::IsNullOrWhiteSpace($signature)) {
    throw "signature_hash missing from active.json"
}

$workerHash = (Get-FileHash $Worker -Algorithm SHA256).Hash.ToLower()
$queriesHash = (Get-FileHash $QueriesCsv -Algorithm SHA256).Hash.ToLower()
$gtHash = (Get-FileHash $GroundTruthCsv -Algorithm SHA256).Hash.ToLower()
$activeHash = (Get-FileHash $activePath -Algorithm SHA256).Hash.ToLower()

$queries = @(Import-Csv $QueriesCsv)
$gtRows = @(Import-Csv $GroundTruthCsv)

if ($queries.Count -ne 120) {
    throw "Expected exactly 120 benchmark queries, found $($queries.Count)"
}

$gtByQuery = @{}
foreach ($row in $gtRows) {
    if ([int]$row.relevance -ne 2) { continue }

    $qid = [string]$row.canonical_query_id

    if (-not $gtByQuery.ContainsKey($qid)) {
        $gtByQuery[$qid] = New-Object System.Collections.Generic.HashSet[string]
    }

    [void]$gtByQuery[$qid].Add([string]$row.asset_id)
}

$canonicalIds = @($queries | Select-Object -ExpandProperty canonical_query_id -Unique)
if ($canonicalIds.Count -ne 40) {
    throw "Expected 40 canonical query ids, found $($canonicalIds.Count)"
}

foreach ($qid in $canonicalIds) {
    if (-not $gtByQuery.ContainsKey([string]$qid)) {
        throw "No relevance=2 Ground Truth for canonical query: $qid"
    }
}

# IMPORTANT:
# Windows PowerShell 5.1 can corrupt non-ASCII text when piping a .NET string
# directly into a native executable. V3 bypasses that entire conversion path.
# It writes the request JSON as explicit UTF-8 BYTES to the Worker's stdin.
function Invoke-WorkerUtf8Bytes {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Json
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Worker
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    if ($psi.PSObject.Properties["StandardOutputEncoding"]) {
        $psi.StandardOutputEncoding = $utf8NoBom
    }
    if ($psi.PSObject.Properties["StandardErrorEncoding"]) {
        $psi.StandardErrorEncoding = $utf8NoBom
    }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    [void]$proc.Start()

    $requestBytes = [System.Text.Encoding]::UTF8.GetBytes($Json + "`n")
    $stdinBase = $proc.StandardInput.BaseStream
    $stdinBase.Write($requestBytes, 0, $requestBytes.Length)
    $stdinBase.Flush()
    $stdinBase.Close()

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()

    $proc.WaitForExit()
    $exitCode = $proc.ExitCode
    $proc.Dispose()

    if ($exitCode -ne 0 -and [string]::IsNullOrWhiteSpace($stdout)) {
        throw "Worker exited with code $exitCode. stderr=$stderr"
    }

    return @{
        stdout = $stdout
        stderr = $stderr
        exit_code = $exitCode
        request_bytes = $requestBytes
    }
}

$manifest = [ordered]@{
    schema_version = "1.0"
    benchmark_version = "v3"
    transport = "direct_utf8_bytes_via_System.Diagnostics.Process"
    started_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    worker_path = $Worker
    worker_sha256 = $workerHash
    cache_root = $CacheRoot
    cache_signature_hash = $signature
    cache_active_sha256 = $activeHash
    model_root = $ModelRoot
    queries_csv = $QueriesCsv
    queries_sha256 = $queriesHash
    ground_truth_csv = $GroundTruthCsv
    ground_truth_sha256 = $gtHash
    query_count = $queries.Count
    canonical_query_count = $canonicalIds.Count
    metric_unit = "unique_asset"
    raw_top_k = 20
    unique_asset_k = 5
    strict_positive = "relevance=2"
}

$manifestPath = Join-Path $OutputDir "run-manifest-v3.json"
[System.IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 10),
    $utf8NoBom
)

$summary = @()
$ranked = @()
$queryAudit = @()

$i = 0
$gq006SelfCheck = "NOT_RUN"

foreach ($q in $queries) {
    $i++

    $benchmarkId = [string]$q.benchmark_query_id
    $canonicalId = [string]$q.canonical_query_id
    $queryText = [string]$q.query_text
    $topKRaw = [int]$q.top_k_raw
    $uniqueK = [int]$q.unique_asset_k

    $codepoints = @(
        $queryText.ToCharArray() |
        ForEach-Object { "{0:X4}" -f [int][char]$_ }
    ) -join " "

    $queryUtf8Hex = @(
        [System.Text.Encoding]::UTF8.GetBytes($queryText) |
        ForEach-Object { "{0:X2}" -f $_ }
    ) -join " "

    Write-Host ""
    Write-Host "===== [$i/$($queries.Count)] $benchmarkId ====="
    Write-Host $queryText

    $request = @{
        type = "request"
        protocol_version = "1.0"
        request_id = "golden-v3-" + [Guid]::NewGuid().ToString("N")
        method = "media.search.exact.v1"
        payload = @{
            cache_root = $CacheRoot
            signature_hash = $signature
            model_root = $ModelRoot
            dimension = 768
            query_text = $queryText
            top_k = $topKRaw
        }
    }

    $json = $request | ConvertTo-Json -Depth 10 -Compress

    $invocation = Invoke-WorkerUtf8Bytes -Json $json
    $stdout = [string]$invocation.stdout
    $requestBytes = [byte[]]$invocation.request_bytes

    $requestSha = New-Object System.Security.Cryptography.SHA256Managed
    try {
        $requestHash = (
            $requestSha.ComputeHash($requestBytes) |
            ForEach-Object { $_.ToString("x2") }
        ) -join ""
    }
    finally {
        $requestSha.Dispose()
    }

    $queryAudit += [PSCustomObject]@{
        benchmark_query_id = $benchmarkId
        canonical_query_id = $canonicalId
        query_variant = [string]$q.query_variant
        query_text = $queryText
        codepoints = $codepoints
        query_utf8_hex = $queryUtf8Hex
        request_utf8_sha256 = $requestHash
        worker_exit_code = [int]$invocation.exit_code
    }

    $events = @()
    foreach ($line in ($stdout -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $events += $line | ConvertFrom-Json
        }
        catch {}
    }

    $errorEvent = $events |
        Where-Object { $_.type -eq "error" } |
        Select-Object -Last 1

    if ($errorEvent) {
        $summary += [PSCustomObject]@{
            benchmark_query_id = $benchmarkId
            canonical_query_id = $canonicalId
            group = [string]$q.group
            role = [string]$q.role
            query_variant = [string]$q.query_variant
            query_text = $queryText
            relevant_count = $gtByQuery[$canonicalId].Count
            returned_unique = 0
            relevant_in_top5 = 0
            top1_hit = 0
            hit_at_5 = 0
            precision_at_5 = 0
            recall_at_5 = 0
            coverage_at_5 = 0
            error_code = [string]$errorEvent.error.code
            error_message = [string]$errorEvent.error.message
        }
        continue
    }

    $result = $events |
        Where-Object { $_.type -eq "result" } |
        Select-Object -Last 1

    if (-not $result) {
        throw "No result event for $benchmarkId"
    }

    $seen = New-Object System.Collections.Generic.HashSet[string]
    $unique = @()

    foreach ($cand in $result.payload.candidates) {
        $assetId = [string]$cand.asset_id
        if ($seen.Add($assetId)) {
            $unique += $cand
            if ($unique.Count -ge $uniqueK) { break }
        }
    }

    $relevantSet = $gtByQuery[$canonicalId]
    $relevantInTop5 = 0
    $rank = 0

    foreach ($cand in $unique) {
        $rank++
        $assetId = [string]$cand.asset_id
        $isRelevant = $relevantSet.Contains($assetId)

        if ($isRelevant) {
            $relevantInTop5++
        }

        $ranked += [PSCustomObject]@{
            benchmark_query_id = $benchmarkId
            canonical_query_id = $canonicalId
            query_variant = [string]$q.query_variant
            query_text = $queryText
            rank = $rank
            asset_id = $assetId
            shot_id = [string]$cand.shot_id
            semantic_score = [double]$cand.semantic_score
            start_ms = [int]$cand.start_ms
            end_ms = [int]$cand.end_ms
            relevant = $(if ($isRelevant) { 1 } else { 0 })
        }
    }

    $top1Hit = 0
    if ($unique.Count -gt 0 -and $relevantSet.Contains([string]$unique[0].asset_id)) {
        $top1Hit = 1
    }

    $hitAt5 = $(if ($relevantInTop5 -gt 0) { 1 } else { 0 })

    $precisionAt5 = 0.0
    if ($unique.Count -gt 0) {
        $precisionAt5 = $relevantInTop5 / [double]$unique.Count
    }

    $recallAt5 = $relevantInTop5 / [double]$relevantSet.Count

    $coverageDenominator = [Math]::Min($uniqueK, $relevantSet.Count)
    $coverageAt5 = 0.0
    if ($coverageDenominator -gt 0) {
        $coverageAt5 = $relevantInTop5 / [double]$coverageDenominator
    }

    $summary += [PSCustomObject]@{
        benchmark_query_id = $benchmarkId
        canonical_query_id = $canonicalId
        group = [string]$q.group
        role = [string]$q.role
        query_variant = [string]$q.query_variant
        query_text = $queryText
        relevant_count = $relevantSet.Count
        returned_unique = $unique.Count
        relevant_in_top5 = $relevantInTop5
        top1_hit = $top1Hit
        hit_at_5 = $hitAt5
        precision_at_5 = [math]::Round($precisionAt5, 4)
        recall_at_5 = [math]::Round($recallAt5, 4)
        coverage_at_5 = [math]::Round($coverageAt5, 4)
        error_code = ""
        error_message = ""
    }

    # Fail fast at the known manual reference query, then continue automatically if it passes.
    if ($benchmarkId -eq "GQ006_SHORT_ZH") {
        $expectedFirstFour = @(
            "v2_asset_084",
            "v2_asset_085",
            "v2_asset_088",
            "v2_asset_086"
        )
        $actualFirstFour = @(
            $unique |
            Select-Object -First 4 |
            ForEach-Object { [string]$_.asset_id }
        )

        $same = ($actualFirstFour.Count -eq 4)
        if ($same) {
            for ($j = 0; $j -lt 4; $j++) {
                if ($actualFirstFour[$j] -ne $expectedFirstFour[$j]) {
                    $same = $false
                }
            }
        }

        if (-not $same) {
            $gq006SelfCheck = "FAIL"
            throw (
                "GQ006 UTF-8 transport self-check FAILED. Expected first four: " +
                ($expectedFirstFour -join ", ") +
                " ; Actual: " +
                ($actualFirstFour -join ", ")
            )
        }

        $gq006SelfCheck = "PASS"
        Write-Host "GQ006 UTF-8 transport self-check: PASS"
    }
}

$summaryPath = Join-Path $OutputDir "benchmark-summary-v3.csv"
$rankedPath = Join-Path $OutputDir "benchmark-ranked-top5-v3.csv"
$auditPath = Join-Path $OutputDir "query-encoding-audit-v3.csv"

$summary | Export-Csv $summaryPath -NoTypeInformation -Encoding UTF8
$ranked | Export-Csv $rankedPath -NoTypeInformation -Encoding UTF8
$queryAudit | Export-Csv $auditPath -NoTypeInformation -Encoding UTF8

$variantSummary = @()

foreach ($variantName in @("SHORT_ZH","VISUAL_ZH","VISUAL_EN")) {
    $rows = @(
        $summary |
        Where-Object {
            $_.query_variant -eq $variantName -and
            [string]::IsNullOrWhiteSpace([string]$_.error_code)
        }
    )

    $variantSummary += [PSCustomObject]@{
        query_variant = $variantName
        searches = $rows.Count
        top1_accuracy = [math]::Round(
            ($rows | Measure-Object -Property top1_hit -Average).Average, 4
        )
        hit_at_5 = [math]::Round(
            ($rows | Measure-Object -Property hit_at_5 -Average).Average, 4
        )
        precision_at_5 = [math]::Round(
            ($rows | Measure-Object -Property precision_at_5 -Average).Average, 4
        )
        recall_at_5 = [math]::Round(
            ($rows | Measure-Object -Property recall_at_5 -Average).Average, 4
        )
        coverage_at_5 = [math]::Round(
            ($rows | Measure-Object -Property coverage_at_5 -Average).Average, 4
        )
    }
}

$variantSummaryPath = Join-Path $OutputDir "variant-summary-v3.csv"
$variantSummary | Export-Csv $variantSummaryPath -NoTypeInformation -Encoding UTF8

$manifest.completed_at_utc = (Get-Date).ToUniversalTime().ToString("o")
$manifest.searches_completed = $summary.Count
$manifest.search_errors = @(
    $summary | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.error_code)
    }
).Count
$manifest.gq006_utf8_transport_self_check = $gq006SelfCheck

[System.IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 10),
    $utf8NoBom
)

Write-Host ""
Write-Host "=============================================="
Write-Host "GOLDEN BENCHMARK V3 COMPLETE"
Write-Host "=============================================="
Write-Host "Searches:" $summary.Count
Write-Host "Errors  :" $manifest.search_errors
Write-Host "Transport: direct UTF-8 bytes"
Write-Host "Worker SHA256:" $workerHash
Write-Host "Cache signature:" $signature
Write-Host "GQ006 UTF-8 self-check:" $gq006SelfCheck
Write-Host ""

$variantSummary | Format-Table `
    query_variant,searches,top1_accuracy,hit_at_5,precision_at_5,recall_at_5,coverage_at_5 `
    -AutoSize

Write-Host ""
Write-Host "OUTPUT:"
Write-Host $OutputDir
Write-Host ""
Write-Host "Send the golden-results-v3 files back to ChatGPT."
