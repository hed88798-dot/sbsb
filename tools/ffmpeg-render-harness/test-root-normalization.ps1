$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'root-normalization.ps1')

function Assert-RootTest {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Condition,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  if (-not $Condition) {
    throw "ROOT_NORMALIZATION_TEST_FAIL: $Message"
  }
}

function Assert-RootIsolationRejected {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimeRoot,

    [Parameter(Mandatory = $true)]
    [string]$PixelOracleRoot,

    [Parameter(Mandatory = $true)]
    [string]$CaseName
  )

  $rejected = $false
  try {
    Test-RootIsolation $RuntimeRoot $PixelOracleRoot | Out-Null
  }
  catch {
    $rejected = $true
  }
  Assert-RootTest $rejected "$CaseName was accepted"
}

$runtimePrefix = Get-CanonicalRootPrefix 'C:\runtime\v2\'
$pixelOraclePrefix = Get-CanonicalRootPrefix 'C:\pixel-oracle\'
Assert-RootTest ($runtimePrefix.EndsWith([IO.Path]::DirectorySeparatorChar)) 'runtime root did not receive a separator prefix'
Assert-RootTest ($pixelOraclePrefix.EndsWith([IO.Path]::DirectorySeparatorChar)) 'pixel oracle root did not receive a separator prefix'
Assert-RootTest ($runtimePrefix.TrimEnd([char[]]@(92, 47)) -eq 'C:\runtime\v2') 'runtime root canonicalization changed the path'
Assert-RootTest ($pixelOraclePrefix.TrimEnd([char[]]@(92, 47)) -eq 'C:\pixel-oracle') 'pixel oracle root canonicalization changed the path'

Test-RootIsolation 'C:\runtime\v2\' 'C:\pixel-oracle\' | Out-Null
Assert-RootIsolationRejected 'C:\runtime\v2\' 'C:\runtime\v2\pixel-oracle\' 'pixel oracle nested under runtime'
Assert-RootIsolationRejected 'C:\pixel-oracle\runtime\' 'C:\pixel-oracle\' 'runtime nested under pixel oracle'
Assert-RootIsolationRejected 'C:\runtime\v2\' 'C:\runtime\v2' 'equal roots'

Write-Output 'ROOT_NORMALIZATION_TEST: PASS'
