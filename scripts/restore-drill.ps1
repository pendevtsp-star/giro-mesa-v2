[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$')][string]$TargetDatabaseContainer,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z_][A-Za-z0-9_$.-]{0,62}$')][string]$DatabaseName,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z_][A-Za-z0-9_$.-]{0,62}$')][string]$DatabaseUser,
  [Parameter(Mandatory = $true)][string]$ExpectedArtifact,
  [string]$RestoreObjectDirectory,
  [string]$RestoreEncryptedConfigDirectory,
  [string]$SmokeSqlFile,
  [ValidateRange(1, 30)][int]$MaxRtoMinutes = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Get-Sha256Hex {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $sha.Dispose(); $stream.Dispose() }
}

$startedAt = [DateTimeOffset]::UtcNow
$root = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifestPath = Join-Path $root 'manifest.json'
$manifestKey = Get-ManifestKey
$containerDump = "/tmp/giromesa-restore-$([Guid]::NewGuid().ToString('N')).dump"
$containerSmoke = "/tmp/giromesa-smoke-$([Guid]::NewGuid().ToString('N')).sql"

try {
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'BACKUP_MANIFEST_MISSING' }
  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $payloadBytes = [Convert]::FromBase64String([string]$manifest.signedPayloadBase64)
    $declaredSignature = [string]$manifest.hmacSha256
  } catch { throw 'MANIFEST_SIGNATURE_INVALID' }
  $hmac = [Security.Cryptography.HMACSHA256]::new($manifestKey)
  try { $computedBytes = $hmac.ComputeHash($payloadBytes) } finally { $hmac.Dispose() }
  $declaredBytes = Convert-HexToBytes -Hex $declaredSignature
  if (-not (Test-FixedTimeEqual -Left $computedBytes -Right $declaredBytes)) { throw 'MANIFEST_SIGNATURE_INVALID' }

  $payload = ([Text.UTF8Encoding]::new($false)).GetString($payloadBytes) | ConvertFrom-Json
  if ([int]$manifest.schemaVersion -ne 1 -or [int]$payload.schemaVersion -ne 1) { throw 'BACKUP_SCHEMA_UNSUPPORTED' }
  if ([string]$payload.artifact -ne $ExpectedArtifact) { throw 'BACKUP_ARTIFACT_MISMATCH' }
  if ([int]$payload.declaredRpoMinutes -lt 1 -or [int]$payload.declaredRpoMinutes -gt 5) { throw 'BACKUP_RPO_INVALID' }
  if ([string]::IsNullOrWhiteSpace([string]$payload.sourceDatabaseContainer)) { throw 'BACKUP_SOURCE_INVALID' }
  if ([string]$payload.sourceDatabaseContainer -eq $TargetDatabaseContainer) { throw 'RESTORE_TARGET_MUST_DIFFER_FROM_SOURCE' }

  $seenPaths = @{}
  $databaseFileCount = 0
  foreach ($file in @($payload.files)) {
    $relativePath = [string]$file.path
    if ($seenPaths.ContainsKey($relativePath)) { throw 'BACKUP_FILE_DUPLICATED' }
    $seenPaths[$relativePath] = $true
    if ($relativePath -eq 'database.dump' -and [string]$file.kind -eq 'postgresql') { $databaseFileCount++ }
    if ([string]$file.sha256 -notmatch '^[0-9a-f]{64}$' -or [long]$file.bytes -lt 1) { throw 'BACKUP_FILE_METADATA_INVALID' }
    $candidate = [IO.Path]::GetFullPath((Join-Path $root ([string]$file.path)))
    if (-not $candidate.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'BACKUP_FILE_PATH_INVALID' }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'BACKUP_FILE_MISSING' }
    $actual = Get-Sha256Hex -Path $candidate
    if ($actual -ne [string]$file.sha256) { throw 'BACKUP_FILE_HASH_MISMATCH' }
  }
  if ($databaseFileCount -ne 1) { throw 'BACKUP_DATABASE_FILE_INVALID' }

  $objects = Join-Path $root 'objects.zip'
  if (Test-Path -LiteralPath $objects) {
    if (-not $seenPaths.ContainsKey('objects.zip')) { throw 'BACKUP_OBJECT_FILE_UNSIGNED' }
    if ([string]::IsNullOrWhiteSpace($RestoreObjectDirectory)) { throw 'RESTORE_OBJECT_DIRECTORY_REQUIRED' }
    if ((Test-Path -LiteralPath $RestoreObjectDirectory) -and @(Get-ChildItem -LiteralPath $RestoreObjectDirectory -Force).Count -gt 0) {
      throw 'RESTORE_OBJECT_TARGET_NOT_EMPTY'
    }
  }
  $encryptedConfig = Get-ChildItem -LiteralPath $root -File -Filter 'configuration.*' | Select-Object -First 1
  if ($null -ne $encryptedConfig) {
    if (-not $seenPaths.ContainsKey($encryptedConfig.Name)) { throw 'BACKUP_CONFIG_FILE_UNSIGNED' }
    if ($encryptedConfig.Extension -notin @('.age', '.gpg', '.enc')) { throw 'BACKUP_CONFIG_NOT_ENCRYPTED' }
    if ([string]::IsNullOrWhiteSpace($RestoreEncryptedConfigDirectory)) { throw 'RESTORE_CONFIG_DIRECTORY_REQUIRED' }
    if ((Test-Path -LiteralPath $RestoreEncryptedConfigDirectory) -and @(Get-ChildItem -LiteralPath $RestoreEncryptedConfigDirectory -Force).Count -gt 0) {
      throw 'RESTORE_CONFIG_TARGET_NOT_EMPTY'
    }
  }

  $resolvedSmokeSql = $null
  $smokeSqlSha256 = $null
  if (-not [string]::IsNullOrWhiteSpace($SmokeSqlFile)) {
    $resolvedSmokeSql = (Resolve-Path -LiteralPath $SmokeSqlFile).Path
    $smokeItem = Get-Item -LiteralPath $resolvedSmokeSql
    if ($smokeItem.Extension -ne '.sql' -or $smokeItem.Length -lt 1 -or $smokeItem.Length -gt 65536) {
      throw 'RESTORE_SMOKE_SQL_INVALID'
    }
    $smokeSqlSha256 = Get-Sha256Hex -Path $resolvedSmokeSql
  }

  $databaseDump = Join-Path $root 'database.dump'
  Invoke-CheckedDocker -Arguments @('cp', $databaseDump, "${TargetDatabaseContainer}:${containerDump}")
  Invoke-CheckedDocker -Arguments @('exec', $TargetDatabaseContainer, 'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--username', $DatabaseUser, '--dbname', $DatabaseName, $containerDump)
  Invoke-CheckedDocker -Arguments @('exec', $TargetDatabaseContainer, 'psql', '--username', $DatabaseUser, '--dbname', $DatabaseName, '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--command', 'SELECT 1')

  if (Test-Path -LiteralPath $objects) {
    New-Item -ItemType Directory -Path $RestoreObjectDirectory -Force | Out-Null
    Expand-Archive -LiteralPath $objects -DestinationPath $RestoreObjectDirectory -Force
  }
  if ($null -ne $encryptedConfig) {
    New-Item -ItemType Directory -Path $RestoreEncryptedConfigDirectory -Force | Out-Null
    $restoredConfigPath = Join-Path $RestoreEncryptedConfigDirectory $encryptedConfig.Name
    Copy-Item -LiteralPath $encryptedConfig.FullName -Destination $restoredConfigPath
    if ((Get-Sha256Hex -Path $restoredConfigPath) -ne (Get-Sha256Hex -Path $encryptedConfig.FullName)) {
      throw 'RESTORE_CONFIG_COPY_HASH_MISMATCH'
    }
  }
  if ($null -ne $resolvedSmokeSql) {
    Invoke-CheckedDocker -Arguments @('cp', $resolvedSmokeSql, "${TargetDatabaseContainer}:${containerSmoke}")
    Invoke-CheckedDocker -Arguments @('exec', $TargetDatabaseContainer, 'psql', '--username', $DatabaseUser, '--dbname', $DatabaseName, '--set', 'ON_ERROR_STOP=1', '--file', $containerSmoke)
  }

  $finishedAt = [DateTimeOffset]::UtcNow
  $durationSeconds = [Math]::Ceiling(($finishedAt - $startedAt).TotalSeconds)
  if ($durationSeconds -gt ($MaxRtoMinutes * 60)) { throw 'RESTORE_RTO_EXCEEDED' }
  $evidence = [ordered]@{
    schemaVersion = 1; backupId = [string]$payload.backupId; artifact = [string]$payload.artifact
    migrationId = [string]$payload.migrationId; targetDatabaseContainer = $TargetDatabaseContainer
    restoredAt = $finishedAt.ToString('o'); durationSeconds = [int]$durationSeconds
    declaredRtoMinutes = $MaxRtoMinutes; smoke = 'passed'; smokeSqlSha256 = $smokeSqlSha256
    objectsRestored = (Test-Path -LiteralPath $objects); encryptedConfigurationRestored = ($null -ne $encryptedConfig)
  }
  $evidencePath = Join-Path $root 'restore-evidence.json'
  [IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  Write-Output $evidencePath
} finally {
  try { & docker exec $TargetDatabaseContainer rm -f $containerDump $containerSmoke *>$null } catch { }
  [Array]::Clear($manifestKey, 0, $manifestKey.Length)
}
