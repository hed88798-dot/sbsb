param(
  [Parameter(Mandatory = $true)][string]$CandidateDirectory,
  [Parameter(Mandatory = $true)][string]$PreviousDirectory,
  [Parameter(Mandatory = $true)][string]$ReportDirectory,
  [Parameter(Mandatory = $true)][string]$VmLabel
)

$ErrorActionPreference = 'Stop'
$CandidateDirectory = (Resolve-Path $CandidateDirectory).Path
$PreviousDirectory = (Resolve-Path $PreviousDirectory).Path
New-Item -ItemType Directory -Force $ReportDirectory | Out-Null
$ReportDirectory = (Resolve-Path $ReportDirectory).Path
$appData = Join-Path $env:LOCALAPPDATA 'Company\AiVideoDesktop'
$installDirectory = Join-Path $env:LOCALAPPDATA 'Programs\兽药电商AI文案'
$productName = "code-f-synthetic-$env:GITHUB_RUN_ID-$VmLabel"
$statuses = [ordered]@{
  INSTALL = 'FAIL'
  LAUNCH = 'FAIL'
  PRODUCT_SMOKE = 'FAIL'
  COPYWRITING_SMOKE = 'FAIL'
  UPDATE = 'FAIL'
  RELAUNCH = 'FAIL'
  DATA_AFTER_UPDATE = 'FAIL'
  ROLLBACK = 'FAIL'
  UNINSTALL = 'FAIL'
  DATA_AFTER_UNINSTALL = 'FAIL'
  UPDATE_FAILURE = 'NOT_YET_AUTOMATED'
}
$failure = $null

function Get-Installer([string]$Directory) {
  $installer = Get-ChildItem $Directory -Recurse -File -Filter '*.exe' |
    Where-Object { $_.Name -notlike 'Uninstall*' } |
    Select-Object -First 1
  if (-not $installer) { throw "Installer not found in $Directory" }
  return $installer
}

function Assert-Signed([System.IO.FileInfo]$Installer) {
  $signature = Get-AuthenticodeSignature $Installer.FullName
  if ($signature.Status -ne 'Valid') {
    throw "Authenticode signature is not valid for $($Installer.Name): $($signature.Status)"
  }
}

function Install-App([System.IO.FileInfo]$Installer) {
  $process = Start-Process -FilePath $Installer.FullName -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
}

function Get-AppExecutable {
  if (-not (Test-Path $installDirectory)) { throw "Install directory missing: $installDirectory" }
  $executable = Get-ChildItem $installDirectory -File -Filter '*.exe' |
    Where-Object { $_.Name -notlike 'Uninstall*' } |
    Select-Object -First 1
  if (-not $executable) { throw 'Installed application executable not found' }
  return $executable
}

function Invoke-UiSmoke([string]$Mode) {
  $executable = Get-AppExecutable
  & node tools/windows/desktop-ui-smoke.mjs --executable $executable.FullName --mode $Mode --product $productName --screenshots (Join-Path $ReportDirectory 'screenshots')
  if ($LASTEXITCODE -ne 0) { throw "Desktop UI smoke failed in $Mode mode" }
}

try {
  if (Test-Path $appData) { throw "VM is not clean; user data already exists: $appData" }
  if (Test-Path $installDirectory) { throw "VM is not clean; app is already installed: $installDirectory" }

  $previousInstaller = Get-Installer $PreviousDirectory
  $candidateInstaller = Get-Installer $CandidateDirectory
  Assert-Signed $previousInstaller
  Assert-Signed $candidateInstaller

  $metadata = Get-ChildItem $CandidateDirectory -Recurse -File -Filter 'ARTIFACT_METADATA.json' | Select-Object -First 1
  if (-not $metadata) { throw 'Candidate artifact metadata is missing' }
  & node tools/release/verify-artifact-metadata.mjs $metadata.FullName $candidateInstaller.FullName
  if ($LASTEXITCODE -ne 0) { throw 'Candidate artifact hash verification failed' }

  Install-App $previousInstaller
  $statuses.INSTALL = 'PASS'
  Invoke-UiSmoke 'create'
  $statuses.LAUNCH = 'PASS'
  $statuses.PRODUCT_SMOKE = 'PASS'
  $statuses.COPYWRITING_SMOKE = 'PASS'
  $database = Join-Path $appData 'app.db'
  if (-not (Test-Path $database)) { throw 'Business database was not created' }

  Install-App $candidateInstaller
  $statuses.UPDATE = 'PASS'
  Invoke-UiSmoke 'verify'
  $statuses.RELAUNCH = 'PASS'
  $statuses.DATA_AFTER_UPDATE = 'PASS'

  Install-App $previousInstaller
  Invoke-UiSmoke 'verify'
  $statuses.ROLLBACK = 'PASS'

  Install-App $candidateInstaller
  Invoke-UiSmoke 'verify'
  $uninstaller = Get-ChildItem $installDirectory -File -Filter 'Uninstall*.exe' | Select-Object -First 1
  if (-not $uninstaller) { throw 'Uninstaller not found' }
  $uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstallProcess.ExitCode)" }
  if (Test-Path $installDirectory) { throw 'Application files remain after uninstall' }
  $statuses.UNINSTALL = 'PASS'
  if (-not (Test-Path $database)) { throw 'User business database was removed by uninstall' }
  $statuses.DATA_AFTER_UNINSTALL = 'PASS'
} catch {
  $failure = $_.Exception.Message
} finally {
  $computer = Get-ComputerInfo
  $report = [ordered]@{
    schema_version = '1.0'
    vm_label = $VmLabel
    windows_product = $computer.WindowsProductName
    windows_version = $computer.WindowsVersion
    windows_build = $computer.OsBuildNumber
    main_sha = $env:GITHUB_SHA
    build_run_id = $env:GITHUB_RUN_ID
    product_fixture = $productName
    statuses = $statuses
    known_issues = @($failure) | Where-Object { $_ }
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $ReportDirectory 'WINDOWS_CLEAN_VM_REPORT.json')
  $lines = @(
    '# Windows Clean VM Result',
    '',
    "- VM: $VmLabel",
    "- Windows: $($computer.WindowsProductName) $($computer.WindowsVersion) build $($computer.OsBuildNumber)",
    "- Main SHA: $env:GITHUB_SHA",
    "- Build run ID: $env:GITHUB_RUN_ID",
    ''
  )
  foreach ($entry in $statuses.GetEnumerator()) { $lines += "- $($entry.Key): $($entry.Value)" }
  if ($failure) { $lines += ''; $lines += "- FAILURE: $failure" }
  $lines | Set-Content -Encoding utf8 (Join-Path $ReportDirectory 'WINDOWS_CLEAN_VM_REPORT.md')
}

if ($failure) { throw $failure }
