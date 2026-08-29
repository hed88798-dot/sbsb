param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'
$manifestDocument = Get-Content -Raw $Manifest | ConvertFrom-Json
$bootstrap = $manifestDocument.provider.bootstrap_artifact
$policy = $manifestDocument.compatibility_policy
$downloadRoot = Join-Path $env:RUNNER_TEMP 'msvc-runtime-provider'
New-Item -ItemType Directory -Force $downloadRoot | Out-Null
$artifact = Join-Path $downloadRoot $bootstrap.filename
$installLog = Join-Path $downloadRoot 'install.log'
$uninstallLog = Join-Path $downloadRoot 'uninstall.log'

Invoke-WebRequest -Uri $bootstrap.canonical_source -OutFile $artifact
$actualHash = (Get-FileHash -Algorithm SHA256 $artifact).Hash.ToLowerInvariant()
$actualSize = (Get-Item $artifact).Length
$fileVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($artifact).ProductVersion.Trim()
if ($actualHash -ne $bootstrap.sha256) { throw "bootstrap SHA-256 mismatch: $actualHash" }
if ($actualSize -ne $bootstrap.size) { throw "bootstrap size mismatch: $actualSize" }
if ([version]$fileVersion -ne [version]$bootstrap.version) {
  throw "bootstrap version mismatch: $fileVersion"
}

$signature = Get-AuthenticodeSignature $artifact
if ($signature.Status -ne 'Valid') { throw "invalid Authenticode status: $($signature.Status)" }
$signerSubject = $signature.SignerCertificate.Subject
$signerCertificateSha256 = $signature.SignerCertificate.GetCertHashString('SHA256').ToLowerInvariant()
if ($signerSubject -ne $bootstrap.expected_signer_subject) {
  throw "unexpected signer subject: $signerSubject"
}
if ($signerCertificateSha256 -ne $bootstrap.expected_signer_certificate_sha256) {
  throw "unexpected signer certificate SHA-256: $signerCertificateSha256"
}

$registryPaths = @(
  'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64',
  'HKLM:\SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
)
function Read-RuntimeState {
  foreach ($path in $registryPaths) {
    if (Test-Path $path) {
      $item = Get-ItemProperty $path
      if ($null -ne $item.Version) {
        return [pscustomobject]@{ Path = $path; Installed = [int]$item.Installed; Version = [string]$item.Version }
      }
    }
  }
  return $null
}

$preState = Read-RuntimeState
$uninstall = Start-Process -FilePath $artifact -ArgumentList @(
  '/uninstall', '/quiet', '/norestart', '/log', $uninstallLog
) -Wait -PassThru
if ($uninstall.ExitCode -notin @(0, 1605, 3010)) {
  throw "exact bootstrap uninstall failed: $($uninstall.ExitCode)"
}
$install = Start-Process -FilePath $artifact -ArgumentList @(
  '/install', '/quiet', '/norestart', '/log', $installLog
) -Wait -PassThru
if ($install.ExitCode -notin @(0, 3010)) {
  throw "exact bootstrap install failed: $($install.ExitCode)"
}

$installed = Read-RuntimeState
if ($null -eq $installed -or $installed.Installed -ne 1) {
  throw 'x64 installed runtime registry state is missing'
}
if ([version]$installed.Version -lt [version]$policy.minimum_accepted_version) {
  throw "installed runtime $($installed.Version) is below $($policy.minimum_accepted_version)"
}

$capabilities = @()
foreach ($capability in $manifestDocument.provider.provided_capabilities) {
  $path = Join-Path $env:WINDIR "System32\$capability"
  if (-not (Test-Path $path)) { throw "installed provider capability missing: $capability" }
  $capabilities += [ordered]@{
    capability = $capability
    installed_path = "%WINDIR%/System32/$capability"
    file_version = [Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion
    sha256 = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
  }
}

$runnerImage = [string]$env:ImageVersion
if ([string]::IsNullOrWhiteSpace($runnerImage)) {
  $runnerImage = "hosted-$($env:RUNNER_OS)-$($env:RUNNER_ARCH)"
}

$evidence = [ordered]@{
  schema_version = '1'
  evidence_id = "msvc-provider-$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
  prerequisite_id = $manifestDocument.prerequisite_id
  provider_identity_sha256 = $manifestDocument.provider_identity_sha256
  captured_at = (Get-Date).ToUniversalTime().ToString('o')
  runner = [ordered]@{
    os = 'Windows'
    architecture = 'X64'
    image = $runnerImage
    workflow_run_id = [int64]$env:GITHUB_RUN_ID
    workflow_run_attempt = [int]$env:GITHUB_RUN_ATTEMPT
  }
  bootstrap_artifact = [ordered]@{
    filename = $bootstrap.filename
    version = $bootstrap.version
    sha256 = $actualHash
    size = $actualSize
    source = $bootstrap.canonical_source
    authenticode_status = [string]$signature.Status
    signer_subject = $signerSubject
    signer_certificate_sha256 = $signerCertificateSha256
  }
  installation = [ordered]@{
    pre_probe_version = if ($null -eq $preState) { $null } else { $preState.Version }
    uninstall_exit_code = $uninstall.ExitCode
    install_exit_code = $install.ExitCode
    mode = 'EXACT_BOOTSTRAP_UNINSTALL_THEN_INSTALL'
  }
  installed_runtime = [ordered]@{
    registry_key = $installed.Path.Replace('HKLM:\', 'HKLM/')
    installed = $installed.Installed
    version = $installed.Version
    minimum_version_satisfied = $true
  }
  provider_installed_required_capabilities = $capabilities
  runtime_provider_closure = 'PASS'
  provider_installation_artifact_bound = $true
}

$outputDirectory = Split-Path -Parent $Output
New-Item -ItemType Directory -Force $outputDirectory | Out-Null
$evidence | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8NoBOM $Output
