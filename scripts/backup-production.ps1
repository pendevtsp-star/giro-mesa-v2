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
  [string]$Artifact,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]{4}_[A-Za-z0-9_.-]+$')]
  [string]$MigrationId,
  [string]$ObjectDirectory,
  [string]$EncryptedConfigArchive,
  [ValidateRange(1, 5)]
  [int]$MaxRpoMinutes = 5
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

function Assert-ImmutableArtifact {
  param([string]$Value)
  if ($Value -notmatch '^(git:)?[0-9a-fA-F]{40}$' -and $Value -notmatch '@sha256:[0-9a-fA-F]{64}$') {
    throw 'BACKUP_ARTIFACT_NOT_IMMUTABLE'
  }
}

function Get-Sha256Hex {
  param([string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $sha.Dispose(); $stream.Dispose() }
}

function Add-BackupFile {
  param([System.Collections.ArrayList]$Files, [string]$Root, [string]$Path, [string]$Kind)
  $item = Get-Item -LiteralPath $Path
  $relative = $item.FullName.Substring($Root.Length).TrimStart('\', '/') -replace '\\', '/'
  [void]$Files.Add([ordered]@{
    path = $relative
    kind = $Kind
    bytes = $item.Length
    sha256 = Get-Sha256Hex -Path $item.FullName
  })
}

Assert-ImmutableArtifact -Value $Artifact
$manifestKey = Get-ManifestKey
$startedAt = [DateTimeOffset]::UtcNow
$backupId = '{0}-{1}' -f $startedAt.ToString('yyyyMMddTHHmmssZ'), ([Guid]::NewGuid().ToString('N'))
$root = [IO.Path]::GetFullPath($OutputDirectory)
$backupDirectory = Join-Path $root $backupId
$containerDump = "/tmp/giromesa-$backupId.dump"

try {
  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  $databaseDump = Join-Path $backupDirectory 'database.dump'
  Invoke-CheckedDocker -Arguments @('exec', $DatabaseContainer, 'pg_dump', '--format=custom', '--compress=6', '--no-owner', '--no-acl', '--username', $DatabaseUser, '--dbname', $DatabaseName, '--file', $containerDump)
  Invoke-CheckedDocker -Arguments @('cp', "${DatabaseContainer}:${containerDump}", $databaseDump)

  if (-not [string]::IsNullOrWhiteSpace($ObjectDirectory)) {
    $resolvedObjects = (Resolve-Path -LiteralPath $ObjectDirectory).Path
    Compress-Archive -Path (Join-Path $resolvedObjects '*') -DestinationPath (Join-Path $backupDirectory 'objects.zip') -CompressionLevel Optimal
  }
  if (-not [string]::IsNullOrWhiteSpace($EncryptedConfigArchive)) {
    $resolvedConfig = (Resolve-Path -LiteralPath $EncryptedConfigArchive).Path
    if ([IO.Path]::GetExtension($resolvedConfig) -notin @('.age', '.gpg', '.enc')) { throw 'CONFIG_ARCHIVE_MUST_BE_ENCRYPTED' }
    Copy-Item -LiteralPath $resolvedConfig -Destination (Join-Path $backupDirectory ("configuration" + [IO.Path]::GetExtension($resolvedConfig)))
  }

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
    schemaVersion = 1; backupId = $backupId; artifact = $Artifact; migrationId = $MigrationId
    sourceDatabaseContainer = $DatabaseContainer; databaseName = $DatabaseName
    createdAt = $startedAt.ToString('o'); completedAt = $finishedAt.ToString('o')
    durationSeconds = [int]$durationSeconds; declaredRpoMinutes = $MaxRpoMinutes; files = @($files)
  }
  $payloadJson = $payload | ConvertTo-Json -Depth 8 -Compress
  $utf8 = [Text.UTF8Encoding]::new($false)
  $payloadBytes = $utf8.GetBytes($payloadJson)
  $hmac = [Security.Cryptography.HMACSHA256]::new($manifestKey)
  try { $signature = ($hmac.ComputeHash($payloadBytes) | ForEach-Object { $_.ToString('x2') }) -join '' } finally { $hmac.Dispose() }
  $manifest = [ordered]@{ schemaVersion = 1; signedPayloadBase64 = [Convert]::ToBase64String($payloadBytes); hmacSha256 = $signature }
  [IO.File]::WriteAllText((Join-Path $backupDirectory 'manifest.json'), ($manifest | ConvertTo-Json -Depth 4), $utf8)
  Write-Output $backupDirectory
} catch {
  if (Test-Path -LiteralPath $backupDirectory) { Remove-Item -LiteralPath $backupDirectory -Recurse -Force }
  throw
} finally {
  try { & docker exec $DatabaseContainer rm -f $containerDump *>$null } catch { }
  [Array]::Clear($manifestKey, 0, $manifestKey.Length)
}
