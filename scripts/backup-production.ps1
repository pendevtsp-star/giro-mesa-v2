[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$')]
  [string]$DatabaseContainer,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z_][A-Za-z0-9_$.-]{0,62}$')]
  [string]$DatabaseName,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z_][A-Za-z0-9_$.-]{0,62}$')]
  [string]$DatabaseUser,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [Parameter(Mandatory = $true)]
  [string]$SourceArtifact,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]{4}_[A-Za-z0-9_.-]+$')]
  [string]$SourceMigrationId,
  [Parameter(Mandatory = $true)]
  [string]$TargetArtifact,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]{4}_[A-Za-z0-9_.-]+$')]
  [string]$TargetMigrationId,
  [string]$ObjectDirectory,
  [string]$EncryptedConfigArchive,
  [string]$RuntimeEnvFile,
  [ValidateRange(1, 5)]
  [int]$MaxRpoMinutes = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression

function Invoke-CheckedDocker {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "DOCKER_COMMAND_FAILED:$($Arguments[0])" }
}

function Get-ManifestKey {
  $encoded = [Environment]::GetEnvironmentVariable('GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64')
  if ([string]::IsNullOrWhiteSpace($encoded)) { throw 'MANIFEST_HMAC_KEY_REQUIRED' }
  try { $key = [Convert]::FromBase64String($encoded) } catch { throw 'MANIFEST_HMAC_KEY_INVALID' }
  if ($key.Length -lt 32) {
    [Array]::Clear($key, 0, $key.Length)
    throw 'MANIFEST_HMAC_KEY_INVALID'
  }
  return $key
}

function Assert-ImmutableArtifact {
  param([string]$Value)
  if ($Value -notmatch '^(git:)?[0-9a-fA-F]{40}$' -and $Value -notmatch '@sha256:[0-9a-fA-F]{64}$') {
    throw 'BACKUP_ARTIFACT_NOT_IMMUTABLE'
  }
}

function Test-IsReparsePoint {
  param([IO.FileSystemInfo]$Item)
  return ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

function Assert-NoReparsePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ErrorCode,
    [switch]$AllowMissing
  )
  $fullPath = [IO.Path]::GetFullPath($Path)
  $probe = $fullPath
  $isFirst = $true
  while (-not [string]::IsNullOrWhiteSpace($probe)) {
    if (Test-Path -LiteralPath $probe) {
      $item = Get-Item -LiteralPath $probe -Force
      if (Test-IsReparsePoint -Item $item) { throw $ErrorCode }
    } elseif ($isFirst -and -not $AllowMissing) {
      throw $ErrorCode
    }
    $parent = [IO.Path]::GetDirectoryName($probe)
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $probe) { break }
    $probe = $parent
    $isFirst = $false
  }
  return $fullPath
}

function Get-Sha256Hex {
  param([string]$Path)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $sha.Dispose(); $stream.Dispose() }
}

function Get-ObjectTreeState {
  param([Parameter(Mandatory = $true)][string]$Root)
  $rootPath = Assert-NoReparsePath -Path $Root -ErrorCode 'BACKUP_OBJECT_REPARSE_POINT_FORBIDDEN'
  $rootItem = Get-Item -LiteralPath $rootPath -Force
  if (-not $rootItem.PSIsContainer) { throw 'BACKUP_OBJECT_DIRECTORY_INVALID' }
  $rootPrefix = $rootItem.FullName.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  $pending = [Collections.Queue]::new()
  $pending.Enqueue($rootItem.FullName)
  $entries = [System.Collections.ArrayList]::new()

  while ($pending.Count -gt 0) {
    $directory = [string]$pending.Dequeue()
    [void](Assert-NoReparsePath -Path $directory -ErrorCode 'BACKUP_OBJECT_REPARSE_POINT_FORBIDDEN')
    foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
      if (Test-IsReparsePoint -Item $item) { throw 'BACKUP_OBJECT_REPARSE_POINT_FORBIDDEN' }
      $relative = $item.FullName.Substring($rootPrefix.Length) -replace '\\', '/'
      if ($item.PSIsContainer) {
        [void]$entries.Add([pscustomobject]@{
          FullName = $item.FullName; RelativePath = "$relative/"; IsDirectory = $true
          Length = 0L; LastWriteTicks = 0L; Sha256 = $null
        })
        $pending.Enqueue($item.FullName)
      } else {
        [void]$entries.Add([pscustomobject]@{
          FullName = $item.FullName; RelativePath = $relative; IsDirectory = $false
          Length = [long]$item.Length; LastWriteTicks = $item.LastWriteTimeUtc.Ticks
          Sha256 = Get-Sha256Hex -Path $item.FullName
        })
      }
    }
  }
  return @($entries | Sort-Object RelativePath)
}

function Convert-ObjectTreeStateToJson {
  param([object[]]$Entries)
  return @($Entries | ForEach-Object {
    [ordered]@{
      path = $_.RelativePath; directory = $_.IsDirectory
      length = $_.Length; lastWriteTicks = $_.LastWriteTicks; sha256 = $_.Sha256
    }
  }) | ConvertTo-Json -Depth 4 -Compress
}

function Write-ObjectArchive {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Entries,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  $archiveStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $archive = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($item in $Entries) {
      if ($item.IsDirectory) {
        [void]$archive.CreateEntry([string]$item.RelativePath)
        continue
      }
      [void](Assert-NoReparsePath -Path $item.FullName -ErrorCode 'BACKUP_OBJECT_REPARSE_POINT_FORBIDDEN')
      $sourceItem = Get-Item -LiteralPath $item.FullName -Force
      if ($sourceItem.PSIsContainer -or $sourceItem.Length -ne $item.Length -or $sourceItem.LastWriteTimeUtc.Ticks -ne $item.LastWriteTicks) {
        throw 'BACKUP_OBJECT_TREE_CHANGED'
      }
      $sourceStream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try {
        $currentItem = Get-Item -LiteralPath $item.FullName -Force
        if ((Test-IsReparsePoint -Item $currentItem) -or $sourceStream.Length -ne $item.Length) {
          throw 'BACKUP_OBJECT_TREE_CHANGED'
        }
        $entry = $archive.CreateEntry([string]$item.RelativePath, [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        try { $sourceStream.CopyTo($entryStream) } finally { $entryStream.Dispose() }
      } finally {
        $sourceStream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
    $archiveStream.Dispose()
  }
}

function Get-SafeConfigState {
  param([Parameter(Mandatory = $true)][string]$Path)
  $fullPath = Assert-NoReparsePath -Path $Path -ErrorCode 'CONFIG_ARCHIVE_REPARSE_POINT_FORBIDDEN'
  $item = Get-Item -LiteralPath $fullPath -Force
  if ($item.PSIsContainer) { throw 'CONFIG_ARCHIVE_INVALID' }
  if ($item.Extension -notin @('.age', '.gpg', '.enc')) { throw 'CONFIG_ARCHIVE_MUST_BE_ENCRYPTED' }
  return [pscustomobject]@{
    FullName = $item.FullName; Extension = $item.Extension; Length = [long]$item.Length
    LastWriteTicks = $item.LastWriteTimeUtc.Ticks; Sha256 = Get-Sha256Hex -Path $item.FullName
  }
}

function Copy-SafeConfigFile {
  param([Parameter(Mandatory = $true)][object]$State, [Parameter(Mandatory = $true)][string]$Destination)
  [void](Assert-NoReparsePath -Path $State.FullName -ErrorCode 'CONFIG_ARCHIVE_REPARSE_POINT_FORBIDDEN')
  $source = [IO.File]::Open($State.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $target = $null
  try {
    $current = Get-Item -LiteralPath $State.FullName -Force
    if ((Test-IsReparsePoint -Item $current) -or $source.Length -ne $State.Length -or $current.LastWriteTimeUtc.Ticks -ne $State.LastWriteTicks) {
      throw 'CONFIG_ARCHIVE_CHANGED'
    }
    $target = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $source.CopyTo($target)
    $target.Flush($true)
  } finally {
    if ($null -ne $target) { $target.Dispose() }
    $source.Dispose()
  }
  $after = Get-SafeConfigState -Path $State.FullName
  if ($after.Length -ne $State.Length -or $after.LastWriteTicks -ne $State.LastWriteTicks -or $after.Sha256 -ne $State.Sha256) {
    throw 'CONFIG_ARCHIVE_CHANGED'
  }
  if ((Get-Sha256Hex -Path $Destination) -ne $State.Sha256) { throw 'CONFIG_ARCHIVE_COPY_HASH_MISMATCH' }
}

function Add-BackupFile {
  param([System.Collections.ArrayList]$Files, [string]$Root, [string]$Path, [string]$Kind)
  $item = Get-Item -LiteralPath $Path -Force
  if (Test-IsReparsePoint -Item $item) { throw 'BACKUP_OUTPUT_REPARSE_POINT_FORBIDDEN' }
  $relative = $item.FullName.Substring($Root.Length).TrimStart('\', '/') -replace '\\', '/'
  [void]$Files.Add([ordered]@{
    path = $relative
    kind = $Kind
    bytes = $item.Length
    sha256 = Get-Sha256Hex -Path $item.FullName
  })
}

Assert-ImmutableArtifact -Value $SourceArtifact
Assert-ImmutableArtifact -Value $TargetArtifact
$manifestKey = Get-ManifestKey
$objectState = $null
$objectStateJson = $null
$configState = $null
$hasObjectInput = -not [string]::IsNullOrWhiteSpace($ObjectDirectory)

if ($hasObjectInput) {
  $objectState = @(Get-ObjectTreeState -Root $ObjectDirectory)
  $objectStateJson = Convert-ObjectTreeStateToJson -Entries $objectState
}
if (-not [string]::IsNullOrWhiteSpace($EncryptedConfigArchive)) { throw 'BACKUP_PREBUILT_CONFIG_FORBIDDEN' }
$runtimeEnvPath = $null
$runtimeEnvState = $null
if (-not [string]::IsNullOrWhiteSpace($RuntimeEnvFile)) {
  $runtimeEnvPath = Assert-NoReparsePath -Path $RuntimeEnvFile -ErrorCode 'BACKUP_RUNTIME_ENV_REPARSE_POINT_FORBIDDEN'
  $runtimeEnvItem = Get-Item -LiteralPath $runtimeEnvPath -Force
  if ($runtimeEnvItem.PSIsContainer -or $runtimeEnvItem.Length -lt 1) { throw 'BACKUP_RUNTIME_ENV_INVALID' }
  $runtimeEnvState = [pscustomobject]@{ Length = [long]$runtimeEnvItem.Length; LastWriteTicks = $runtimeEnvItem.LastWriteTimeUtc.Ticks; Sha256 = Get-Sha256Hex -Path $runtimeEnvPath }
}

function Get-OpenSslExecutable {
  $command = Get-Command openssl -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }
  $bundled = 'C:\Program Files\Git\mingw64\bin\openssl.exe'
  if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
  throw 'BACKUP_TOOL_REQUIRED:openssl'
}

function Protect-RuntimeConfiguration {
  param([string]$Source, [string]$Destination)
  & (Get-OpenSslExecutable) enc -aes-256-cbc -pbkdf2 -md sha256 -salt -in $Source -out $Destination -pass env:GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Destination)) { throw 'BACKUP_CONFIG_ENCRYPTION_FAILED' }
}
try { $decodedConfigKey = [Convert]::FromBase64String([Environment]::GetEnvironmentVariable('GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64')) }
catch { throw 'BACKUP_CONFIG_ENCRYPTION_KEY_INVALID' }
if ($decodedConfigKey.Length -ne 32) { throw 'BACKUP_CONFIG_ENCRYPTION_KEY_INVALID' }
[Array]::Clear($decodedConfigKey, 0, $decodedConfigKey.Length)
if (-not $hasObjectInput -or $null -eq $runtimeEnvState) { throw 'BACKUP_COMPLETE_COVERAGE_REQUIRED' }

$root = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($root) | Out-Null
[void](Assert-NoReparsePath -Path $root -ErrorCode 'BACKUP_OUTPUT_REPARSE_POINT_FORBIDDEN')
$startedAt = [DateTimeOffset]::UtcNow
$backupId = '{0}-{1}' -f $startedAt.ToString('yyyyMMddTHHmmssZ'), ([Guid]::NewGuid().ToString('N'))
$backupDirectory = Join-Path $root $backupId
$containerDump = "/tmp/giromesa-$backupId.dump"
$dockerTouched = $false

try {
  [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
  $databaseDump = Join-Path $backupDirectory 'database.dump'
  $dockerTouched = $true
  Invoke-CheckedDocker -Arguments @('exec', $DatabaseContainer, 'pg_dump', '--format=custom', '--compress=6', '--no-owner', '--no-acl', '--username', $DatabaseUser, '--dbname', $DatabaseName, '--file', $containerDump)
  Invoke-CheckedDocker -Arguments @('cp', "${DatabaseContainer}:${containerDump}", $databaseDump)

  if ($hasObjectInput) {
    $objectState = @(Get-ObjectTreeState -Root $ObjectDirectory)
    if ((Convert-ObjectTreeStateToJson -Entries $objectState) -ne $objectStateJson) { throw 'BACKUP_OBJECT_TREE_CHANGED' }
    $objectArchive = Join-Path $backupDirectory 'objects.zip'
    Write-ObjectArchive -Entries $objectState -Destination $objectArchive
    if ((Convert-ObjectTreeStateToJson -Entries (Get-ObjectTreeState -Root $ObjectDirectory)) -ne $objectStateJson) {
      throw 'BACKUP_OBJECT_TREE_CHANGED'
    }
  }
  Protect-RuntimeConfiguration -Source $runtimeEnvPath -Destination (Join-Path $backupDirectory 'configuration.enc')

  $files = [System.Collections.ArrayList]::new()
  Add-BackupFile -Files $files -Root $backupDirectory -Path $databaseDump -Kind 'postgresql'
  $objectArchive = Join-Path $backupDirectory 'objects.zip'
  if (Test-Path -LiteralPath $objectArchive) { Add-BackupFile -Files $files -Root $backupDirectory -Path $objectArchive -Kind 'objects' }
  Get-ChildItem -LiteralPath $backupDirectory -File -Filter 'configuration.*' | ForEach-Object {
    Add-BackupFile -Files $files -Root $backupDirectory -Path $_.FullName -Kind 'encrypted_configuration'
  }

  $finishedAt = [DateTimeOffset]::UtcNow
  $durationSeconds = [Math]::Ceiling(($finishedAt - $startedAt).TotalSeconds)
  if ($durationSeconds -gt ($MaxRpoMinutes * 60)) { throw 'BACKUP_WINDOW_EXCEEDED' }
  $payload = [ordered]@{
    schemaVersion = 2; backupId = $backupId
    sourceArtifact = $SourceArtifact; sourceMigrationId = $SourceMigrationId
    targetArtifact = $TargetArtifact; targetMigrationId = $TargetMigrationId
    sourceDatabaseContainer = $DatabaseContainer; databaseName = $DatabaseName
    createdAt = $startedAt.ToString('o'); completedAt = $finishedAt.ToString('o')
    durationSeconds = [int]$durationSeconds; declaredRpoMinutes = $MaxRpoMinutes; files = @($files)
    coverage = [ordered]@{ mode = 'embedded'; database = $true; objects = $true; encryptedConfiguration = $true }
  }
  $currentRuntimeEnv = Get-Item -LiteralPath (Assert-NoReparsePath -Path $runtimeEnvPath -ErrorCode 'BACKUP_RUNTIME_ENV_REPARSE_POINT_FORBIDDEN') -Force
  $currentRuntimeSha = Get-Sha256Hex -Path $runtimeEnvPath
  if ($currentRuntimeEnv.Length -ne $runtimeEnvState.Length -or $currentRuntimeEnv.LastWriteTimeUtc.Ticks -ne $runtimeEnvState.LastWriteTicks -or $currentRuntimeSha -ne $runtimeEnvState.Sha256) { throw 'BACKUP_RUNTIME_ENV_CHANGED' }
  $runtimeBytes = [IO.File]::ReadAllBytes($runtimeEnvPath)
  $runtimeHmac = [Security.Cryptography.HMACSHA256]::new($manifestKey)
  try { $payload.runtimeConfigurationHmacSha256 = ($runtimeHmac.ComputeHash($runtimeBytes) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $runtimeHmac.Dispose(); [Array]::Clear($runtimeBytes, 0, $runtimeBytes.Length) }
  $payloadJson = $payload | ConvertTo-Json -Depth 8 -Compress
  $utf8 = [Text.UTF8Encoding]::new($false)
  $payloadBytes = $utf8.GetBytes($payloadJson)
  $hmac = [Security.Cryptography.HMACSHA256]::new($manifestKey)
  try { $signature = ($hmac.ComputeHash($payloadBytes) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $hmac.Dispose() }
  $manifest = [ordered]@{ schemaVersion = 2; signedPayloadBase64 = [Convert]::ToBase64String($payloadBytes); hmacSha256 = $signature }
  [IO.File]::WriteAllText((Join-Path $backupDirectory 'manifest.json'), ($manifest | ConvertTo-Json -Depth 4), $utf8)
  Write-Output $backupDirectory
} catch {
  if (Test-Path -LiteralPath $backupDirectory) {
    $backupItem = Get-Item -LiteralPath $backupDirectory -Force
    if (-not (Test-IsReparsePoint -Item $backupItem)) { Remove-Item -LiteralPath $backupDirectory -Recurse -Force }
  }
  throw
} finally {
  if ($dockerTouched) {
    try { & docker exec $DatabaseContainer rm -f $containerDump *>$null } catch { }
  }
  [Array]::Clear($manifestKey, 0, $manifestKey.Length)
}
