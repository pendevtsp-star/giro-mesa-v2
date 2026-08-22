using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace GiroMesa.OpsShell;

internal sealed record SmartPosBackendCapabilities(
    string InstallationId,
    bool Available,
    string Status,
    string? Provider,
    IReadOnlyList<string> Methods,
    int MaxInstallments,
    SmartPosCapabilitySupports Supports,
    string? Reason,
    string? CertificationId,
    bool DiagnosticsMatch,
    SmartPosKillSwitch KillSwitch)
{
    public bool IsHomologated =>
        Available && !KillSwitch.Enabled && DiagnosticsMatch && CertificationId is not null &&
        string.Equals(Status, "homologated", StringComparison.Ordinal);
    public bool CanRecover => IsHomologated && Supports.Recover;
    public bool CanCancel => IsHomologated && Supports.Cancel;
    public bool CanReverse => IsHomologated && Supports.Reversal;
    public string? ErrorCode => Reason;

    public bool Allows(SmartPosPaymentCapabilities native) =>
        IsHomologated && native.Available && native.Homologated &&
        string.Equals(Provider, native.Provider, StringComparison.Ordinal) &&
        Methods.Intersect(native.Methods, StringComparer.Ordinal).Any();

    public static SmartPosBackendCapabilities Unavailable(string errorCode) =>
        new(
            Guid.Empty.ToString(),
            false,
            "disabled",
            null,
            [],
            1,
            new(false, false, false),
            errorCode,
            null,
            false,
            new(true, errorCode));
}

internal sealed record SmartPosCapabilitySupports(bool Cancel, bool Recover, bool Reversal);
internal sealed record SmartPosKillSwitch(bool Enabled, string? Reason);

internal sealed record SmartPosAttemptPayload(
    string Id,
    string Provider,
    string Method,
    long AmountCents,
    int Installments,
    string Status);

internal sealed record SmartPosCertificationPayload(string Id, string Provider, string Status)
{
    public bool IsHomologatedFor(string provider) =>
        !string.IsNullOrWhiteSpace(Id) &&
        string.Equals(Status, "approved", StringComparison.Ordinal) &&
        string.Equals(Provider, provider, StringComparison.Ordinal);
}

internal sealed record SmartPosClaimResponse(
    SmartPosAttemptPayload Attempt,
    string Action,
    SmartPosBackendCapabilities Capabilities,
    SmartPosCertificationPayload Certification);

internal sealed record SmartPosReversalClaimResponse(
    JsonElement Reversal,
    SmartPosReversalAction Action);

internal sealed record SmartPosReversalAction(
    string Type,
    string ReversalId,
    string PaymentAttemptId,
    string Provider);

internal sealed record SmartPosApiResult<T>(bool Success, T? Value, string? ErrorCode);
internal sealed record SmartPosPairingResult(
    bool Success,
    string? InstallationId,
    SmartPosBackendCapabilities? Capabilities,
    string? ErrorCode);
internal sealed record SmartPosRotationResult(bool Success, string? CredentialId, string? ErrorCode);

internal sealed class SmartPosDeviceApiClient : ISmartPosResultSink
{
    private const string PairingPath = "/api/v1/device/payment-pairings/redeem";
    private const string RotationPath = "/api/v1/device/payment-credentials/rotate";
    private const string DiagnosticsPath = "/api/v1/device/payment-diagnostics";
    private readonly HttpClient _httpClient;
    private readonly SmartPosDeviceCredentialStore _credentialStore;
    private readonly ISmartPosDeviceDiagnosticsProvider _diagnostics;
    private readonly SmartPosRequestSigner _signer;

    public SmartPosDeviceApiClient(
        HttpClient httpClient,
        SmartPosDeviceCredentialStore credentialStore,
        ISmartPosDeviceDiagnosticsProvider diagnostics,
        SmartPosRequestSigner signer)
    {
        _httpClient = httpClient;
        _credentialStore = credentialStore;
        _diagnostics = diagnostics;
        _signer = signer;
    }

    public async Task<SmartPosPairingResult> RedeemPairingAsync(
        string apiBaseUrl,
        string code,
        string installationId,
        CancellationToken cancellationToken = default)
    {
        var endpoint = NormalizeApiBaseUrl(apiBaseUrl);
        var normalizedCode = code?.Trim().ToUpperInvariant() ?? string.Empty;
        if (endpoint is null || !Guid.TryParse(installationId, out var installation) ||
            normalizedCode.Length != 8 ||
            normalizedCode.Any(character => character is not (>= 'A' and <= 'Z') and not (>= '0' and <= '9')))
        {
            return new(false, null, null, "SMARTPOS_PAIRING_INPUT_INVALID");
        }
        try
        {
            var keys = SmartPosRequestSigner.CreateP256KeyPair();
            var body = SmartPosRequestSigner.CanonicalJson(new
            {
                code = normalizedCode,
                installationId = installation.ToString(),
                publicKeySpki = keys.PublicKeySpki,
                diagnostics = await _diagnostics.CollectAsync(),
            });
            using var request = CreateJsonRequest(HttpMethod.Post, new Uri(endpoint, PairingPath), body);
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return new(false, null, null, await ReadErrorCodeAsync(response, "SMARTPOS_PAIRING_REJECTED"));
            var payload = await ReadJsonAsync<PairingResponse>(response, cancellationToken);
            if (payload is null || !Guid.TryParse(payload.InstallationId, out var pairedInstallation) ||
                pairedInstallation != installation || string.IsNullOrWhiteSpace(payload.CredentialId) ||
                payload.Capabilities is null)
            {
                return new(false, null, null, "SMARTPOS_PAIRING_RESPONSE_INVALID");
            }
            var credential = new SmartPosDeviceCredential(
                payload.InstallationId,
                payload.CredentialId,
                endpoint.ToString().TrimEnd('/'),
                keys.PrivateKeyPkcs8,
                keys.PublicKeySpki,
                payload.CredentialExpiresAt,
                payload.RotateAfter);
            if (!credential.IsValid ||
                !await _credentialStore.SaveAsync(new(credential, null, null, null)))
            {
                return new(false, null, null, "SMARTPOS_CREDENTIAL_STORAGE_UNAVAILABLE");
            }
            return new(true, credential.InstallationId, payload.Capabilities, null);
        }
        catch (Exception exception) when (
            exception is HttpRequestException or TaskCanceledException or JsonException or
                CryptographicException or PlatformNotSupportedException)
        {
            return new(
                false,
                null,
                null,
                exception is CryptographicException or PlatformNotSupportedException
                    ? "SMARTPOS_DEVICE_KEY_UNAVAILABLE"
                    : "SMARTPOS_PAIRING_UNREACHABLE");
        }
    }

    public async Task<SmartPosApiResult<SmartPosBackendCapabilities>> SendDiagnosticsAsync(
        CancellationToken cancellationToken = default)
    {
        var response = await SendSignedAsync<SmartPosBackendCapabilities>(
            HttpMethod.Post,
            DiagnosticsPath,
            await _diagnostics.CollectAsync(),
            cancellationToken);
        return response.Success && response.Value is not null
            ? new(true, response.Value, null)
            : new(false, null, response.ErrorCode);
    }

    public Task<SmartPosApiResult<SmartPosClaimResponse>> ClaimAttemptAsync(
        string attemptId,
        CancellationToken cancellationToken = default) =>
        Guid.TryParse(attemptId, out var parsed)
            ? SendSignedAsync<SmartPosClaimResponse>(
                HttpMethod.Post,
                $"/api/v1/device/payment-attempts/{parsed}/claim",
                body: null,
                cancellationToken)
            : Task.FromResult(new SmartPosApiResult<SmartPosClaimResponse>(
                false,
                null,
                "SMARTPOS_ATTEMPT_ID_INVALID"));

    public async Task<SmartPosResultSubmission> SubmitAsync(
        SmartPosResultEnvelope result,
        CancellationToken cancellationToken = default)
    {
        if (!result.IsValid) return new(false, false, "SMARTPOS_RESULT_INVALID");
        if (result.Operation == "reversal")
        {
            var reversal = await SubmitReversalResultAsync(
                result.ReversalId ?? string.Empty,
                result,
                cancellationToken);
            return new(reversal.Success, !IsPermanentError(reversal.ErrorCode), reversal.ErrorCode);
        }
        var response = await SendSignedAsync<JsonElement>(
            HttpMethod.Post,
            $"/api/v1/device/payment-attempts/{result.AttemptId}/result",
            new
            {
                resultId = result.ResultId,
                status = result.Status,
                providerReference = result.ProviderReference,
                authorizationCode = result.AuthorizationCode,
                failureCode = result.FailureCode,
                occurredAt = result.OccurredAt,
            },
            cancellationToken);
        return new(response.Success, !IsPermanentError(response.ErrorCode), response.ErrorCode);
    }

    public Task<SmartPosApiResult<SmartPosReversalClaimResponse>> ClaimReversalAsync(
        string reversalId,
        CancellationToken cancellationToken = default) =>
        Guid.TryParse(reversalId, out var parsed)
            ? SendSignedAsync<SmartPosReversalClaimResponse>(
                HttpMethod.Post,
                $"/api/v1/device/payment-reversals/{parsed}/claim",
                body: null,
                cancellationToken)
            : Task.FromResult(new SmartPosApiResult<SmartPosReversalClaimResponse>(
                false,
                null,
                "SMARTPOS_REVERSAL_ID_INVALID"));

    public Task<SmartPosApiResult<JsonElement>> SubmitReversalResultAsync(
        string reversalId,
        SmartPosResultEnvelope result,
        CancellationToken cancellationToken = default) =>
        Guid.TryParse(reversalId, out var parsed) && result.IsValid
            ? SendSignedAsync<JsonElement>(
                HttpMethod.Post,
                $"/api/v1/device/payment-reversals/{parsed}/result",
                new
                {
                    resultId = result.ResultId,
                    status = result.Status,
                    providerReference = result.ProviderReference,
                    authorizationCode = result.AuthorizationCode,
                    failureCode = result.FailureCode,
                    occurredAt = result.OccurredAt,
                },
                cancellationToken)
            : Task.FromResult(new SmartPosApiResult<JsonElement>(
                false,
                default,
                "SMARTPOS_REVERSAL_RESULT_INVALID"));

    public async Task<SmartPosRotationResult> RotateCredentialAsync(
        CancellationToken cancellationToken = default)
    {
        var state = await _credentialStore.LoadAsync();
        if (state is null) return new(false, null, "SMARTPOS_NOT_PAIRED");
        var pending = state.PendingRotation;
        if (pending is null)
        {
            try
            {
                var keys = SmartPosRequestSigner.CreateP256KeyPair();
                pending = new(
                    Guid.NewGuid().ToString(),
                    keys.PrivateKeyPkcs8,
                    keys.PublicKeySpki,
                    DateTimeOffset.UtcNow);
            }
            catch (Exception exception) when (
                exception is CryptographicException or PlatformNotSupportedException)
            {
                return new(false, null, "SMARTPOS_DEVICE_KEY_UNAVAILABLE");
            }
            if (!await _credentialStore.SavePendingRotationAsync(pending))
                return new(false, null, "SMARTPOS_CREDENTIAL_STORAGE_UNAVAILABLE");
        }
        var rotated = await SendSignedAsync<RotationResponse>(
            HttpMethod.Post,
            RotationPath,
            new { rotationId = pending.RotationId, newPublicKeySpki = pending.PublicKeySpki },
            cancellationToken,
            state.Current);
        if (!rotated.Success || rotated.Value is null)
            return new(false, null, rotated.ErrorCode ?? "SMARTPOS_CREDENTIAL_ROTATION_FAILED");
        var current = new SmartPosDeviceCredential(
            state.Current.InstallationId,
            rotated.Value.CredentialId,
            state.Current.ApiBaseUrl,
            pending.PrivateKeyPkcs8,
            pending.PublicKeySpki,
            rotated.Value.CredentialExpiresAt,
            rotated.Value.RotateAfter);
        var next = new SmartPosDeviceCredentialState(
            current,
            state.Current,
            rotated.Value.PreviousCredentialValidUntil,
            null);
        if (!current.IsValid || !await _credentialStore.SaveAsync(next))
            return new(false, null, "SMARTPOS_CREDENTIAL_STORAGE_UNAVAILABLE");
        var probe = await SendDiagnosticsAsync(cancellationToken);
        return probe.Success
            ? new(true, current.CredentialId, null)
            : new(false, current.CredentialId, "SMARTPOS_ROTATED_CREDENTIAL_NOT_CONFIRMED");
    }

    private async Task<SmartPosApiResult<T>> SendSignedAsync<T>(
        HttpMethod method,
        string path,
        object? body,
        CancellationToken cancellationToken,
        SmartPosDeviceCredential? credentialOverride = null)
    {
        var state = await _credentialStore.LoadAsync();
        var credential = credentialOverride ?? state?.Current;
        if (credential is null) return new(false, default, "SMARTPOS_NOT_PAIRED");
        var bodyBytes = body is null ? [] : SmartPosRequestSigner.CanonicalJson(body);
        var first = await SendSignedOnceAsync<T>(method, path, bodyBytes, credential, cancellationToken);
        if (first.StatusCode != HttpStatusCode.Unauthorized || state?.Previous is null ||
            state.PreviousValidUntil <= DateTimeOffset.UtcNow || credentialOverride is not null)
        {
            return first.Result;
        }
        return (await SendSignedOnceAsync<T>(
            method,
            path,
            bodyBytes,
            state.Previous,
            cancellationToken)).Result;
    }

    private async Task<SignedResponse<T>> SendSignedOnceAsync<T>(
        HttpMethod method,
        string path,
        byte[] body,
        SmartPosDeviceCredential credential,
        CancellationToken cancellationToken)
    {
        try
        {
            var uri = new Uri(new Uri(credential.ApiBaseUrl), path);
            using var request = body.Length == 0
                ? new HttpRequestMessage(method, uri)
                : CreateJsonRequest(method, uri, body);
            var signature = _signer.Sign(method, uri, body, credential);
            request.Headers.Add("X-GiroMesa-Credential-Id", signature.CredentialId);
            request.Headers.Add("X-GiroMesa-Timestamp", signature.Timestamp);
            request.Headers.Add("X-GiroMesa-Nonce", signature.Nonce);
            request.Headers.Add("X-GiroMesa-Signature", signature.Signature);
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return new(
                    response.StatusCode,
                    new(false, default, await ReadErrorCodeAsync(response, "SMARTPOS_DEVICE_REQUEST_REJECTED")));
            }
            var value = await ReadJsonAsync<T>(response, cancellationToken);
            return value is null
                ? new(response.StatusCode, new(false, default, "SMARTPOS_DEVICE_RESPONSE_INVALID"))
                : new(response.StatusCode, new(true, value, null));
        }
        catch (Exception exception) when (
            exception is HttpRequestException or TaskCanceledException or JsonException or
                CryptographicException or FormatException or InvalidOperationException)
        {
            var errorCode = exception is CryptographicException or FormatException or InvalidOperationException
                ? "SMARTPOS_DEVICE_CREDENTIAL_INVALID"
                : "SMARTPOS_DEVICE_API_UNREACHABLE";
            return new(HttpStatusCode.ServiceUnavailable, new(false, default, errorCode));
        }
    }

    private static HttpRequestMessage CreateJsonRequest(HttpMethod method, Uri uri, byte[] body)
    {
        var request = new HttpRequestMessage(method, uri) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json")
        {
            CharSet = "utf-8",
        };
        return request;
    }

    private static async Task<T?> ReadJsonAsync<T>(
        HttpResponseMessage response,
        CancellationToken cancellationToken) =>
        await JsonSerializer.DeserializeAsync<T>(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            SmartPosJson.Options,
            cancellationToken);

    private static async Task<string> ReadErrorCodeAsync(
        HttpResponseMessage response,
        string fallback)
    {
        try
        {
            var error = await ReadJsonAsync<ApiError>(response, CancellationToken.None);
            return string.IsNullOrWhiteSpace(error?.Code) ? fallback : error.Code;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    internal static Uri? NormalizeApiBaseUrl(string value)
    {
        if (!TryNormalizeHttpsOrigin(value, out var candidate)) return null;
        var trustedValue = typeof(SmartPosDeviceApiClient).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute =>
                string.Equals(attribute.Key, "GiroMesa.SmartPos.ApiBaseUrl", StringComparison.Ordinal))
            ?.Value;
        if (!TryNormalizeHttpsOrigin(trustedValue, out var trusted) ||
            !string.Equals(
                candidate.GetLeftPart(UriPartial.Authority),
                trusted.GetLeftPart(UriPartial.Authority),
                StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        return candidate;
    }

    private static bool TryNormalizeHttpsOrigin(string? value, out Uri uri)
    {
        uri = null!;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) ||
            parsed.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(parsed.UserInfo) ||
            (parsed.AbsolutePath != "/" && parsed.AbsolutePath.Length != 0) ||
            !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment))
        {
            return false;
        }
        uri = new Uri(parsed.GetLeftPart(UriPartial.Authority));
        return true;
    }

    private static bool IsPermanentError(string? errorCode) =>
        errorCode is "SMARTPOS_RESULT_INVALID" or
            "PAYMENT_ATTEMPT_NOT_FOUND" or
            "PAYMENT_ATTEMPT_ALREADY_RESOLVED" or
            "PAYMENT_DEVICE_RESULT_CONFLICT" or
            "PAYMENT_PROVIDER_REFERENCE_CONFLICT" or
            "PAYMENT_REVERSAL_NOT_FOUND" or
            "PAYMENT_REVERSAL_ALREADY_RESOLVED" or
            "PAYMENT_REVERSAL_RESULT_CONFLICT" or
            "PAYMENT_NOT_FOUND" or
            "PAYMENT_REVERSAL_RACE" or
            "PAYMENT_DEVICE_UNAUTHORIZED";

    private sealed record PairingResponse(
        string InstallationId,
        string CredentialId,
        DateTimeOffset CredentialExpiresAt,
        DateTimeOffset RotateAfter,
        SmartPosBackendCapabilities Capabilities);
    private sealed record RotationResponse(
        string CredentialId,
        DateTimeOffset CredentialExpiresAt,
        DateTimeOffset RotateAfter,
        DateTimeOffset PreviousCredentialValidUntil);
    private sealed record ApiError(string Code);
    private sealed record SignedResponse<T>(HttpStatusCode StatusCode, SmartPosApiResult<T> Result);
}

internal sealed class DeviceApiSmartPosPaymentAttemptResolver : ISmartPosPaymentAttemptResolver
{
    private readonly SmartPosDeviceApiClient _client;

    public DeviceApiSmartPosPaymentAttemptResolver(SmartPosDeviceApiClient client)
    {
        _client = client;
    }

    public bool Available => true;

    public async Task<SmartPosBackendCapabilities> GetAuthorizationAsync()
    {
        var result = await _client.SendDiagnosticsAsync();
        return result.Success && result.Value is not null
            ? result.Value
            : SmartPosBackendCapabilities.Unavailable(
                result.ErrorCode ?? "SMARTPOS_DEVICE_AUTHORIZATION_UNAVAILABLE");
    }

    public async Task<SmartPosPaymentAttemptResolution> ResolveAsync(string attemptId)
    {
        var result = await _client.ClaimAttemptAsync(attemptId);
        var claim = result.Value;
        if (!result.Success || claim is null)
        {
            return new(
                false,
                null,
                null,
                SmartPosLaunchAction.None,
                false,
                result.ErrorCode ?? "SMARTPOS_ATTEMPT_CLAIM_FAILED");
        }
        var action = claim.Action switch
        {
            "start" => SmartPosLaunchAction.Start,
            "recover" => SmartPosLaunchAction.Recover,
            "cancel" => SmartPosLaunchAction.Cancel,
            _ => SmartPosLaunchAction.None,
        };
        var request = new SmartPosPaymentRequest(
            claim.Attempt.Id,
            claim.Attempt.AmountCents,
            claim.Attempt.Method,
            claim.Attempt.Installments);
        var certificationHomologated =
            claim.Certification.IsHomologatedFor(claim.Attempt.Provider) &&
            claim.Capabilities.Available &&
            claim.Capabilities.IsHomologated &&
            string.Equals(
                claim.Capabilities.Provider,
                claim.Attempt.Provider,
                StringComparison.Ordinal) &&
            claim.Capabilities.Methods.Contains(claim.Attempt.Method, StringComparer.Ordinal) &&
            claim.Attempt.Installments <= claim.Capabilities.MaxInstallments;
        return action == SmartPosLaunchAction.None || !request.IsValid
            ? new(
                false,
                null,
                claim.Attempt.Provider,
                action,
                false,
                "SMARTPOS_ATTEMPT_CLAIM_INVALID")
            : new(
                true,
                request,
                claim.Attempt.Provider,
                action,
                certificationHomologated,
                certificationHomologated ? null : "SMARTPOS_CERTIFICATION_MISMATCH");
    }
}

internal sealed class DeviceApiSmartPosReversalResolver : ISmartPosReversalResolver
{
    private readonly SmartPosDeviceApiClient _client;

    public DeviceApiSmartPosReversalResolver(SmartPosDeviceApiClient client)
    {
        _client = client;
    }

    public async Task<SmartPosReversalResolution> ResolveAsync(string reversalId)
    {
        var result = await _client.ClaimReversalAsync(reversalId);
        var action = result.Value?.Action;
        var launchAction = action?.Type switch
        {
            "reverse" => SmartPosReversalLaunchAction.Reverse,
            "recover" => SmartPosReversalLaunchAction.Recover,
            _ => SmartPosReversalLaunchAction.None,
        };
        if (!result.Success || action is null ||
            launchAction == SmartPosReversalLaunchAction.None ||
            !string.Equals(action.ReversalId, reversalId, StringComparison.Ordinal))
        {
            return new(
                false,
                null,
                SmartPosReversalLaunchAction.None,
                result.ErrorCode ?? "SMARTPOS_REVERSAL_CLAIM_INVALID");
        }
        var request = new SmartPosReversalRequest(
            action.ReversalId,
            action.PaymentAttemptId,
            action.Provider);
        return request.IsValid
            ? new(true, request, launchAction, null)
            : new(false, null, SmartPosReversalLaunchAction.None, "SMARTPOS_REVERSAL_CLAIM_INVALID");
    }
}
