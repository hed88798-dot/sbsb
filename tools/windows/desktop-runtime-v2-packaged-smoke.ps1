param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$EvidencePath,
  [ValidateSet('PACKAGING_ARTIFACT', 'REAL_INSTALLED_APP')][string]$Mode = 'PACKAGING_ARTIFACT'
)

$ErrorActionPreference = 'Stop'
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$evidenceDirectory = Split-Path -Parent $EvidencePath
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$stdoutPath = Join-Path $evidenceDirectory "$Mode.stdout.txt"
$stderrPath = Join-Path $evidenceDirectory "$Mode.stderr.txt"

$previousSmoke = $env:DESKTOP_RENDER_RUNTIME_SMOKE
try {
  $env:DESKTOP_RENDER_RUNTIME_SMOKE = '1'
  $process = Start-Process -FilePath $executablePath -Wait -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
} finally {
  $env:DESKTOP_RENDER_RUNTIME_SMOKE = $previousSmoke
}

$output = (Get-Content -LiteralPath $stdoutPath -Raw) + (Get-Content -LiteralPath $stderrPath -Raw)
if ($process.ExitCode -ne 0) {
  throw "PACKAGED_RENDER_RUNTIME_SMOKE_PROCESS_FAILED:$($process.ExitCode)`n$output"
}
$marker = ($output -split "`r?`n" | Where-Object {
    $_.StartsWith('PACKAGED_RENDER_RUNTIME_SMOKE_JSON:')
  } | Select-Object -Last 1)
if (-not $marker) {
  throw "PACKAGED_RENDER_RUNTIME_SMOKE_EVIDENCE_MISSING`n$output"
}
$payload = $marker.Substring('PACKAGED_RENDER_RUNTIME_SMOKE_JSON:'.Length) | ConvertFrom-Json
if (
  $payload.status -ne 'PASS' -or
  $payload.runtime_authority -ne 'PASS' -or
  $payload.packaged_path_containment -ne 'PASS' -or
  $payload.path_fallback_used -ne $false
) {
  throw 'PACKAGED_RENDER_RUNTIME_SMOKE_EVIDENCE_INVALID'
}
$record = [ordered]@{
  schema_version = '1'
  record_kind = 'DESKTOP_RUNTIME_V2_WINDOWS_PACKAGED_SMOKE'
  mode = $Mode
  executable = $executablePath
  status = 'PASS'
  observed = $payload
}
$record | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $EvidencePath -Encoding utf8NoBOM
Write-Host "DESKTOP_RUNTIME_V2_$($Mode)_SMOKE:PASS"
