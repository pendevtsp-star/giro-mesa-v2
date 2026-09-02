[CmdletBinding()]
param(
    [ValidateRange(30, 365)]
    [int]$ValidityDays = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
    throw "O certificado piloto deve ser criado em um computador Windows."
}

$securityModule = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
Import-Module $securityModule -Force

$certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=GiroMesa Piloto" `
    -FriendlyName "GiroMesa Conector - Piloto" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -HashAlgorithm SHA256 `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -KeyExportPolicy NonExportable `
    -NotAfter (Get-Date).AddDays($ValidityDays)

Write-Host "Certificado piloto criado no repositório pessoal do Windows." -ForegroundColor Green
Write-Host "Validade: $($certificate.NotAfter.ToString('dd/MM/yyyy HH:mm'))"
Write-Host "Use este identificador ao gerar o instalador:"
Write-Output $certificate.Thumbprint
