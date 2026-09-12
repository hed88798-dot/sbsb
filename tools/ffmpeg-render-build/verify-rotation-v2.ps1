[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RuntimeRoot,

  [Parameter(Mandatory = $true)]
  [string]$Output,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedRuntimeId,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedManifestSha256,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedRuntimeIdentitySha256,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedFfmpegSha256,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedFfprobeSha256,

  [string]$ExpectedCodeGProfileHash = '2c19710e609b1ae769e7f007cffca1e552ce1158963bec2aa8a8bcad59a01c1b',

  [string]$ExpectedBuildProfileHash = '40ebffb4307b1c2ec141ffbdd3be2e2c52545090ea1f776267fa445952b3657c',

  [string]$RepositoryRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$displayAngleTolerance = 0.5
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$rotationOutput = Join-Path (Resolve-Path -LiteralPath $Output) 'rotation-v2'
$evidencePath = Join-Path $rotationOutput 'rotation-v2-harness.json'
$cases = [System.Collections.Generic.List[object]]::new()
$evidence = [ordered]@{
  schema_version = '1'
  record_kind = 'FFMPEG_RENDER_RUNTIME_V2_ROTATION_HARNESS'
  status = 'STARTED'
  harness_scope = 'CODE_F_RUNTIME_LEVEL_ONLY'
  product_render = 'NOT_RUN'
  code_g_r1b_product_path = 'NOT_RUN'
}

function Fail([string]$Message) {
  throw "FFMPEG_RENDER_RUNTIME_V2_ROTATION_HARNESS_FAIL: $Message"
}

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { Fail $Message }
}

function Hash-File([string]$Path) {
  Assert-Condition (Test-Path -LiteralPath $Path -PathType Leaf) "missing file: $Path"
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-Tool(
  [string]$Tool,
  [string[]]$Arguments,
  [string]$StdoutPath,
  [string]$StderrPath
) {
  Remove-Item -LiteralPath $StdoutPath, $StderrPath -Force -ErrorAction SilentlyContinue
  & $Tool @Arguments 1> $StdoutPath 2> $StderrPath
  return $LASTEXITCODE
}

function Read-Probe([string]$InputPath, [string]$Label, [switch]$CountFrames) {
  $stdout = Join-Path $rotationOutput "$Label.ffprobe.json"
  $stderr = Join-Path $rotationOutput "$Label.ffprobe.stderr.txt"
  $arguments = @('-v', 'error')
  if ($CountFrames) { $arguments += '-count_frames' }
  $arguments += @('-show_streams', '-show_format', '-of', 'json', $InputPath)
  $code = Invoke-Tool $ffprobe $arguments $stdout $stderr
  Assert-Condition ($code -eq 0) "ffprobe failed for $Label"
  return (Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json)
}

function Normalize-DisplayAngle([double]$Angle) {
  Assert-Condition (-not [double]::IsNaN($Angle) -and -not [double]::IsInfinity($Angle)) "display angle must be finite: $Angle"
  $normalized = $Angle % 360
  if ($normalized -gt 180) { $normalized -= 360 }
  if ($normalized -lt -180) { $normalized += 360 }
  if ([math]::Abs($normalized) -le $displayAngleTolerance) { return 0.0 }
  if ([math]::Abs([math]::Abs($normalized) - 180) -le $displayAngleTolerance) { return 180.0 }
  return $normalized
}

function Test-AngleEquivalent([double]$Actual, [double]$Expected) {
  return [math]::Abs((Normalize-DisplayAngle $Actual) - (Normalize-DisplayAngle $Expected)) -le $displayAngleTolerance
}

function Get-DisplayAngleFamily([double]$Angle) {
  $normalized = Normalize-DisplayAngle $Angle
  if ([math]::Abs($normalized) -le $displayAngleTolerance) { return 'IDENTITY' }
  if ([math]::Abs($normalized - 90) -le $displayAngleTolerance) { return 'POSITIVE_90' }
  if ([math]::Abs($normalized + 90) -le $displayAngleTolerance) { return 'NEGATIVE_90' }
  if ([math]::Abs([math]::Abs($normalized) - 180) -le $displayAngleTolerance) { return 'HALF_TURN' }
  return 'OTHER'
}

function Get-DisplayRotation([object]$Stream) {
  foreach ($side in @($Stream.side_data_list)) {
    if ("$($side.side_data_type)" -match '(?i)display matrix') {
      if ($null -ne $side.rotation -and "$($side.rotation)" -ne '') {
        return [double]$side.rotation
      }
      if ($side.displaymatrix) {
        $matches = [regex]::Matches([string]$side.displaymatrix, '(?<![A-Za-z])-?\d+')
        if ($matches.Count -ge 9) {
          $matrix = @($matches | Select-Object -First 9 | ForEach-Object { [int64]$_.Value })
          $identity =
            ([math]::Abs($matrix[0] - 65536) -le 4096) -and
            ([math]::Abs($matrix[4] - 65536) -le 4096) -and
            ([math]::Abs($matrix[8] - 1073741824) -le 16777216) -and
            (($matrix[1..3] + $matrix[5..7]) | ForEach-Object { [math]::Abs($_) -le 4096 } | Where-Object { -not $_ }).Count -eq 0
          if ($identity) { return 0.0 }
          return 999.0
        }
      }
      return 999.0
    }
  }
  return 0.0
}

function Get-PixelClass([byte[]]$Bytes, [int]$Width, [int]$Height, [int]$CenterX, [int]$CenterY) {
  $sum = @(0, 0, 0)
  $radius = 2
  $count = 0
  for ($y = [math]::Max(0, $CenterY - $radius); $y -le [math]::Min($Height - 1, $CenterY + $radius); $y++) {
    for ($x = [math]::Max(0, $CenterX - $radius); $x -le [math]::Min($Width - 1, $CenterX + $radius); $x++) {
      $offset = (($y * $Width) + $x) * 3
      for ($channel = 0; $channel -lt 3; $channel++) { $sum[$channel] += $Bytes[$offset + $channel] }
      $count++
    }
  }
  $mean = @($sum | ForEach-Object { $_ / $count })
  $palette = [ordered]@{
    red = @(220, 20, 20)
    green = @(20, 220, 20)
    blue = @(20, 20, 220)
    yellow = @(220, 220, 20)
  }
  $best = $null
  $bestDistance = [double]::PositiveInfinity
  foreach ($entry in $palette.GetEnumerator()) {
    $distance = 0.0
    for ($channel = 0; $channel -lt 3; $channel++) {
      $delta = $mean[$channel] - $entry.Value[$channel]
      $distance += $delta * $delta
    }
    if ($distance -lt $bestDistance) { $best = $entry.Key; $bestDistance = $distance }
  }
  return [ordered]@{ label = $best; mean_rgb = $mean; distance = [math]::Round($bestDistance, 2) }
}

function Write-Evidence {
  New-Item -ItemType Directory -Force -Path $rotationOutput | Out-Null
  $evidence.cases = @($cases)
  $evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $evidencePath -Encoding utf8
}

try {
  Assert-Condition (Test-Path -LiteralPath $RuntimeRoot -PathType Container) "runtime root unavailable: $RuntimeRoot"
  New-Item -ItemType Directory -Force -Path $rotationOutput | Out-Null

  $os = Get-CimInstance Win32_OperatingSystem
  $computer = Get-CimInstance Win32_ComputerSystem
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $adapters = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion)
  Assert-Condition ("$($os.Caption)" -match '(?i)Windows 11') "Windows 11 Desktop is required"
  Assert-Condition ("$($os.OSArchitecture)" -match '(?i)64') "x64 Windows Desktop is required"
  Assert-Condition ([int]$os.BuildNumber -ge 22000) "Windows build is not a supported Windows 11 build"
  Assert-Condition ([int]$os.ProductType -eq 1) "Server OS is not accepted for Desktop rotation evidence"
  $evidence.environment = [ordered]@{
    provider = 'CONTROLLED_WINDOWS_DESKTOP'
    windows_product_name = $os.Caption
    version = $os.Version
    build = $os.BuildNumber
    architecture = $os.OSArchitecture
    cpu = $cpu.Name
    display_adapters = $adapters
    session_name = $env:SESSIONNAME
    client_name = $env:CLIENTNAME
    computer_manufacturer = $computer.Manufacturer
    computer_model = $computer.Model
  }

  $bundle = Join-Path $RuntimeRoot 'bundle'
  $manifestPath = Join-Path $RuntimeRoot 'manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $ffmpeg = Join-Path $bundle 'ffmpeg.exe'
  $ffprobe = Join-Path $bundle 'ffprobe.exe'
  $ffmpegHash = Hash-File $ffmpeg
  $ffprobeHash = Hash-File $ffprobe
  Assert-Condition ($manifest.runtime_id -eq $ExpectedRuntimeId) "runtime id mismatch"
  Assert-Condition ($manifest.manifest_sha256 -eq $ExpectedManifestSha256) "manifest identity mismatch"
  Assert-Condition ($manifest.runtime_identity_sha256 -eq $ExpectedRuntimeIdentitySha256) "runtime identity mismatch"
  Assert-Condition ($ffmpegHash -eq $ExpectedFfmpegSha256.ToLowerInvariant()) "ffmpeg.exe hash mismatch"
  Assert-Condition ($ffprobeHash -eq $ExpectedFfprobeSha256.ToLowerInvariant()) "ffprobe.exe hash mismatch"
  Assert-Condition ($manifest.provenance.code_g_capability_profile_hash -eq $ExpectedCodeGProfileHash) "Code G profile hash mismatch"
  Assert-Condition ($manifest.provenance.build_profile_sha256 -eq $ExpectedBuildProfileHash) "Code F build profile hash mismatch"
  Assert-Condition ($manifest.runtime_dependency_closure.status -eq 'PASS') "runtime closure is not PASS"
  Assert-Condition ([int]$manifest.runtime_dependency_closure.unresolved_count -eq 0) "runtime closure has unresolved members"
  Assert-Condition ($manifest.distribution.system_path_fallback -eq $false) "system PATH fallback is enabled"
  Assert-Condition ($manifest.distribution.resolver_mode -eq 'EXPLICIT_BUNDLED_LOCATOR') "runtime resolver is not explicit bundled"

  $declaredMembers = @($manifest.bundle_members | ForEach-Object { $_.path } | Sort-Object)
  $actualMembers = @(Get-ChildItem -LiteralPath $bundle -File | ForEach-Object { $_.Name } | Sort-Object)
  Assert-Condition ((ConvertTo-Json $declaredMembers -Compress) -eq (ConvertTo-Json $actualMembers -Compress)) 'bundle member set mismatch'
  foreach ($member in @($manifest.bundle_members)) {
    Assert-Condition ((Hash-File (Join-Path $bundle $member.path)) -eq $member.sha256) "member hash mismatch: $($member.path)"
  }
  $closureMembers = @($manifest.runtime_dependency_closure.members | ForEach-Object { $_.member_path })
  foreach ($member in @($manifest.bundle_members | Where-Object { $_.kind -eq 'DYNAMIC_LIBRARY' })) {
    Assert-Condition ($closureMembers -contains $member.path) "DLL is absent from runtime closure: $($member.path)"
  }
  foreach ($entrypoint in @($manifest.entrypoints)) {
    Assert-Condition ((Hash-File (Join-Path $bundle $entrypoint.path)) -eq $entrypoint.sha256) "entrypoint hash mismatch: $($entrypoint.path)"
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  Assert-Condition ($null -ne $node) 'pinned Node.js verifier is required for manifest self-hash verification'
  $manifestVerifier = Join-Path $RepositoryRoot 'tools/ffmpeg-render-build/verify-manifest.mjs'
  $manifestVerifierStdout = Join-Path $rotationOutput 'manifest-verifier.stdout.txt'
  $manifestVerifierStderr = Join-Path $rotationOutput 'manifest-verifier.stderr.txt'
  $manifestCode = Invoke-Tool $node.Source @(
    $manifestVerifier,
    '--bundle', $bundle,
    '--manifest', $manifestPath,
    '--profile', (Join-Path $RepositoryRoot 'compliance/runtime-dependency-intake/ffmpeg-render-v2/FFMPEG_RENDER_BUILD_PROFILE_V2.json'),
    '--negative-controls'
  ) $manifestVerifierStdout $manifestVerifierStderr
  Assert-Condition ($manifestCode -eq 0) 'manifest verifier failed on the selected runtime'

  $evidence.candidate = [ordered]@{
    runtime_id = $manifest.runtime_id
    manifest_sha256 = $manifest.manifest_sha256
    runtime_identity_sha256 = $manifest.runtime_identity_sha256
    ffmpeg_sha256 = $ffmpegHash
    ffprobe_sha256 = $ffprobeHash
    code_g_profile_hash = $manifest.provenance.code_g_capability_profile_hash
    build_profile_hash = $manifest.provenance.build_profile_sha256
    source_commit = $manifest.provenance.source_commit
    source_tree_sha = $manifest.provenance.source_tree_sha
    manifest_verifier = 'PASS'
  }

  $sourceWidth = 32
  $sourceHeight = 24
  $frameCount = 30
  $rawPath = Join-Path $rotationOutput 'asymmetric.rgb24'
  $baseVideo = Join-Path $rotationOutput 'base.mp4'
  $raw = New-Object byte[] ($sourceWidth * $sourceHeight * 3 * $frameCount)
  $quadrantColors = @(
    @(220, 20, 20),
    @(20, 220, 20),
    @(20, 20, 220),
    @(220, 220, 20)
  )
  for ($frame = 0; $frame -lt $frameCount; $frame++) {
    for ($y = 0; $y -lt $sourceHeight; $y++) {
      for ($x = 0; $x -lt $sourceWidth; $x++) {
        $quadrant = if ($y -lt ($sourceHeight / 2)) { if ($x -lt ($sourceWidth / 2)) { 0 } else { 1 } } else { if ($x -lt ($sourceWidth / 2)) { 2 } else { 3 } }
        $color = $quadrantColors[$quadrant]
        $offset = (($frame * $sourceWidth * $sourceHeight) + ($y * $sourceWidth) + $x) * 3
        $raw[$offset] = $color[0]
        $raw[$offset + 1] = $color[1]
        $raw[$offset + 2] = $color[2]
      }
    }
  }
  [IO.File]::WriteAllBytes($rawPath, $raw)
  $baseCode = Invoke-Tool $ffmpeg @(
    '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-video_size', "$($sourceWidth)x$($sourceHeight)", '-framerate', '30', '-i', $rawPath,
    '-vf', 'format=nv12', '-frames:v', "$frameCount", '-an', '-c:v', 'h264_mf', '-pix_fmt', 'nv12',
    '-movflags', '+faststart', $baseVideo
  ) (Join-Path $rotationOutput 'base.stdout.txt') (Join-Path $rotationOutput 'base.stderr.txt')
  Assert-Condition ($baseCode -eq 0) 'failed to encode asymmetric Desktop harness fixture'

  $expectedCorners = @{
    90 = @('blue', 'red', 'yellow', 'green')
    180 = @('yellow', 'blue', 'green', 'red')
    270 = @('green', 'yellow', 'red', 'blue')
  }
  $expectedDimensions = @{ 90 = @(24, 32); 180 = @(32, 24); 270 = @(24, 32) }
  $filters = @{ 90 = 'transpose=1'; 180 = 'hflip,vflip'; 270 = 'transpose=2' }
  $expectedMetadataAngles = @{ 90 = 90.0; 180 = 180.0; 270 = -90.0 }
  $fixtureDirections = @{}

  foreach ($angle in @(90, 180, 270)) {
    $fixture = Join-Path $rotationOutput "fixture-$angle.mp4"
    $fixtureCode = Invoke-Tool $ffmpeg @(
      '-hide_banner', '-loglevel', 'error', '-i', $baseVideo, '-map', '0:v:0', '-c', 'copy',
      '-metadata:s:v:0', "rotate=$angle", '-movflags', '+faststart', $fixture
    ) (Join-Path $rotationOutput "fixture-$angle.stdout.txt") (Join-Path $rotationOutput "fixture-$angle.stderr.txt")
    Assert-Condition ($fixtureCode -eq 0) "failed to create $angle degree display-matrix fixture"
    $fixtureProbe = Read-Probe $fixture "fixture-$angle"
    $fixtureStream = @($fixtureProbe.streams | Where-Object { $_.codec_type -eq 'video' })[0]
    $fixtureRotation = Get-DisplayRotation $fixtureStream
    $fixtureRotationNormalized = Normalize-DisplayAngle $fixtureRotation
    Assert-Condition (Test-AngleEquivalent $fixtureRotation $expectedMetadataAngles[$angle]) "fixture $angle degree display matrix was not recorded as the expected signed angle"
    $fixtureDirections[$angle] = Get-DisplayAngleFamily $fixtureRotation
    if ($angle -eq 90 -or $angle -eq 270) {
      Assert-Condition ($fixtureDirections[$angle] -ne 'OTHER' -and $fixtureDirections[$angle] -ne 'IDENTITY' -and $fixtureDirections[$angle] -ne 'HALF_TURN') "fixture $angle degree display matrix is not a quarter-turn"
    }

    $outputPath = Join-Path $rotationOutput "output-$angle.mp4"
    $outputCode = Invoke-Tool $ffmpeg @(
      '-hide_banner', '-loglevel', 'error', '-noautorotate', '-i', $fixture, '-map', '0:v:0',
      '-vf', "$($filters[$angle]),setsar=1,fps=30,format=nv12", '-fps_mode', 'cfr', '-r', '30',
      '-frames:v', "$frameCount", '-c:v', 'h264_mf', '-pix_fmt', 'nv12', '-map_metadata', '-1',
      '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', $outputPath
    ) (Join-Path $rotationOutput "output-$angle.stdout.txt") (Join-Path $rotationOutput "output-$angle.stderr.txt")
    Assert-Condition ($outputCode -eq 0) "rotation $angle degree runtime execution failed"
    $outputProbe = Read-Probe $outputPath "output-$angle" -CountFrames
    $outputStream = @($outputProbe.streams | Where-Object { $_.codec_type -eq 'video' })[0]
    Assert-Condition ([int]$outputStream.width -eq $expectedDimensions[$angle][0]) "rotation $angle width mismatch"
    Assert-Condition ([int]$outputStream.height -eq $expectedDimensions[$angle][1]) "rotation $angle height mismatch"
    Assert-Condition ("$($outputStream.r_frame_rate)" -eq '30/1') "rotation $angle frame rate mismatch"
    Assert-Condition ([int]$outputStream.nb_read_frames -eq $frameCount) "rotation $angle frame count mismatch"
    Assert-Condition ("$($outputStream.pix_fmt)" -eq 'yuv420p') "rotation $angle output pixel format is not normalized"
    Assert-Condition ("$($outputStream.sample_aspect_ratio)" -eq '1:1') "rotation $angle SAR is not normalized"
    $outputRotation = Get-DisplayRotation $outputStream
    Assert-Condition ([math]::Abs($outputRotation) -le 0.5) "rotation $angle left non-identity display metadata"

    $decoded = Join-Path $rotationOutput "output-$angle.rgb24"
    $decodeCode = Invoke-Tool $ffmpeg @(
      '-hide_banner', '-loglevel', 'error', '-i', $outputPath, '-map', '0:v:0', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', $decoded
    ) (Join-Path $rotationOutput "decode-$angle.stdout.txt") (Join-Path $rotationOutput "decode-$angle.stderr.txt")
    Assert-Condition ($decodeCode -eq 0) "rotation $angle pixel decode failed"
    $decodedBytes = [IO.File]::ReadAllBytes($decoded)
    Assert-Condition ($decodedBytes.Length -eq ($expectedDimensions[$angle][0] * $expectedDimensions[$angle][1] * 3)) "rotation $angle decoded frame size mismatch"
    $cornerX = @([math]::Floor($expectedDimensions[$angle][0] * 0.25), [math]::Floor($expectedDimensions[$angle][0] * 0.75))
    $cornerY = @([math]::Floor($expectedDimensions[$angle][1] * 0.25), [math]::Floor($expectedDimensions[$angle][1] * 0.75))
    $actualCorners = @(
      Get-PixelClass $decodedBytes $expectedDimensions[$angle][0] $expectedDimensions[$angle][1] $cornerX[0] $cornerY[0]
      Get-PixelClass $decodedBytes $expectedDimensions[$angle][0] $expectedDimensions[$angle][1] $cornerX[1] $cornerY[0]
      Get-PixelClass $decodedBytes $expectedDimensions[$angle][0] $expectedDimensions[$angle][1] $cornerX[0] $cornerY[1]
      Get-PixelClass $decodedBytes $expectedDimensions[$angle][0] $expectedDimensions[$angle][1] $cornerX[1] $cornerY[1]
    )
    for ($index = 0; $index -lt 4; $index++) {
      Assert-Condition ($actualCorners[$index].label -eq $expectedCorners[$angle][$index]) "rotation $angle visible orientation mismatch at corner $index"
    }
    $cases.Add([ordered]@{
      degrees = $angle
      metadata_fixture = "fixture-$angle.mp4"
      source_display_rotation = $fixtureRotation
      source_display_rotation_normalized = $fixtureRotationNormalized
      source_display_rotation_family = $fixtureDirections[$angle]
      filter = $filters[$angle]
      declared_rotation_application_count = 1
      output_width = [int]$outputStream.width
      output_height = [int]$outputStream.height
      output_fps = "$($outputStream.r_frame_rate)"
      output_frame_count = [int]$outputStream.nb_read_frames
      output_pixel_format = $outputStream.pix_fmt
      output_sar = $outputStream.sample_aspect_ratio
      output_display_rotation = $outputRotation
      visible_orientation = $actualCorners
      rotation_applied_exactly_once = $true
      nonidentity_display_matrix = $false
    })
  }

  Assert-Condition ($fixtureDirections[90] -ne $fixtureDirections[270]) '90 and 270 degree metadata directions were conflated'
  Assert-Condition ($fixtureDirections[90] -eq 'POSITIVE_90' -and $fixtureDirections[270] -eq 'NEGATIVE_90') '90 and 270 degree metadata directions are not opposite signed quarter-turns'

  $evidence.status = 'PASS'
  $evidence.rotation_degrees = @(90, 180, 270)
  $evidence.rotation_applied_exactly_once = $true
  $evidence.output_nonidentity_display_matrix = 'ABSENT_OR_IDENTITY_ONLY'
  $evidence.windows_desktop_gate = 'PASS_RUNTIME_LEVEL_ONLY'
  Write-Evidence
  Write-Output ($evidence | ConvertTo-Json -Depth 20)
  exit 0
}
catch {
  $evidence.status = 'FAIL'
  $evidence.first_actual_blocker = $_.Exception.Message
  try { Write-Evidence } catch { }
  Write-Error $_.Exception.Message
  exit 1
}
