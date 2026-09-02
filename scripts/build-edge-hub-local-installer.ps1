param(
    [string]$ApiBaseUrl = "https://api.giromesa.com.br",
    [string]$SigningCertificateThumbprint = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($SigningCertificateThumbprint)) {
    $securityModule = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
    Import-Module $securityModule -Force
}

$apiUri = $null
if (-not [Uri]::TryCreate($ApiBaseUrl, [UriKind]::Absolute, [ref]$apiUri) -or
    ($apiUri.Scheme -ne "https" -and -not $apiUri.IsLoopback)) {
    throw "Use uma URL HTTPS ou um endereço local para a API."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$edgeProject = Join-Path $repositoryRoot "apps/backends/edge-hub/GiroMesa.EdgeHub.csproj"
$installerProject = Join-Path $repositoryRoot "apps/backends/edge-hub-installer/GiroMesa.EdgeHub.Installer.csproj"
$outputDirectory = Join-Path $repositoryRoot "apps/backends/edge-hub-installer/bin/local-test"
$pilotBuild = -not [string]::IsNullOrWhiteSpace($SigningCertificateThumbprint)
$finalInstallerName = if ($pilotBuild) { "GiroMesa-Conector-Setup-PILOTO.exe" } else { "GiroMesa-Conector-Setup-TESTE-LOCAL.exe" }
$finalInstaller = Join-Path $outputDirectory $finalInstallerName
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("giromesa-edge-hub-" + [Guid]::NewGuid().ToString("N"))
$payloadDirectory = Join-Path $temporaryDirectory "payload"
$installerDirectory = Join-Path $temporaryDirectory "installer"

function Set-PilotSignature([string]$Path) {
    $thumbprint = $SigningCertificateThumbprint.Replace(" ", "").ToUpperInvariant()
    $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
    if (-not $certificate -or -not $certificate.HasPrivateKey) {
        throw "Certificado piloto com chave privada não encontrado no repositório pessoal."
    }
    $codeSigningUsage = $certificate.EnhancedKeyUsageList | Where-Object ObjectId -eq "1.3.6.1.5.5.7.3.3"
    if (-not $codeSigningUsage) { throw "O certificado informado não permite assinatura de código." }

    $signature = Set-AuthenticodeSignature `
        -Certificate $certificate `
        -FilePath $Path `
        -HashAlgorithm SHA256 `
        -TimestampServer "http://timestamp.digicert.com"
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $thumbprint) {
        throw "A assinatura provisória não foi aplicada a $(Split-Path -Leaf $Path)."
    }
    if (-not $signature.TimeStamperCertificate) {
        throw "O carimbo de tempo não foi aplicado a $(Split-Path -Leaf $Path)."
    }
}

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
    if ($pilotBuild) { Set-PilotSignature $payload }

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
    if ($pilotBuild) { Set-PilotSignature $finalInstaller }
    $stream = [IO.File]::OpenRead($finalInstaller)
    try {
        $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
    }
    Set-Content -LiteralPath "$finalInstaller.sha256" -Value "$hash  $(Split-Path -Leaf $finalInstaller)" -Encoding ascii

    Write-Host "Instalador pronto:" -ForegroundColor Green
    Write-Host $finalInstaller
    if ($pilotBuild) {
        Write-Warning "Assinatura provisória aplicada. Distribua somente à organização piloto autorizada; o Windows ainda pode informar que o editor não possui confiança pública."
    }
    else {
        Write-Warning "Este arquivo não é assinado e serve somente para teste neste computador. Não distribua a clientes."
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}
