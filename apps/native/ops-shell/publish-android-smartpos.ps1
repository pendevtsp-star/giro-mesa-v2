[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Provider,

  [Parameter(Mandatory = $true)]
  [string]$Environment,

  [Parameter(Mandatory = $true)]
  [string]$ProviderPackage,

  [Parameter(Mandatory = $true)]
  [string[]]$AllowedPackages,

  [Parameter(Mandatory = $true)]
  [string[]]$AllowedSchemes,

  [Parameter(Mandatory = $true)]
  [string[]]$Methods,

  [Parameter(Mandatory = $true)]
  [string]$StartUriTemplate,

  [string]$RecoverUriTemplate = "",
  [string]$CancelUriTemplate = "",

  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$KeyStorePath,

  [Parameter(Mandatory = $true)]
  [string]$KeyAlias,

  [string]$SigningKeyPasswordEnvironmentVariable = "GIROMESA_ANDROID_KEY_PASSWORD",
  [string]$SigningStorePasswordEnvironmentVariable = "GIROMESA_ANDROID_KEYSTORE_PASSWORD",

  [ValidateRange(30, 600)]
  [int]$TimeoutSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-NativeCommandSucceeded {
  param([Parameter(Mandatory = $true)][string]$Operation)

  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with exit code $LASTEXITCODE."
  }
}

function Normalize-Values {
  param(
    [Parameter(Mandatory = $true)][string[]]$Values,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $normalized = @(
    $Values |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Select-Object -Unique
  )
  if ($normalized.Count -eq 0) {
    throw "$Name must contain at least one value."
  }
  return $normalized
}

function Get-TemplateScheme {
  param(
    [Parameter(Mandatory = $true)][string]$Template,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $match = [System.Text.RegularExpressions.Regex]::Match(
    $Template,
    "^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*):"
  )
  if (-not $match.Success) {
    throw "$Name must be an absolute provider URI template."
  }
  return $match.Groups["scheme"].Value.ToLowerInvariant()
}

function Assert-Template {
  param(
    [Parameter(Mandatory = $true)][string]$Template,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$RequiredPlaceholders,
    [Parameter(Mandatory = $true)][System.Collections.Generic.HashSet[string]]$SchemeAllowlist
  )

  foreach ($placeholder in $RequiredPlaceholders) {
    if ($Template.IndexOf($placeholder, [System.StringComparison]::Ordinal) -lt 0) {
      throw "$Name must contain $placeholder."
    }
  }
  $scheme = Get-TemplateScheme -Template $Template -Name $Name
  if (-not $SchemeAllowlist.Contains($scheme)) {
    throw "$Name uses scheme '$scheme', which is not in AllowedSchemes."
  }
}

function Normalize-HttpsOrigin {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $uri = $null
  if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -cne [System.Uri]::UriSchemeHttps -or
    -not [string]::IsNullOrEmpty($uri.UserInfo) -or
    ($uri.AbsolutePath -ne "/" -and $uri.AbsolutePath.Length -ne 0) -or
    -not [string]::IsNullOrEmpty($uri.Query) -or
    -not [string]::IsNullOrEmpty($uri.Fragment)) {
    throw "$Name must be an HTTPS origin without credentials, path, query or fragment."
  }
  return $uri.GetLeftPart([System.UriPartial]::Authority)
}

function Assert-SmartPosBundle {
  param(
    [Parameter(Mandatory = $true)][string]$BundleRoot,
    [Parameter(Mandatory = $true)][string]$ExpectedApiBaseUrl
  )

  $assets = Join-Path $BundleRoot "assets"
  $deviceChunks = @(Get-ChildItem -LiteralPath $assets -Filter "DeviceSetupPage-*.js" -File)
  $paymentChunks = @(Get-ChildItem -LiteralPath $assets -Filter "pos-payments-*.js" -File)
  if ($deviceChunks.Count -ne 1 -or $paymentChunks.Count -ne 1) {
    throw "The synchronized bundle must contain exactly one DeviceSetupPage and one pos-payments chunk."
  }

  $deviceContent = [System.IO.File]::ReadAllText($deviceChunks[0].FullName)
  foreach ($marker in @(
    "payment-devices",
    "payment-operations/health",
    "payment-reconciliation",
    "payment-homologation-runs",
    "Aplicativo SmartPOS"
  )) {
    if ($deviceContent.IndexOf($marker, [System.StringComparison]::Ordinal) -lt 0) {
      throw "The synchronized DeviceSetupPage bundle is missing marker '$marker'."
    }
  }

  $paymentContent = [System.IO.File]::ReadAllText($paymentChunks[0].FullName)
  foreach ($marker in @(
    "GetPaymentCapabilitiesAsync",
    "RedeemPaymentPairingAsync",
    "StartPaymentAsync",
    "RecoverPaymentAsync",
    "CancelPaymentAsync"
  )) {
    if ($paymentContent.IndexOf($marker, [System.StringComparison]::Ordinal) -lt 0) {
      throw "The synchronized payment bridge bundle is missing marker '$marker'."
    }
  }

  $mainChunks = @(Get-ChildItem -LiteralPath $assets -Filter "index-*.js" -File)
  if ($mainChunks.Count -ne 1) {
    throw "The synchronized bundle must contain exactly one main index chunk."
  }
  $mainContent = [System.IO.File]::ReadAllText($mainChunks[0].FullName)
  if ($mainContent.IndexOf($ExpectedApiBaseUrl, [System.StringComparison]::Ordinal) -lt 0) {
    throw "The synchronized bundle does not contain expected public API origin '$ExpectedApiBaseUrl'."
  }
  foreach ($developmentOrigin in @("http://localhost:3200", "http://localhost:3100")) {
    if ($mainContent.IndexOf($developmentOrigin, [System.StringComparison]::Ordinal) -ge 0) {
      throw "The synchronized bundle contains development origin '$developmentOrigin'."
    }
  }
}

$providerValue = $Provider.Trim().ToLowerInvariant()
$environmentValue = $Environment.Trim().ToLowerInvariant()
if ($providerValue -ne "generic_intent") {
  throw "Only generic_intent can be packaged by this checkout. A provider-specific SDK adapter and homologation are required for '$providerValue'."
}
if ($environmentValue -ne "homologation") {
  throw "generic_intent is restricted to the homologation environment and cannot be packaged for production."
}

$packagePattern = "^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$"
$providerPackageValue = $ProviderPackage.Trim()
if ($providerPackageValue -notmatch $packagePattern) {
  throw "ProviderPackage is not a valid Android package name."
}
if ($providerPackageValue -eq "br.com.giromesa.operacao") {
  throw "ProviderPackage cannot target the GiroMesa application itself."
}

$allowedPackageValues = @(Normalize-Values -Values $AllowedPackages -Name "AllowedPackages")
if ($allowedPackageValues.Count -ne 1 -or $allowedPackageValues[0] -cne $providerPackageValue) {
  throw "AllowedPackages must contain only the exact ProviderPackage for this build."
}

$allowedSchemeValues = @(
  Normalize-Values -Values $AllowedSchemes -Name "AllowedSchemes" |
    ForEach-Object { $_.ToLowerInvariant() }
)
$forbiddenSchemes = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@("content", "data", "file", "http", "https", "javascript", "market"),
  [System.StringComparer]::OrdinalIgnoreCase
)
$schemeAllowlist = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]$allowedSchemeValues,
  [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($scheme in $schemeAllowlist) {
  if ($scheme -notmatch "^[a-z][a-z0-9+.-]*$" -or $forbiddenSchemes.Contains($scheme)) {
    throw "AllowedSchemes contains forbidden or invalid scheme '$scheme'."
  }
}

$methodValues = @(Normalize-Values -Values $Methods -Name "Methods")
foreach ($method in $methodValues) {
  if ($method -cnotin @("credit_card", "debit_card", "pix")) {
    throw "Unsupported payment method '$method'."
  }
}

Assert-Template `
  -Template $StartUriTemplate `
  -Name "StartUriTemplate" `
  -RequiredPlaceholders @("{attemptId}", "{amountCents}", "{method}") `
  -SchemeAllowlist $schemeAllowlist
if (-not [string]::IsNullOrWhiteSpace($RecoverUriTemplate)) {
  Assert-Template `
    -Template $RecoverUriTemplate `
    -Name "RecoverUriTemplate" `
    -RequiredPlaceholders @("{attemptId}") `
    -SchemeAllowlist $schemeAllowlist
}
if (-not [string]::IsNullOrWhiteSpace($CancelUriTemplate)) {
  Assert-Template `
    -Template $CancelUriTemplate `
    -Name "CancelUriTemplate" `
    -RequiredPlaceholders @("{attemptId}") `
    -SchemeAllowlist $schemeAllowlist
}

$apiBaseUrlValue = Normalize-HttpsOrigin -Value $ApiBaseUrl -Name "ApiBaseUrl"

if (-not (Test-Path -LiteralPath $KeyStorePath -PathType Leaf)) {
  throw "KeyStorePath does not point to an existing keystore file."
}
$resolvedKeyStore = (Resolve-Path -LiteralPath $KeyStorePath -ErrorAction Stop).Path
if ((Get-Item -LiteralPath $resolvedKeyStore).PSIsContainer) {
  throw "KeyStorePath must point to a keystore file."
}
if ([string]::IsNullOrWhiteSpace($KeyAlias)) {
  throw "KeyAlias is required."
}

$environmentVariablePattern = "^[A-Za-z_][A-Za-z0-9_]*$"
foreach ($variableName in @(
  $SigningKeyPasswordEnvironmentVariable,
  $SigningStorePasswordEnvironmentVariable
)) {
  if ($variableName -notmatch $environmentVariablePattern) {
    throw "Signing password environment variable names must be simple identifiers."
  }
  if ([string]::IsNullOrWhiteSpace([System.Environment]::GetEnvironmentVariable($variableName))) {
    throw "Required signing password environment variable '$variableName' is not set."
  }
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$projectPath = Join-Path $PSScriptRoot "GiroMesa.OpsShell.csproj"
$bundleRoot = Join-Path $PSScriptRoot "Resources\Raw\wwwroot"
$syncScript = Join-Path $PSScriptRoot "sync-ops-bundle.ps1"
$previousViteApiUrl = [System.Environment]::GetEnvironmentVariable(
  "VITE_API_URL",
  [System.EnvironmentVariableTarget]::Process
)

Push-Location $repositoryRoot
try {
  [System.Environment]::SetEnvironmentVariable(
    "VITE_API_URL",
    $apiBaseUrlValue,
    [System.EnvironmentVariableTarget]::Process
  )
  & pnpm --filter "@giromesa/ops" build
  Assert-NativeCommandSucceeded -Operation "Ops build"

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript
  Assert-NativeCommandSucceeded -Operation "Ops bundle synchronization"
  Assert-SmartPosBundle `
    -BundleRoot $bundleRoot `
    -ExpectedApiBaseUrl $apiBaseUrlValue

  $publishStartedAt = [System.DateTime]::UtcNow
  $publishArguments = @(
    "publish",
    $projectPath,
    "-f", "net10.0-android",
    "-c", "Release",
    "-p:GiroMesaAndroidTarget=true",
    "-p:AndroidPackageFormats=apk",
    "-p:AndroidKeyStore=true",
    "-p:AndroidSigningKeyStore=$resolvedKeyStore",
    "-p:AndroidSigningKeyAlias=$($KeyAlias.Trim())",
    "-p:AndroidSigningKeyPass=env:$SigningKeyPasswordEnvironmentVariable",
    "-p:AndroidSigningStorePass=env:$SigningStorePasswordEnvironmentVariable",
    "-p:SmartPosProvider=$providerValue",
    "-p:SmartPosEnvironment=$environmentValue",
    "-p:SmartPosPackage=$providerPackageValue",
    "-p:SmartPosAllowedPackages=$($allowedPackageValues -join ',')",
    "-p:SmartPosAllowedSchemes=$($allowedSchemeValues -join ',')",
    "-p:SmartPosMethods=$($methodValues -join ',')",
    "-p:SmartPosStartUriTemplate=$StartUriTemplate",
    "-p:SmartPosRecoverUriTemplate=$RecoverUriTemplate",
    "-p:SmartPosCancelUriTemplate=$CancelUriTemplate",
    "-p:SmartPosTimeoutSeconds=$TimeoutSeconds",
    "-p:SmartPosApiBaseUrl=$apiBaseUrlValue"
  )
  & dotnet @publishArguments
  Assert-NativeCommandSucceeded -Operation "Signed Android publish"

  $publishDirectory = Join-Path $PSScriptRoot "bin\Release\net10.0-android\publish"
  $signedApks = @(
    Get-ChildItem -LiteralPath $publishDirectory -Filter "*-Signed.apk" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTimeUtc -ge $publishStartedAt.AddMinutes(-1) }
  )
  if ($signedApks.Count -eq 0) {
    throw "Android publish completed without producing a fresh signed APK."
  }
  foreach ($apk in $signedApks) {
    Write-Output "SIGNED_APK=$($apk.FullName)"
  }
  Write-Warning "The generic Intent adapter remains unhomologated and fail-closed for financial approval. This APK is not a production payment integration."
}
finally {
  [System.Environment]::SetEnvironmentVariable(
    "VITE_API_URL",
    $previousViteApiUrl,
    [System.EnvironmentVariableTarget]::Process
  )
  Pop-Location
}
