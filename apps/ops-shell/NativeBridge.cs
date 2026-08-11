using System.Net.Http.Json;
using System.Text.Json;

namespace GiroMesa.OpsShell;

public sealed class NativeBridge
{
    private const string HubUrlPreference = "hub_url";
    private const string DeviceTokenKey = "hub_device_token";
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(3) };

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
        if (resource == "kds") return await GetKdsDispatchStateAsync();

        var path = resource switch
        {
            "catalog" => "/v1/operational-state/catalog",
            "floor" => "/v1/operational-state/floor",
            "tabs" => "/v1/operational-state/tabs",
            "tab" when Guid.TryParse(resourceId, out _) => $"/v1/operational-state/tabs/{resourceId}",
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

    public async Task<KdsAcknowledgementResult> AcknowledgeKdsDispatchAsync(
        string effectId,
        string deliveryKey)
    {
        if (!Guid.TryParse(effectId, out _) || string.IsNullOrWhiteSpace(deliveryKey))
        {
            return new(false, "INVALID_KDS_ACKNOWLEDGEMENT");
        }

        var endpoint = NormalizeHubUrl(Preferences.Default.Get(HubUrlPreference, string.Empty));
        var token = await SecureStorage.Default.GetAsync(DeviceTokenKey);
        var deviceId = Preferences.Default.Get("device_id", string.Empty);
        if (endpoint is null || string.IsNullOrWhiteSpace(token) || !Guid.TryParse(deviceId, out _))
        {
            return new(false, "HUB_NOT_PAIRED");
        }

        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                new Uri(endpoint, $"/v1/dispatch/{Uri.EscapeDataString(effectId)}/ack"))
            {
                Content = JsonContent.Create(new
                {
                    acknowledgementKey = $"ops-kds:{deviceId}:{deliveryKey}",
                }),
            };
            request.Headers.Add("X-GiroMesa-Device-Token", token);
            using var response = await _httpClient.SendAsync(request);
            return response.IsSuccessStatusCode
                ? new(true, null)
                : new(false, await ReadErrorCodeAsync(response));
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, "HUB_ACK_UNREACHABLE");
        }
    }

    private async Task<OperationalStateResult> GetKdsDispatchStateAsync()
    {
        var endpoint = NormalizeHubUrl(Preferences.Default.Get(HubUrlPreference, string.Empty));
        var token = await SecureStorage.Default.GetAsync(DeviceTokenKey);
        if (endpoint is null || string.IsNullOrWhiteSpace(token))
        {
            return new(false, null, "HUB_NOT_PAIRED");
        }

        try
        {
            var snapshot = await GetAuthenticatedJsonAsync(endpoint, token, "/v1/operational-state/kds");
            if (!snapshot.Success) return new(false, null, snapshot.ErrorCode);
            var deliveries = await GetAuthenticatedJsonAsync(endpoint, token, "/v1/dispatch/kds");
            if (!deliveries.Success) return new(false, null, deliveries.ErrorCode);
            var payload = JsonSerializer.SerializeToElement(new
            {
                snapshot = snapshot.Payload,
                deliveries = deliveries.Payload,
            });
            return new(true, payload, null);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return new(false, null, "KDS_EDGE_UNREACHABLE");
        }
    }

    private async Task<OperationalStateResult> GetAuthenticatedJsonAsync(
        Uri endpoint,
        string token,
        string path)
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
    public sealed record KdsAcknowledgementResult(bool Success, string? ErrorCode);
    private sealed record PairingPayload(string DeviceToken);
    private sealed record HubCommandResponse(bool Duplicate, JsonElement? Result);
    private sealed record HubError(string Code);
}
