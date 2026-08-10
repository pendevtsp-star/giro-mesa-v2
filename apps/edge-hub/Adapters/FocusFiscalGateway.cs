using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Adapters;

public sealed class FocusFiscalGateway(HttpClient httpClient, IOptions<HubOptions> hubOptions)
    : IFiscalGateway
{
    private const int MaxResponseBytes = 256 * 1024;
    private static readonly Uri HomologationBase = new("https://homologacao.focusnfe.com.br/");
    private static readonly Uri ProductionBase = new("https://api.focusnfe.com.br/");
    private readonly FocusOptions _options = hubOptions.Value.Focus;

    public CapabilityState Capability => IsConfigured
        ? new(true, "focus-nfe", $"Focus NFC-e configured for {NormalizedEnvironment}.")
        : new(false, "focus-nfe", "Focus NFe requires an explicit environment and company token.");

    private string NormalizedEnvironment => _options.Environment.Trim().ToLowerInvariant();

    private bool IsConfigured =>
        _options.Enabled &&
        _options.Token is { Length: >= 12 } &&
        (NormalizedEnvironment == "homologation" || NormalizedEnvironment == "production");

    private Uri BaseAddress => NormalizedEnvironment == "production" ? ProductionBase : HomologationBase;

    public async Task<FiscalResult> IssueAsync(
        FiscalRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
            return new(false, "unavailable", null, "FOCUS_NOT_CONFIGURED");
        if (!ValidRequest(request))
            return new(false, "rejected", null, "FOCUS_REQUEST_INVALID");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(_options.RequestTimeoutSeconds, 5, 60)));
        try
        {
            using var message = AuthorizedRequest(
                HttpMethod.Post,
                new Uri(BaseAddress, $"v2/nfce?ref={Uri.EscapeDataString(request.IdempotencyKey)}"));
            message.Content = new StringContent(request.DocumentPayload, Encoding.UTF8, "application/json");
            using var response = await httpClient.SendAsync(
                message,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
            var body = await ReadBoundedAsync(response, timeout.Token);
            if (response.StatusCode == HttpStatusCode.Created || response.IsSuccessStatusCode)
                return AuthorizedResult(body, request.IdempotencyKey);

            if (response.StatusCode == HttpStatusCode.UnprocessableEntity)
            {
                var existing = await ConsultAsync(request.IdempotencyKey, timeout.Token);
                if (existing is not null) return existing;
                return new(false, "rejected", null, "FOCUS_VALIDATION_ERROR");
            }
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return new(false, "unavailable", null, "FOCUS_AUTHENTICATION_FAILED");
            if ((int)response.StatusCode == 429 || (int)response.StatusCode >= 500)
                return new(false, "retryable", null, "FOCUS_TEMPORARILY_UNAVAILABLE");
            return new(false, "rejected", null, $"FOCUS_HTTP_{(int)response.StatusCode}");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(false, "retryable", null, "FOCUS_TIMEOUT");
        }
        catch (HttpRequestException)
        {
            return new(false, "retryable", null, "FOCUS_NETWORK_ERROR");
        }
        catch (InvalidDataException)
        {
            return new(false, "retryable", null, "FOCUS_RESPONSE_TOO_LARGE");
        }
        catch (JsonException)
        {
            return new(false, "retryable", null, "FOCUS_RESPONSE_INVALID");
        }
    }

    private async Task<FiscalResult?> ConsultAsync(string reference, CancellationToken cancellationToken)
    {
        using var message = AuthorizedRequest(
            HttpMethod.Get,
            new Uri(BaseAddress, $"v2/nfce/{Uri.EscapeDataString(reference)}"));
        using var response = await httpClient.SendAsync(
            message,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var body = await ReadBoundedAsync(response, cancellationToken);
        return response.IsSuccessStatusCode ? AuthorizedResult(body, reference) : null;
    }

    private HttpRequestMessage AuthorizedRequest(HttpMethod method, Uri uri)
    {
        var message = new HttpRequestMessage(method, uri);
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_options.Token}:"));
        message.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        message.Headers.UserAgent.ParseAdd("GiroMesa-EdgeHub/2.0");
        return message;
    }

    private static FiscalResult AuthorizedResult(string body, string fallbackReference)
    {
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new JsonException("Focus response is not an object.");
        var status = ReadString(document.RootElement, "status") ?? "authorized";
        var normalized = status.ToLowerInvariant();
        if (normalized == "autorizado")
        {
            var reference =
                ReadString(document.RootElement, "chave_nfe") ??
                ReadString(document.RootElement, "ref") ??
                fallbackReference;
            return new(true, status, reference, null);
        }
        if (normalized.Contains("erro") || normalized.Contains("cancelado") || normalized.Contains("rejeitado"))
            return new(false, "rejected", null, "FOCUS_DOCUMENT_REJECTED");
        return new(false, "retryable", fallbackReference, "FOCUS_PROCESSING");
    }

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool ValidRequest(FiscalRequest request)
    {
        if (request.IdempotencyKey.Length is < 8 or > 100 ||
            request.IdempotencyKey.Any(character =>
                !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.')) ||
            !Guid.TryParse(request.ActorIdentityId, out _) ||
            string.IsNullOrWhiteSpace(request.OrderId) ||
            request.TotalInCents <= 0 ||
            Encoding.UTF8.GetByteCount(request.DocumentPayload) > 1024 * 1024)
            return false;
        try
        {
            using var payload = JsonDocument.Parse(request.DocumentPayload);
            return payload.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static async Task<string> ReadBoundedAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength > MaxResponseBytes)
            throw new InvalidDataException("Focus response exceeded the configured limit.");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken);
            if (read == 0) break;
            if (buffer.Length + read > MaxResponseBytes)
                throw new InvalidDataException("Focus response exceeded the configured limit.");
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }
}
