param(
    [string]$ApiBaseUrl = "https://api.giromesa.com.br"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$apiUri = $null
if (-not [Uri]::TryCreate($ApiBaseUrl, [UriKind]::Absolute, [ref]$apiUri) -or
    ($apiUri.Scheme -ne "https" -and -not $apiUri.IsLoopback)) {
    throw "Use uma URL HTTPS ou um endereço local para a API."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$edgeProject = Join-Path $repositoryRoot "apps/backends/edge-hub/GiroMesa.EdgeHub.csproj"
$installerProject = Join-Path $repositoryRoot "apps/backends/edge-hub-installer/GiroMesa.EdgeHub.Installer.csproj"
$outputDirectory = Join-Path $repositoryRoot "apps/backends/edge-hub-installer/bin/local-test"
$finalInstaller = Join-Path $outputDirectory "GiroMesa-Conector-Setup-TESTE-LOCAL.exe"
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("giromesa-edge-hub-" + [Guid]::NewGuid().ToString("N"))
$payloadDirectory = Join-Path $temporaryDirectory "payload"
$installerDirectory = Join-Path $temporaryDirectory "installer"

try {
    New-Item -ItemType Directory -Path $payloadDirectory, $installerDirectory, $outputDirectory -Force | Out-Null

    & dotnet publish $edgeProject --configuration Release --runtime win-x64 --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeAllContentForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        --output $payloadDirectory
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível preparar o Conector GiroMesa." }

    $payload = Join-Path $payloadDirectory "GiroMesa.EdgeHub.exe"
    if (-not (Test-Path -LiteralPath $payload -PathType Leaf)) {
        throw "O executável do Conector GiroMesa não foi gerado."
    }

    & dotnet publish $installerProject --configuration Release --runtime win-x64 --self-contained true `
        -p:PublishSingleFile=true `
        -p:EnableCompressionInSingleFile=true `
        -p:PublishInstaller=true `
        -p:EdgeHubPayload=$payload `
        -p:EdgeHubApiBaseUrl=$($apiUri.AbsoluteUri.TrimEnd('/')) `
        --output $installerDirectory
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível gerar o instalador local." }

    $builtInstaller = Join-Path $installerDirectory "GiroMesa.Conector.Setup.exe"
    if (-not (Test-Path -LiteralPath $builtInstaller -PathType Leaf)) {
        throw "O instalador local não foi gerado."
    }

    Copy-Item -LiteralPath $builtInstaller -Destination $finalInstaller -Force
    $stream = [IO.File]::OpenRead($finalInstaller)
    try {
        $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
    }
    Set-Content -LiteralPath "$finalInstaller.sha256" -Value "$hash  $(Split-Path -Leaf $finalInstaller)" -Encoding ascii

    Write-Host "Instalador local pronto:" -ForegroundColor Green
    Write-Host $finalInstaller
    Write-Warning "Este arquivo não é assinado e serve somente para teste neste computador. Não distribua a clientes."
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}
