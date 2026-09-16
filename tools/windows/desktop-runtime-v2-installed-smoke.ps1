param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$EvidencePath,
  [Parameter(Mandatory = $true)][string]$NormalEvidencePath,
  [Parameter(Mandatory = $true)][string]$ExpectedHeadSha
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
if (Test-Path -LiteralPath $InstallRoot) {
  throw 'INSTALLED_SMOKE_ROOT_MUST_START_ABSENT'
}

$install = Start-Process -FilePath $installerPath -ArgumentList '/S' `
  -Wait -PassThru -WindowStyle Hidden
if ($install.ExitCode -ne 0) {
  throw "NSIS_INSTALL_FAILED:$($install.ExitCode)"
}

try {
  $application = Get-ChildItem -LiteralPath $InstallRoot -Filter '*.exe' -File |
    Where-Object { $_.Name -notlike 'Uninstall*' } |
    Select-Object -First 1
  if (-not $application) {
    throw 'INSTALLED_DESKTOP_EXECUTABLE_NOT_FOUND'
  }
  & "$PSScriptRoot/desktop-runtime-v2-packaged-smoke.ps1" `
    -Executable $application.FullName `
    -EvidencePath $EvidencePath `
    -Mode REAL_INSTALLED_APP

  $normalEvidence = [IO.Path]::GetFullPath($NormalEvidencePath)
  $normalEvidenceDirectory = Split-Path -Parent $normalEvidence
  New-Item -ItemType Directory -Path $normalEvidenceDirectory -Force | Out-Null
  $previousStartupSmoke = $env:DESKTOP_INSTALLED_STARTUP_SMOKE
  $previousStartupEvidence = $env:DESKTOP_INSTALLED_STARTUP_SMOKE_EVIDENCE_PATH
  $previousHeadSha = $env:GITHUB_SHA
  $normalStdout = Join-Path $normalEvidenceDirectory 'NORMAL_INSTALLED_DESKTOP.stdout.txt'
  $normalStderr = Join-Path $normalEvidenceDirectory 'NORMAL_INSTALLED_DESKTOP.stderr.txt'
  try {
    $env:DESKTOP_INSTALLED_STARTUP_SMOKE = '1'
    $env:DESKTOP_INSTALLED_STARTUP_SMOKE_EVIDENCE_PATH = $normalEvidence
    $env:GITHUB_SHA = $ExpectedHeadSha
    $normalProcess = Start-Process -FilePath $application.FullName -Wait -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $normalStdout -RedirectStandardError $normalStderr
  } finally {
    $env:DESKTOP_INSTALLED_STARTUP_SMOKE = $previousStartupSmoke
    $env:DESKTOP_INSTALLED_STARTUP_SMOKE_EVIDENCE_PATH = $previousStartupEvidence
    $env:GITHUB_SHA = $previousHeadSha
  }
  if (-not (Test-Path -LiteralPath $normalEvidence)) {
    throw 'NORMAL_INSTALLED_DESKTOP_SMOKE_EVIDENCE_MISSING'
  }
  $normalRecord = Get-Content -LiteralPath $normalEvidence -Raw | ConvertFrom-Json
  $requiredTrue = @(
    'render_composition_initialized',
    'render_execution_recovery_completed',
    'render_preparation_recovery_completed',
    'generic_non_render_recovery_completed',
    'browser_window_created',
    'shutdown_requested',
    'graceful_shutdown_completed',
    'database_closed_after_settlement'
  )
  $missingMarker = $requiredTrue | Where-Object { $normalRecord.$_ -ne $true } | Select-Object -First 1
  if (
    $normalProcess.ExitCode -ne 0 -or
    $normalRecord.result -ne 'PASS' -or
    $normalRecord.head_sha -ne $ExpectedHeadSha -or
    $normalRecord.unhandled_main_rejection_observed -ne $false -or
    $normalRecord.uncaught_main_exception_observed -ne $false -or
    $normalRecord.main_startup_failure_observed -ne $false -or
    $normalRecord.runtime_fallback_observed -ne $false -or
    $missingMarker
  ) {
    throw 'NORMAL_INSTALLED_DESKTOP_SMOKE_FAILED'
  }
  Write-Host 'NORMAL_INSTALLED_DESKTOP_SMOKE:PASS'
} finally {
  $uninstaller = Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File `
    -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($uninstaller) {
    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' `
      -Wait -PassThru -WindowStyle Hidden
    if ($uninstall.ExitCode -ne 0) {
      throw "NSIS_UNINSTALL_FAILED:$($uninstall.ExitCode)"
    }
  }
}
