[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$')][string]$TargetDatabaseContainer,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z_][A-Za-z0-9_$.-]{0,62}$')][string]$DatabaseName,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z_][A-Za-z0-9_$.-]{0,62}$')][string]$DatabaseUser,
  [Parameter(Mandatory = $true)][string]$ExpectedSourceArtifact,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]{4}_[A-Za-z0-9_.-]+$')][string]$ExpectedSourceMigrationId,
  [Parameter(Mandatory = $true)][string]$ExpectedTargetArtifact,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]{4}_[A-Za-z0-9_.-]+$')][string]$ExpectedTargetMigrationId,
  [string]$RestoreObjectDirectory,
  [string]$RestoreEncryptedConfigDirectory,
  [string]$SmokeSqlFile,
  [ValidateRange(1, 30)][int]$MaxRtoMinutes = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

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
    throw 'RESTORE_ARTIFACT_NOT_IMMUTABLE'
  }
}

function Convert-HexToBytes {
  param([string]$Hex)
  if ($Hex -notmatch '^[0-9a-fA-F]{64}$') { throw 'MANIFEST_SIGNATURE_INVALID' }
  $bytes = [byte[]]::new($Hex.Length / 2)
  for ($index = 0; $index -lt $bytes.Length; $index++) {
    $bytes[$index] = [Convert]::ToByte($Hex.Substring($index * 2, 2), 16)
  }
  return $bytes
}

function Test-FixedTimeEqual {
  param([byte[]]$Left, [byte[]]$Right)
  if ($Left.Length -ne $Right.Length) { return $false }
  $difference = 0
  for ($index = 0; $index -lt $Left.Length; $index++) {
    $difference = $difference -bor ($Left[$index] -bxor $Right[$index])
  }
  return $difference -eq 0
}

function Test-IsReparsePoint {
  param([IO.FileSystemInfo]$Item)
  return ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

function Assert-NoReparsePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$AllowMissing
  )
  $fullPath = [IO.Path]::GetFullPath($Path)
  $probe = $fullPath
  $isFirst = $true
  while (-not [string]::IsNullOrWhiteSpace($probe)) {
    $item = Get-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    if ($null -ne $item) {
      if (Test-IsReparsePoint -Item $item) { throw 'RESTORE_REPARSE_POINT_FORBIDDEN' }
    } elseif ($isFirst -and -not $AllowMissing) {
      throw 'RESTORE_PATH_INVALID'
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

function Get-OpenSslExecutable {
  $command = Get-Command openssl -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }
  $bundled = 'C:\Program Files\Git\mingw64\bin\openssl.exe'
  if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
  throw 'RESTORE_TOOL_REQUIRED:openssl'
}

function Read-SafeUtf8Text {
  param([Parameter(Mandatory = $true)][string]$Path)
  [void](Assert-NoReparsePath -Path $Path)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $item = Get-Item -LiteralPath $Path -Force
    if ((Test-IsReparsePoint -Item $item) -or $item.PSIsContainer) { throw 'RESTORE_REPARSE_POINT_FORBIDDEN' }
    $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false), $true, 1024, $true)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $stream.Dispose()
  }
}

function Copy-VerifiedFileToStage {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][long]$ExpectedBytes,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )
  [void](Assert-NoReparsePath -Path $Source)
  $sourceItem = Get-Item -LiteralPath $Source -Force
  if ($sourceItem.PSIsContainer -or $sourceItem.Length -ne $ExpectedBytes) { throw 'BACKUP_FILE_HASH_MISMATCH' }
  $sourceStream = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $targetStream = $null
  try {
    $currentItem = Get-Item -LiteralPath $Source -Force
    if ((Test-IsReparsePoint -Item $currentItem) -or $sourceStream.Length -ne $ExpectedBytes) {
      throw 'RESTORE_REPARSE_POINT_FORBIDDEN'
    }
    $targetStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $sourceStream.CopyTo($targetStream)
    $targetStream.Flush($true)
  } finally {
    if ($null -ne $targetStream) { $targetStream.Dispose() }
    $sourceStream.Dispose()
  }
  [void](Assert-NoReparsePath -Path $Source)
  if ((Get-Sha256Hex -Path $Destination) -ne $ExpectedSha256) { throw 'BACKUP_FILE_HASH_MISMATCH' }
}

function Get-ZipExternalAttributes {
  param([IO.Compression.ZipArchiveEntry]$Entry)
  return [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$Entry.ExternalAttributes), 0)
}

function Test-ZipEntryIsDirectory {
  param([IO.Compression.ZipArchiveEntry]$Entry)
  $attributes = Get-ZipExternalAttributes -Entry $Entry
  $unixType = ($attributes -shr 16) -band 0xF000
  return $Entry.FullName.EndsWith('/') -or $unixType -eq 0x4000
}

function Assert-SafeZipEntry {
  param([IO.Compression.ZipArchiveEntry]$Entry, [Collections.Generic.HashSet[string]]$Seen)
  $name = ([string]$Entry.FullName).Replace('\', '/')
  if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or $name.StartsWith('//') -or $name -match '^[A-Za-z]:') {
    throw 'BACKUP_OBJECT_PATH_INVALID'
  }
  $segments = @($name.Split('/') | Where-Object { $_ -ne '' })
  if ($segments.Count -eq 0) { throw 'BACKUP_OBJECT_PATH_INVALID' }
  foreach ($segment in $segments) {
    if ($segment -in @('.', '..') -or $segment.Contains(':') -or $segment.Contains([char]0)) {
      throw 'BACKUP_OBJECT_PATH_INVALID'
    }
  }
  $normalized = $segments -join '/'
  if (-not $Seen.Add($normalized)) { throw 'BACKUP_OBJECT_PATH_INVALID' }

  $attributes = Get-ZipExternalAttributes -Entry $Entry
  $unixType = ($attributes -shr 16) -band 0xF000
  $dosAttributes = $attributes -band 0xFFFF
  if ($unixType -eq 0xA000 -or ($dosAttributes -band [uint32][IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'BACKUP_OBJECT_LINK_FORBIDDEN'
  }
  if ($unixType -notin @(0, 0x4000, 0x8000)) { throw 'BACKUP_OBJECT_LINK_FORBIDDEN' }
}

function Expand-ValidatedObjectArchive {
  param([Parameter(Mandatory = $true)][string]$ArchivePath, [Parameter(Mandatory = $true)][string]$Destination)
  try { $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath) } catch { throw 'BACKUP_OBJECT_ARCHIVE_INVALID' }
  try {
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) { Assert-SafeZipEntry -Entry $entry -Seen $seen }

    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    $destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
    foreach ($entry in $archive.Entries) {
      $segments = @(([string]$entry.FullName).Replace('\', '/').Split('/') | Where-Object { $_ -ne '' })
      $relative = $segments -join [IO.Path]::DirectorySeparatorChar
      $target = [IO.Path]::GetFullPath((Join-Path $destinationRoot $relative))
      if (-not $target.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'BACKUP_OBJECT_PATH_INVALID'
      }
      if (Test-ZipEntryIsDirectory -Entry $entry) {
        [IO.Directory]::CreateDirectory($target) | Out-Null
        continue
      }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      $input = $entry.Open()
      $output = $null
      try {
        $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $input.CopyTo($output)
        $output.Flush($true)
      } finally {
        if ($null -ne $output) { $output.Dispose() }
        $input.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
}

function Assert-SafeRestoreDirectory {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$NotEmptyError)
  $fullPath = Assert-NoReparsePath -Path $Path -AllowMissing
  $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction SilentlyContinue
  if ($null -ne $item) {
    if (-not $item.PSIsContainer) { throw 'RESTORE_PATH_INVALID' }
    if (@(Get-ChildItem -LiteralPath $fullPath -Force).Count -gt 0) { throw $NotEmptyError }
  }
  return $fullPath
}

function Copy-StagedObjectTree {
  param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Destination)
  [IO.Directory]::CreateDirectory($Destination) | Out-Null
  [void](Assert-NoReparsePath -Path $Destination)
  $sourceRoot = [IO.Path]::GetFullPath($Source).TrimEnd('\', '/')
  foreach ($item in @(Get-ChildItem -LiteralPath $Source -Recurse -Force | Sort-Object FullName)) {
    if (Test-IsReparsePoint -Item $item) { throw 'RESTORE_REPARSE_POINT_FORBIDDEN' }
    $relative = $item.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
    $target = Join-Path $Destination $relative
    [void](Assert-NoReparsePath -Path ([IO.Path]::GetDirectoryName($target)) -AllowMissing)
    if ($item.PSIsContainer) {
      [IO.Directory]::CreateDirectory($target) | Out-Null
    } else {
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      $input = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $output = $null
      try {
        $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $input.CopyTo($output)
        $output.Flush($true)
      } finally {
        if ($null -ne $output) { $output.Dispose() }
        $input.Dispose()
      }
    }
  }
}

function Copy-StagedConfig {
  param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$DestinationDirectory)
  [IO.Directory]::CreateDirectory($DestinationDirectory) | Out-Null
  [void](Assert-NoReparsePath -Path $DestinationDirectory)
  $destination = Join-Path $DestinationDirectory ([IO.Path]::GetFileName($Source))
  $input = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $output = $null
  try {
    $output = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $input.CopyTo($output)
    $output.Flush($true)
  } finally {
    if ($null -ne $output) { $output.Dispose() }
    $input.Dispose()
  }
  if ((Get-Sha256Hex -Path $destination) -ne (Get-Sha256Hex -Path $Source)) { throw 'RESTORE_CONFIG_COPY_HASH_MISMATCH' }
}

function Assert-EvidencePathAvailable {
  param([Parameter(Mandatory = $true)][string]$Path)
  [void](Assert-NoReparsePath -Path ([IO.Path]::GetDirectoryName($Path)))
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -ne $item) {
    if (Test-IsReparsePoint -Item $item) { throw 'RESTORE_EVIDENCE_PATH_INVALID' }
    throw 'RESTORE_EVIDENCE_ALREADY_EXISTS'
  }
}

function Write-AtomicEvidence {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Json)
  Assert-EvidencePathAvailable -Path $Path
  $directory = [IO.Path]::GetDirectoryName($Path)
  $temporary = Join-Path $directory ('.restore-evidence-{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
  $stream = $null
  try {
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false), 1024, $true)
    try {
      $writer.Write($Json)
      $writer.Flush()
      $stream.Flush($true)
    } finally {
      $writer.Dispose()
    }
    $stream.Dispose()
    $stream = $null
    [void](Assert-NoReparsePath -Path $directory)
    Assert-EvidencePathAvailable -Path $Path
    try { [IO.File]::Move($temporary, $Path) } catch {
      $existing = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
      if ($null -ne $existing) {
        if (Test-IsReparsePoint -Item $existing) { throw 'RESTORE_EVIDENCE_PATH_INVALID' }
        throw 'RESTORE_EVIDENCE_ALREADY_EXISTS'
      }
      throw
    }
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    $temporaryItem = Get-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    if ($null -ne $temporaryItem -and -not (Test-IsReparsePoint -Item $temporaryItem)) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

Assert-ImmutableArtifact -Value $ExpectedSourceArtifact
Assert-ImmutableArtifact -Value $ExpectedTargetArtifact
$startedAt = [DateTimeOffset]::UtcNow
$manifestKey = $null
$stage = $null
$dockerTouched = $false
$containerDump = "/tmp/giromesa-restore-$([Guid]::NewGuid().ToString('N')).dump"
$containerSmoke = "/tmp/giromesa-smoke-$([Guid]::NewGuid().ToString('N')).sql"

try {
  $root = Assert-NoReparsePath -Path $BackupDirectory
  $rootItem = Get-Item -LiteralPath $root -Force
  if (-not $rootItem.PSIsContainer) { throw 'BACKUP_MANIFEST_MISSING' }
  $manifestPath = Join-Path $root 'manifest.json'
  $manifestItem = Get-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
  if ($null -eq $manifestItem -or $manifestItem.PSIsContainer) { throw 'BACKUP_MANIFEST_MISSING' }
  [void](Assert-NoReparsePath -Path $manifestPath)
  $manifestKey = Get-ManifestKey

  try {
    $manifest = Read-SafeUtf8Text -Path $manifestPath | ConvertFrom-Json
    $payloadBytes = [Convert]::FromBase64String([string]$manifest.signedPayloadBase64)
    $declaredSignature = [string]$manifest.hmacSha256
  } catch {
    if ($_.Exception.Message -eq 'RESTORE_REPARSE_POINT_FORBIDDEN') { throw }
    throw 'MANIFEST_SIGNATURE_INVALID'
  }
  $hmac = [Security.Cryptography.HMACSHA256]::new($manifestKey)
  try { $computedBytes = $hmac.ComputeHash($payloadBytes) } finally { $hmac.Dispose() }
  $declaredBytes = Convert-HexToBytes -Hex $declaredSignature
  if (-not (Test-FixedTimeEqual -Left $computedBytes -Right $declaredBytes)) { throw 'MANIFEST_SIGNATURE_INVALID' }

  try { $payload = ([Text.UTF8Encoding]::new($false)).GetString($payloadBytes) | ConvertFrom-Json } catch { throw 'MANIFEST_PAYLOAD_INVALID' }
  if ([int]$manifest.schemaVersion -ne 2 -or [int]$payload.schemaVersion -ne 2) { throw 'BACKUP_SCHEMA_UNSUPPORTED' }
  if ([string]$payload.coverage.mode -ne 'embedded' -or -not [bool]$payload.coverage.database -or -not [bool]$payload.coverage.objects -or -not [bool]$payload.coverage.encryptedConfiguration) { throw 'BACKUP_COMPLETE_COVERAGE_REQUIRED' }
  if ([string]$payload.runtimeConfigurationHmacSha256 -notmatch '^[0-9a-f]{64}$') { throw 'BACKUP_RUNTIME_CONFIGURATION_BINDING_INVALID' }
  if ([string]$payload.sourceArtifact -ne $ExpectedSourceArtifact) { throw 'BACKUP_SOURCE_ARTIFACT_MISMATCH' }
  if ([string]$payload.sourceMigrationId -ne $ExpectedSourceMigrationId) { throw 'BACKUP_SOURCE_MIGRATION_MISMATCH' }
  if ([string]$payload.targetArtifact -ne $ExpectedTargetArtifact) { throw 'BACKUP_TARGET_ARTIFACT_MISMATCH' }
  if ([string]$payload.targetMigrationId -ne $ExpectedTargetMigrationId) { throw 'BACKUP_TARGET_MIGRATION_MISMATCH' }
  if ([int]$payload.declaredRpoMinutes -lt 1 -or [int]$payload.declaredRpoMinutes -gt 5) { throw 'BACKUP_RPO_INVALID' }
  if ([string]::IsNullOrWhiteSpace([string]$payload.sourceDatabaseContainer)) { throw 'BACKUP_SOURCE_INVALID' }
  if ([string]$payload.sourceDatabaseContainer -eq $TargetDatabaseContainer) { throw 'RESTORE_TARGET_MUST_DIFFER_FROM_SOURCE' }

  $evidencePath = Join-Path $root 'restore-evidence.json'
  Assert-EvidencePathAvailable -Path $evidencePath
  $stage = Join-Path ([IO.Path]::GetTempPath()) ("giromesa-restore-$([Guid]::NewGuid().ToString('N'))")
  [IO.Directory]::CreateDirectory($stage) | Out-Null
  [void](Assert-NoReparsePath -Path $stage)

  $allowed = @{
    'database.dump' = 'postgresql'; 'objects.zip' = 'objects'
    'configuration.age' = 'encrypted_configuration'; 'configuration.gpg' = 'encrypted_configuration'
    'configuration.enc' = 'encrypted_configuration'
  }
  $seenPaths = @{}
  $databaseFileCount = 0
  foreach ($file in @($payload.files)) {
    $relativePath = [string]$file.path
    if (-not $allowed.ContainsKey($relativePath) -or [string]$file.kind -ne $allowed[$relativePath]) { throw 'BACKUP_FILE_PATH_INVALID' }
    if ($seenPaths.ContainsKey($relativePath)) { throw 'BACKUP_FILE_DUPLICATED' }
    $seenPaths[$relativePath] = $true
    if ($relativePath -eq 'database.dump') { $databaseFileCount++ }
    if ([string]$file.sha256 -notmatch '^[0-9a-f]{64}$' -or [long]$file.bytes -lt 1) { throw 'BACKUP_FILE_METADATA_INVALID' }
    $candidate = [IO.Path]::GetFullPath((Join-Path $root $relativePath))
    if (-not $candidate.StartsWith($root.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'BACKUP_FILE_PATH_INVALID'
    }
    $stagedFile = Join-Path $stage $relativePath
    Copy-VerifiedFileToStage -Source $candidate -Destination $stagedFile -ExpectedBytes ([long]$file.bytes) -ExpectedSha256 ([string]$file.sha256)
  }
  if ($databaseFileCount -ne 1) { throw 'BACKUP_DATABASE_FILE_INVALID' }

  $objects = Join-Path $stage 'objects.zip'
  $stagedObjects = Join-Path $stage 'objects'
  $hasObjects = Test-Path -LiteralPath $objects
  if ($hasObjects) {
    if ([string]::IsNullOrWhiteSpace($RestoreObjectDirectory)) { throw 'RESTORE_OBJECT_DIRECTORY_REQUIRED' }
    $restoreObjectPath = Assert-SafeRestoreDirectory -Path $RestoreObjectDirectory -NotEmptyError 'RESTORE_OBJECT_TARGET_NOT_EMPTY'
    Expand-ValidatedObjectArchive -ArchivePath $objects -Destination $stagedObjects
  }

  $encryptedConfig = Get-ChildItem -LiteralPath $stage -File -Filter 'configuration.*' | Select-Object -First 1
  if ($null -ne $encryptedConfig) {
    if ($encryptedConfig.Extension -notin @('.age', '.gpg', '.enc')) { throw 'BACKUP_CONFIG_NOT_ENCRYPTED' }
    if ([string]::IsNullOrWhiteSpace($RestoreEncryptedConfigDirectory)) { throw 'RESTORE_CONFIG_DIRECTORY_REQUIRED' }
    $restoreConfigPath = Assert-SafeRestoreDirectory -Path $RestoreEncryptedConfigDirectory -NotEmptyError 'RESTORE_CONFIG_TARGET_NOT_EMPTY'
  }
  if ($null -eq $encryptedConfig -or $encryptedConfig.Name -ne 'configuration.enc') { throw 'BACKUP_CONFIG_FORMAT_UNSUPPORTED' }
  try { $configKey = [Convert]::FromBase64String([Environment]::GetEnvironmentVariable('GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64')) }
  catch { throw 'BACKUP_CONFIG_ENCRYPTION_KEY_INVALID' }
  if ($configKey.Length -ne 32) { throw 'BACKUP_CONFIG_ENCRYPTION_KEY_INVALID' }
  [Array]::Clear($configKey, 0, $configKey.Length)
  $restoredRuntimeEnv = Join-Path $stage 'runtime.env.restored'
  & (Get-OpenSslExecutable) enc -d -aes-256-cbc -pbkdf2 -md sha256 -in $encryptedConfig.FullName -out $restoredRuntimeEnv -pass env:GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64
  if ($LASTEXITCODE -ne 0) { throw 'BACKUP_CONFIG_DECRYPTION_FAILED' }
  $runtimeBytes = [IO.File]::ReadAllBytes($restoredRuntimeEnv)
  $runtimeHmac = [Security.Cryptography.HMACSHA256]::new($manifestKey)
  try { $runtimeDigest = ($runtimeHmac.ComputeHash($runtimeBytes) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $runtimeHmac.Dispose(); [Array]::Clear($runtimeBytes, 0, $runtimeBytes.Length) }
  if ($runtimeDigest -ne [string]$payload.runtimeConfigurationHmacSha256) { throw 'BACKUP_RUNTIME_CONFIGURATION_MISMATCH' }
  $seenEnvKeys = @{}
  foreach ($line in [IO.File]::ReadAllLines($restoredRuntimeEnv)) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$' -or $seenEnvKeys.ContainsKey($Matches[1])) { throw 'BACKUP_RUNTIME_CONFIGURATION_INVALID' }
    $seenEnvKeys[$Matches[1]] = $true
  }

  $stagedSmokeSql = $null
  $smokeSqlSha256 = $null
  if (-not [string]::IsNullOrWhiteSpace($SmokeSqlFile)) {
    $resolvedSmokeSql = Assert-NoReparsePath -Path $SmokeSqlFile
    $smokeItem = Get-Item -LiteralPath $resolvedSmokeSql -Force
    if ($smokeItem.PSIsContainer -or $smokeItem.Extension -ne '.sql' -or $smokeItem.Length -lt 1 -or $smokeItem.Length -gt 65536) {
      throw 'RESTORE_SMOKE_SQL_INVALID'
    }
    $smokeSqlSha256 = Get-Sha256Hex -Path $resolvedSmokeSql
    $stagedSmokeSql = Join-Path $stage 'smoke.sql'
    Copy-VerifiedFileToStage -Source $resolvedSmokeSql -Destination $stagedSmokeSql -ExpectedBytes $smokeItem.Length -ExpectedSha256 $smokeSqlSha256
  }

  $databaseDump = Join-Path $stage 'database.dump'
  $dockerTouched = $true
  Invoke-CheckedDocker -Arguments @('cp', $databaseDump, "${TargetDatabaseContainer}:${containerDump}")
  Invoke-CheckedDocker -Arguments @('exec', $TargetDatabaseContainer, 'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--username', $DatabaseUser, '--dbname', $DatabaseName, $containerDump)
  Invoke-CheckedDocker -Arguments @('exec', $TargetDatabaseContainer, 'psql', '--username', $DatabaseUser, '--dbname', $DatabaseName, '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--command', 'SELECT 1')

  if ($hasObjects) {
    [void](Assert-SafeRestoreDirectory -Path $restoreObjectPath -NotEmptyError 'RESTORE_OBJECT_TARGET_NOT_EMPTY')
    Copy-StagedObjectTree -Source $stagedObjects -Destination $restoreObjectPath
  }
  if ($null -ne $encryptedConfig) {
    [void](Assert-SafeRestoreDirectory -Path $restoreConfigPath -NotEmptyError 'RESTORE_CONFIG_TARGET_NOT_EMPTY')
    Copy-StagedConfig -Source $restoredRuntimeEnv -DestinationDirectory $restoreConfigPath
  }
  if ($null -ne $stagedSmokeSql) {
    Invoke-CheckedDocker -Arguments @('cp', $stagedSmokeSql, "${TargetDatabaseContainer}:${containerSmoke}")
    Invoke-CheckedDocker -Arguments @('exec', $TargetDatabaseContainer, 'psql', '--username', $DatabaseUser, '--dbname', $DatabaseName, '--set', 'ON_ERROR_STOP=1', '--file', $containerSmoke)
  }

  $finishedAt = [DateTimeOffset]::UtcNow
  $durationSeconds = [Math]::Ceiling(($finishedAt - $startedAt).TotalSeconds)
  if ($durationSeconds -gt ($MaxRtoMinutes * 60)) { throw 'RESTORE_RTO_EXCEEDED' }
  $evidence = [ordered]@{
    schemaVersion = 2; backupId = [string]$payload.backupId
    sourceArtifact = [string]$payload.sourceArtifact; sourceMigrationId = [string]$payload.sourceMigrationId
    targetArtifact = [string]$payload.targetArtifact; targetMigrationId = [string]$payload.targetMigrationId
    sourceDatabaseContainer = [string]$payload.sourceDatabaseContainer; targetDatabaseContainer = $TargetDatabaseContainer
    restoredAt = $finishedAt.ToString('o'); durationSeconds = [int]$durationSeconds
    declaredRtoMinutes = $MaxRtoMinutes; smoke = 'passed'; smokeSqlSha256 = $smokeSqlSha256
    objectsRestored = $hasObjects; encryptedConfigurationRestored = ($null -ne $encryptedConfig)
  }
  $evidenceJson = $evidence | ConvertTo-Json -Depth 4
  Write-AtomicEvidence -Path $evidencePath -Json $evidenceJson
  Write-Output $evidencePath
} finally {
  if ($dockerTouched) {
    try { & docker exec $TargetDatabaseContainer rm -f $containerDump $containerSmoke *>$null } catch { }
  }
  if ($null -ne $stage) {
    $stageItem = Get-Item -LiteralPath $stage -Force -ErrorAction SilentlyContinue
    if ($null -ne $stageItem -and -not (Test-IsReparsePoint -Item $stageItem)) { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
  if ($null -ne $manifestKey) { [Array]::Clear($manifestKey, 0, $manifestKey.Length) }
}
