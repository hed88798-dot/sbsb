function Get-CanonicalRootPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ResolvedPath
  )

  if ([string]::IsNullOrWhiteSpace($ResolvedPath)) {
    throw 'root path must not be empty'
  }

  # PowerShell treats backslash as an ordinary character, not an escape. Use
  # numeric character values so both separators are unambiguously single chars.
  $separatorChars = [char[]]@(92, 47)
  $normalized = $ResolvedPath.Replace([char]92, [IO.Path]::DirectorySeparatorChar)
  $normalized = $normalized.Replace([char]47, [IO.Path]::DirectorySeparatorChar)
  $trimmed = $normalized.TrimEnd($separatorChars)
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    throw 'root path normalized to empty'
  }
  return $trimmed
}

function Get-CanonicalRootPrefix {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ResolvedPath
  )

  return (Get-CanonicalRootPath $ResolvedPath) + [IO.Path]::DirectorySeparatorChar
}

function Test-RootIsolation {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimeRootResolved,

    [Parameter(Mandatory = $true)]
    [string]$PixelOracleRootResolved
  )

  $runtimeRoot = Get-CanonicalRootPath $RuntimeRootResolved
  $pixelOracleRoot = Get-CanonicalRootPath $PixelOracleRootResolved
  $runtimeRootPrefix = $runtimeRoot + [IO.Path]::DirectorySeparatorChar
  $pixelOracleRootPrefix = $pixelOracleRoot + [IO.Path]::DirectorySeparatorChar

  if ([string]::Equals($runtimeRoot, $pixelOracleRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'pixel oracle must be separate from the product Runtime root'
  }
  if ($pixelOracleRoot.StartsWith($runtimeRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'pixel oracle may not be nested under the product Runtime root'
  }
  if ($runtimeRoot.StartsWith($pixelOracleRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'product Runtime may not be nested under the pixel oracle root'
  }

  return [ordered]@{
    runtime_root = $runtimeRoot
    runtime_root_prefix = $runtimeRootPrefix
    pixel_oracle_root = $pixelOracleRoot
    pixel_oracle_root_prefix = $pixelOracleRootPrefix
  }
}
