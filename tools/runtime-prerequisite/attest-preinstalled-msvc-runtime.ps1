[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$manifestJson = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifestHash = [string]$manifestJson.manifest_sha256
if ($manifestJson.prerequisite_id -ne 'microsoft-vc-v14-x64-14.51.36247.0' -or
    $manifestJson.manifest_sha256 -ne 'c3dd16982ee2c406aa3795aabc2e18ba3870125f861fea7a06f75111449ebe3b' -or
    $manifestJson.target_disposition -ne 'EXTERNAL_PREREQUISITE') {
  throw 'external prerequisite manifest identity is not the approved MSVC v14 x64 record'
}

function Convert-RuntimeVersion {
  param([Parameter(Mandatory = $true)][string]$Value)
  $normalized = $Value.Trim() -replace '^[vV]', ''
  return ([version]$normalized)
}

$minimum = Convert-RuntimeVersion ([string]$manifestJson.compatibility_policy.minimum_accepted_version)
$registry = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
$registryVersion = if ($null -eq $registry) { $null } else {
  Convert-RuntimeVersion ([string]$registry.Version)
}
if ($null -eq $registry -or [int]$registry.Installed -ne 1 -or $registryVersion -lt $minimum) {
  throw 'BLOCKED_VALIDATION_ENVIRONMENT_PREREQUISITE_MISSING: compatible preinstalled MSVC runtime was not found'
}

$windir = $env:WINDIR
if ([string]::IsNullOrWhiteSpace($windir)) { throw 'SystemRoot/WINDIR is unavailable' }
$capabilities = @()
foreach ($capability in $manifestJson.provider.provided_capabilities) {
  $name = [string]$capability
  $path = Join-Path (Join-Path $windir 'System32') $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "missing preinstalled runtime capability: $name" }
  $file = Get-Item -LiteralPath $path
  $versionText = [string]$file.VersionInfo.FileVersion
  if ([string]::IsNullOrWhiteSpace($versionText)) { throw "runtime capability has no file version: $name" }
  $version = Convert-RuntimeVersion $versionText
  if ($version -lt $minimum) { throw "runtime capability is older than minimum: $name" }
  $capabilities += [ordered]@{
    capability = $name.ToLowerInvariant()
    installed_path = ('%WINDIR%/System32/' + $name)
    file_version = $version.ToString()
    sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$document = [ordered]@{
  schema_version = '1'
  attestation_kind = 'PREINSTALLED_COMPATIBLE_RUNTIME_ONLY'
  prerequisite_id = $manifestJson.prerequisite_id
  manifest_sha256 = $manifestHash
  runtime_family = $manifestJson.compatibility_policy.runtime_family
  architecture = 'x86_64'
  observed_before_build = $true
  registry = [ordered]@{
    path = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
    Installed = [int]$registry.Installed
    Version = $registryVersion.ToString()
  }
  installed_runtime_version = $registryVersion.ToString()
  capabilities = $capabilities
  VC_REDIST_DOWNLOADED_BY_CODE_C = 'NO'
  VC_REDIST_BUNDLED_BY_CODE_C = 'NO'
  VC_REDIST_INSTALLED_BY_CODE_C = 'NO'
}
$parent = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$json = $document | ConvertTo-Json -Depth 8
$destination = [IO.Path]::GetFullPath($Output)
[IO.File]::WriteAllText($destination, $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Output ('preinstalled-msvc-runtime: PASS (' + $document.installed_runtime_version + ')')
