$command = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnet = if ($command) {
  $command.Source
} else {
  Join-Path ([Environment]::GetFolderPath("UserProfile")) ".dotnet\dotnet.exe"
}

if (-not (Test-Path -LiteralPath $dotnet)) {
  throw "dotnet SDK não encontrado. Instale o .NET 10 ou adicione dotnet ao PATH."
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-LfUtf8File {
  param([Parameter(Mandatory = $true)][string]$Path)

  $content = [System.IO.File]::ReadAllText($Path)
  $normalized = $content.Replace("`r`n", "`n").Replace("`r", "`n").TrimEnd("`n") + "`n"
  [System.IO.File]::WriteAllText($Path, $normalized, $utf8NoBom)
}

Write-LfUtf8File -Path "apps/backends/api/openapi/openapi.json"

& $dotnet tool restore
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $dotnet kiota generate `
  --language CSharp `
  --class-name GiroMesaApiClient `
  --namespace-name GiroMesa.ApiClient `
  --openapi apps/backends/api/openapi/openapi.json `
  --output packages/api-client-csharp/Generated `
  --clean-output
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Get-ChildItem -LiteralPath "packages/api-client-csharp/Generated" -Recurse -Filter "*.cs" | ForEach-Object {
  $content = [System.IO.File]::ReadAllText($_.FullName)
  $normalized = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    "[\t ]+(?=\r?$)",
    "",
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )
  [System.IO.File]::WriteAllText($_.FullName, $normalized, $utf8NoBom)
}

Get-ChildItem -LiteralPath "packages/api-client-csharp/Generated" -Recurse -Filter "*.json" | ForEach-Object {
  Write-LfUtf8File -Path $_.FullName
}
