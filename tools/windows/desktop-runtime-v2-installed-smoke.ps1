param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
if (Test-Path -LiteralPath $InstallRoot) {
  throw 'INSTALLED_SMOKE_ROOT_MUST_START_ABSENT'
}

$install = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$InstallRoot") `
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
