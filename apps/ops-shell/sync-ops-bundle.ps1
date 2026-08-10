param(
  [string]$RepositoryRoot = (Resolve-Path "$PSScriptRoot\..\..")
)

$source = Join-Path $RepositoryRoot "apps\ops\dist"
$target = Join-Path $PSScriptRoot "Resources\Raw\wwwroot"

if (-not (Test-Path -LiteralPath $source)) {
  throw "Build apps/ops before synchronizing the native bundle."
}

Get-ChildItem -LiteralPath $target -Force | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
Write-Host "GiroMesa Ops bundle synchronized to $target"
