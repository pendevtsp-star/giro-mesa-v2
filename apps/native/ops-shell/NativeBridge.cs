using System.Net.Http.Json;
using System.Text.Json;

namespace GiroMesa.OpsShell;

public sealed class NativeBridge
{
    private const string HubUrlPreference = "hub_url";
    private const string DeviceTokenKey = "hub_device_token";
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(10) };
    private readonly SmartPosPaymentService _smartPosPayments;
    private readonly SmartPosDeviceApiClient _smartPosDeviceApi;
    private readonly SmartPosDeviceCredentialStore _smartPosCredentialStore;

    internal NativeBridge(
        SmartPosPaymentService smartPosPayments,
        SmartPosDeviceApiClient smartPosDeviceApi,
        SmartPosDeviceCredentialStore smartPosCredentialStore)
    {
        _smartPosPayments = smartPosPayments;
        _smartPosDeviceApi = smartPosDeviceApi;
        _smartPosCredentialStore = smartPosCredentialStore;
    }

    public Task<DeviceContext> GetDeviceContextAsync()
    {
        var deviceId = Preferences.Default.Get("device_id", string.Empty);
        if (!Guid.TryParse(deviceId, out var parsedDeviceId))
        {
            deviceId = Guid.NewGuid().ToString();
            Preferences.Default.Set("device_id", deviceId);
        }
        else
        {
            deviceId = parsedDeviceId.ToString();
            Preferences.Default.Set("device_id", deviceId);
        }

        return Task.FromResult(new DeviceContext(
            deviceId,
            DeviceInfo.Current.Name,
            DeviceInfo.Current.Platform.ToString(),
            Preferences.Default.Get(HubUrlPreference, "http://giromesa-hub.local:43120")));
    }

    public async Task<HubStatus> CheckHubAsync(string? hubUrl = null)
    {
        var endpoint = NormalizeHubUrl(hubUrl ?? Preferences.Default.Get(HubUrlPreference, string.Empty));
        if (endpoint is null)
        {
            return new(false, null, "HUB_URL_REQUIRED");
        }

        try
        {
            using var response = await _httpClient.GetAsync(new Uri(endpoint, "/health"));
            return response.IsSuccessStatusCode
                ? new(true, endpoint.ToString(), null)
                : new(false, endpoint.ToString(), $"HUB_HTTP_{(int)response.StatusCode}");
        }
        catch (HttpRequestException)
        {
            return new(false, endpoint.ToString(), "HUB_UNREACHABLE");
        }
        catch (TaskCanceledException)
        {
            return new(false, endpoint.ToString(), "HUB_TIMEOUT");
        }
    }

    public async Task<PairingResult> PairHubAsync(string hubUrl, string enrollmentCode)
    {
        var endpoint = NormalizeHubUrl(hubUrl);
        if (endpoint is null || string.IsNullOrWhiteSpace(enrollmentCode))
        {
            return new(false, "INVALID_PAIRING_INPUT");
        }

        var device = await GetDeviceContextAsync();
        try
        {
            using var response = await _httpClient.PostAsJsonAsync(new Uri(endpoint, "/v1/pair"), new
            {
                deviceId = device.DeviceId,
                deviceName = device.DeviceName,
                enrollmentCode,
            });
            if (!response.IsSuccessStatusCode)
            {
                return new(false, $"PAIRING_HTTP_{(int)response.StatusCode}");
            }

            var payload = await response.Content.ReadFromJsonAsync<PairingPayload>();
            if (string.IsNullOrWhiteSpace(payload?.DeviceToken))
            {
                return new(false, "PAIRING_TOKEN_MISSING");
            }

            await SecureStorage.Default.SetAsync(DeviceTokenKey, payload.DeviceToken);
            Preferences.Default.Set(HubUrlPreference, endpoint.ToString().TrimEnd('/'));
            return new(true, null);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, "PAIRING_HUB_UNREACHABLE");
        }
    }

    public Task ClearPairingAsync()
    {
        SecureStorage.Default.Remove(DeviceTokenKey);
        Preferences.Default.Remove(HubUrlPreference);
        return Task.CompletedTask;
    }

    public async Task<CommandResult> SendCommandAsync(
        string organizationId,
        string unitId,
        string actorId,
        string commandJson)
    {
        if (string.IsNullOrWhiteSpace(organizationId) || string.IsNullOrWhiteSpace(unitId) ||
            string.IsNullOrWhiteSpace(actorId) || string.IsNullOrWhiteSpace(commandJson))
        {
            return new(false, false, "INVALID_COMMAND_SCOPE", null);
        }

        var endpoint = NormalizeHubUrl(Preferences.Default.Get(HubUrlPreference, string.Empty));
        var token = await SecureStorage.Default.GetAsync(DeviceTokenKey);
        if (endpoint is null || string.IsNullOrWhiteSpace(token))
        {
            return new(false, false, "HUB_NOT_PAIRED", null);
        }

        try
        {
            using var commandDocument = JsonDocument.Parse(commandJson);
            var source = commandDocument.RootElement;
            var device = await GetDeviceContextAsync();
            if (source.GetProperty("deviceId").GetString() != device.DeviceId)
            {
                return new(false, false, "DEVICE_ID_MISMATCH", null);
            }
            var payload = new
            {
                id = source.GetProperty("id").GetString(),
                organizationId,
                unitId,
                actorId,
                deviceId = source.GetProperty("deviceId").GetString(),
                idempotencyKey = source.GetProperty("idempotencyKey").GetString(),
                type = source.GetProperty("type").GetString(),
                payload = source.GetProperty("payload").Clone(),
                version = source.GetProperty("version").GetInt32(),
                occurredAt = source.GetProperty("occurredAt").GetDateTimeOffset(),
            };
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(endpoint, "/v1/commands"))
            {
                Content = JsonContent.Create(payload),
            };
            request.Headers.Add("X-GiroMesa-Device-Token", token);
            using var response = await _httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                return new(false, false, await ReadErrorCodeAsync(response), null);
            }

            var result = await response.Content.ReadFromJsonAsync<HubCommandResponse>();
            return new(true, result?.Duplicate ?? false, null, result?.Result);
        }
        catch (JsonException)
        {
            return new(false, false, "INVALID_COMMAND_JSON", null);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, false, "HUB_COMMAND_UNREACHABLE", null);
        }
    }

    public async Task<OperationalStateResult> GetOperationalStateAsync(
        string resource,
        string? resourceId = null)
    {
        var path = resource switch
        {
            "catalog" => "/v1/operational-state/catalog",
            "floor" => "/v1/operational-state/floor",
            "tabs" => "/v1/operational-state/tabs",
            "tab" when Guid.TryParse(resourceId, out _) => $"/v1/operational-state/tabs/{resourceId}",
            "kds" => "/v1/operational-state/kds",
            "reconciliation" => "/v1/operational-state/reconciliation",
            _ => null,
        };
        if (path is null) return new(false, null, "INVALID_OPERATIONAL_RESOURCE");

        var endpoint = NormalizeHubUrl(Preferences.Default.Get(HubUrlPreference, string.Empty));
        var token = await SecureStorage.Default.GetAsync(DeviceTokenKey);
        if (endpoint is null || string.IsNullOrWhiteSpace(token))
        {
            return new(false, null, "HUB_NOT_PAIRED");
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(endpoint, path));
            request.Headers.Add("X-GiroMesa-Device-Token", token);
            using var response = await _httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                return new(false, null, await ReadErrorCodeAsync(response));
            }
            using var payload = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
            return new(true, payload.RootElement.Clone(), null);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, null, "HUB_STATE_UNREACHABLE");
        }
    }

    public async Task<PrintBridgeResult> SendPrintJobAsync(
        string printJobJson,
        string idempotencyKey)
    {
        if (string.IsNullOrWhiteSpace(printJobJson) || string.IsNullOrWhiteSpace(idempotencyKey))
            return new(false, "rejected", "INVALID_PRINT_JOB", null, false);
        var endpoint = NormalizeHubUrl(Preferences.Default.Get(HubUrlPreference, string.Empty));
        var token = await SecureStorage.Default.GetAsync(DeviceTokenKey);
        if (endpoint is null || string.IsNullOrWhiteSpace(token))
            return new(false, "unavailable", "HUB_NOT_PAIRED", null, false);

        try
        {
            using var sourceDocument = JsonDocument.Parse(printJobJson);
            var source = sourceDocument.RootElement;
            if (source.ValueKind != JsonValueKind.Object ||
                !source.TryGetProperty("documentType", out var documentType) ||
                documentType.ValueKind != JsonValueKind.String ||
                !source.TryGetProperty("copies", out var copies) ||
                !copies.TryGetInt32(out var copyCount) || copyCount is < 1 or > 5 ||
                !source.TryGetProperty("payload", out var payload) ||
                payload.ValueKind != JsonValueKind.Object)
            {
                return new(false, "rejected", "INVALID_PRINT_JOB", null, false);
            }
            var printerId = source.TryGetProperty("printerId", out var printer) &&
                printer.ValueKind == JsonValueKind.String
                ? printer.GetString()
                : null;
            var station = source.TryGetProperty("station", out var stationValue) &&
                stationValue.ValueKind == JsonValueKind.String
                ? stationValue.GetString()
                : "counter";
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(endpoint, "/v1/print-jobs"))
            {
                Content = JsonContent.Create(new
                {
                    idempotencyKey,
                    printerId,
                    station,
                    documentType = documentType.GetString(),
                    payload = payload.Clone(),
                    copies = copyCount,
                }),
            };
            request.Headers.Add("X-GiroMesa-Device-Token", token);
            using var response = await _httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
                return new(false, "failed", await ReadErrorCodeAsync(response), printerId, false);
            var result = await response.Content.ReadFromJsonAsync<PrintGatewayResult>();
            return result is null
                ? new(false, "failed", "PRINT_RESULT_MISSING", printerId, false)
                : new(
                    result.Success,
                    result.Status,
                    result.ErrorCode,
                    result.PrinterId ?? printerId,
                    result.Duplicate);
        }
        catch (JsonException)
        {
            return new(false, "rejected", "INVALID_PRINT_JOB_JSON", null, false);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, "failed", "HUB_PRINT_UNREACHABLE", null, false);
        }
    }

    public async Task<OperationalStateResult> GetPrintersAsync()
    {
        var endpoint = NormalizeHubUrl(Preferences.Default.Get(HubUrlPreference, string.Empty));
        var token = await SecureStorage.Default.GetAsync(DeviceTokenKey);
        if (endpoint is null || string.IsNullOrWhiteSpace(token))
            return new(false, null, "HUB_NOT_PAIRED");
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(endpoint, "/v1/printers"));
            request.Headers.Add("X-GiroMesa-Device-Token", token);
            using var response = await _httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
                return new(false, null, await ReadErrorCodeAsync(response));
            using var payload = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
            return new(true, payload.RootElement.Clone(), null);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, null, "HUB_PRINTERS_UNREACHABLE");
        }
    }

    public async Task<PrintBridgeResult> TestPrinterAsync(string printerId)
    {
        if (string.IsNullOrWhiteSpace(printerId) || printerId.Length > 80)
            return new(false, "rejected", "INVALID_PRINTER_ID", null, false);
        var endpoint = NormalizeHubUrl(Preferences.Default.Get(HubUrlPreference, string.Empty));
        var token = await SecureStorage.Default.GetAsync(DeviceTokenKey);
        if (endpoint is null || string.IsNullOrWhiteSpace(token))
            return new(false, "unavailable", "HUB_NOT_PAIRED", printerId, false);
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                new Uri(endpoint, $"/v1/printers/{Uri.EscapeDataString(printerId)}/test"));
            request.Headers.Add("X-GiroMesa-Device-Token", token);
            using var response = await _httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
                return new(false, "failed", await ReadErrorCodeAsync(response), printerId, false);
            var result = await response.Content.ReadFromJsonAsync<PrintGatewayResult>();
            return result is null
                ? new(false, "failed", "PRINT_RESULT_MISSING", printerId, false)
                : new(result.Success, result.Status, result.ErrorCode, result.PrinterId ?? printerId, result.Duplicate);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, "failed", "HUB_PRINT_UNREACHABLE", printerId, false);
        }
    }

    public Task<SmartPosPaymentCapabilities> GetPaymentCapabilitiesAsync() =>
        _smartPosPayments.GetCapabilitiesAsync();

    public Task<SmartPosPaymentResult> StartPaymentAsync(string attemptId) =>
        _smartPosPayments.StartAsync(attemptId);

    public Task<SmartPosPaymentResult> RecoverPaymentAsync(string attemptId) =>
        _smartPosPayments.RecoverAsync(attemptId);

    public Task<SmartPosPaymentResult> CancelPaymentAsync(string attemptId) =>
        _smartPosPayments.CancelAsync(attemptId);

    public Task<SmartPosPaymentResult> ReversePaymentAsync(string reversalId) =>
        _smartPosPayments.ReverseAsync(reversalId);

    public async Task<PaymentPairingBridgeResult> RedeemPaymentPairingAsync(
        string apiBaseUrl,
        string code)
    {
        var device = await GetDeviceContextAsync();
        var result = await _smartPosDeviceApi.RedeemPairingAsync(
            apiBaseUrl,
            code,
            device.DeviceId);
        return new(
            result.Success,
            result.InstallationId,
            result.Capabilities?.Provider,
            result.Capabilities?.Available ?? false,
            result.ErrorCode);
    }

    public Task<PendingPaymentPairingBridgeResult> ConsumePendingPaymentPairingAsync()
    {
        var pairing = SmartPosPairingDeepLinkInbox.Consume();
        if (pairing is null)
            return Task.FromResult(new PendingPaymentPairingBridgeResult(
                false,
                null,
                null,
                "SMARTPOS_PAIRING_LINK_NOT_AVAILABLE"));
        return Task.FromResult(new PendingPaymentPairingBridgeResult(
            true,
            pairing.ApiBaseUrl,
            pairing.Code,
            null));
    }

    public async Task<PaymentDeviceActionResult> RotatePaymentCredentialAsync()
    {
        var result = await _smartPosDeviceApi.RotateCredentialAsync();
        return new(result.Success, result.CredentialId, result.ErrorCode);
    }

    public async Task<PaymentDeviceActionResult> SyncPaymentDiagnosticsAsync()
    {
        var result = await _smartPosDeviceApi.SendDiagnosticsAsync();
        return new(result.Success, result.Value?.Provider, result.ErrorCode);
    }

    public async Task<PaymentOutboxBridgeResult> FlushPaymentResultsAsync()
    {
        var result = await _smartPosPayments.FlushResultsAsync();
        return new(result.Submitted, result.Quarantined, result.Remaining, result.ErrorCode);
    }

    public Task ClearPaymentPairingAsync() => _smartPosCredentialStore.ClearAsync();

    private static async Task<string> ReadErrorCodeAsync(HttpResponseMessage response)
    {
        try
        {
            var payload = await response.Content.ReadFromJsonAsync<HubError>();
            if (!string.IsNullOrWhiteSpace(payload?.Code)) return payload.Code;
        }
        catch (JsonException)
        {
            // The status code remains the safe fallback when the Hub did not return JSON.
        }
        return $"HUB_HTTP_{(int)response.StatusCode}";
    }

    private static Uri? NormalizeHubUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return null;
        }

        return uri;
    }

    public sealed record DeviceContext(string DeviceId, string DeviceName, string Platform, string HubUrl);
    public sealed record HubStatus(bool Online, string? HubUrl, string? ErrorCode);
    public sealed record PairingResult(bool Success, string? ErrorCode);
    public sealed record CommandResult(bool Success, bool Duplicate, string? ErrorCode, JsonElement? Result);
    public sealed record OperationalStateResult(bool Success, JsonElement? Payload, string? ErrorCode);
    public sealed record PrintBridgeResult(
        bool Success,
        string Status,
        string? ErrorCode,
        string? PrinterId,
        bool Duplicate);
    public sealed record PaymentPairingBridgeResult(
        bool Success,
        string? InstallationId,
        string? Provider,
        bool Available,
        string? ErrorCode);
    public sealed record PendingPaymentPairingBridgeResult(
        bool Available,
        string? ApiBaseUrl,
        string? Code,
        string? ErrorCode);
    public sealed record PaymentDeviceActionResult(bool Success, string? Reference, string? ErrorCode);
    public sealed record PaymentOutboxBridgeResult(
        int Submitted,
        int Quarantined,
        int Remaining,
        string? ErrorCode);
    private sealed record PairingPayload(string DeviceToken);
    private sealed record HubCommandResponse(bool Duplicate, JsonElement? Result);
    private sealed record PrintGatewayResult(
        bool Success,
        string Status,
        string? ErrorCode,
        int BytesWritten,
        string? PrinterId,
        bool Duplicate);
    private sealed record HubError(string Code);
}
