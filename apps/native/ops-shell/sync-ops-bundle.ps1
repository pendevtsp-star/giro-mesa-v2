param(
  [string]$RepositoryRoot = (Resolve-Path "$PSScriptRoot\..\..\.."),
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$RepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$source = Join-Path $RepositoryRoot "apps\frontends\ops\dist"
$target = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "Resources\Raw\wwwroot")).Path
$expectedTarget = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot "apps\native\ops-shell\Resources\Raw\wwwroot"))

if (-not [string]::Equals($target, $expectedTarget, [System.StringComparison]::OrdinalIgnoreCase) -or
    ((Get-Item -LiteralPath $target).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  throw "The native bundle target must be the wwwroot directory inside this repository."
}
if (-not (Test-Path -LiteralPath (Join-Path $source "index.html") -PathType Leaf)) {
  throw "Build apps/frontends/ops before synchronizing the native bundle."
}
$scripts = (Get-ChildItem -LiteralPath (Join-Path $source "assets") -Filter "*.js" |
  ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n"
if ($scripts.Contains("http://localhost:3200") -or -not $scripts.Contains("https://api.giromesa.com.br")) {
  throw "Build Ops with VITE_API_URL=https://api.giromesa.com.br before synchronizing the distribution bundle."
}
if ($ValidateOnly) {
  Write-Output "Validated native bundle paths: $source -> $target"
  return
}

Get-ChildItem -LiteralPath $target -Force | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
Write-Host "GiroMesa Ops bundle synchronized to $target"
