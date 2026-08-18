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

    private string NormalizedEnvironment => (_options.Environment ?? string.Empty).Trim().ToLowerInvariant();

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

        return await ExecuteAsync(async timeoutToken =>
        {
            using var message = AuthorizedRequest(
                HttpMethod.Post,
                new Uri(BaseAddress, $"v2/nfce?ref={Uri.EscapeDataString(request.IdempotencyKey)}"));
            message.Content = new StringContent(request.DocumentPayload, Encoding.UTF8, "application/json");
            using var response = await httpClient.SendAsync(
                message,
                HttpCompletionOption.ResponseHeadersRead,
                timeoutToken);
            var body = await ReadBoundedAsync(response, timeoutToken);
            if (response.StatusCode == HttpStatusCode.Created || response.IsSuccessStatusCode)
                return DocumentResult(body, request.IdempotencyKey);

            if (response.StatusCode == HttpStatusCode.UnprocessableEntity)
            {
                var existing = await ConsultCoreAsync(request.IdempotencyKey, timeoutToken);
                if (existing.Status != "not_found")
                {
                    return existing.Status == "canceled"
                        ? new(false, "rejected", request.IdempotencyKey, "FOCUS_REFERENCE_CONFLICT")
                        : existing;
                }
                return new(false, "rejected", null, "FOCUS_VALIDATION_ERROR");
            }
            return HttpFailure(response.StatusCode, request.IdempotencyKey);
        }, cancellationToken, request.IdempotencyKey);
    }

    public async Task<FiscalResult> ConsultAsync(
        FiscalConsultRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
            return new(false, "unavailable", request.DocumentReference, "FOCUS_NOT_CONFIGURED");
        if (!ValidActor(request.ActorIdentityId) || !ValidReference(request.DocumentReference))
            return new(false, "rejected", request.DocumentReference, "FOCUS_REQUEST_INVALID");

        return await ExecuteAsync(
            timeoutToken => ConsultCoreAsync(request.DocumentReference, timeoutToken),
            cancellationToken,
            request.DocumentReference);
    }

    public async Task<FiscalResult> CancelAsync(
        string documentReference,
        FiscalCancellationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
            return new(false, "unavailable", documentReference, "FOCUS_NOT_CONFIGURED");
        if (!ValidActor(request.ActorIdentityId) ||
            !ValidReference(documentReference) ||
            !ValidJustification(request.Justification))
            return new(false, "rejected", documentReference, "FOCUS_REQUEST_INVALID");

        return await ExecuteAsync(async timeoutToken =>
        {
            using var message = AuthorizedRequest(
                HttpMethod.Delete,
                new Uri(BaseAddress, $"v2/nfce/{Uri.EscapeDataString(documentReference)}"));
            message.Content = JsonContent(new { justificativa = request.Justification.Trim() });
            using var response = await httpClient.SendAsync(
                message,
                HttpCompletionOption.ResponseHeadersRead,
                timeoutToken);
            var body = await ReadBoundedAsync(response, timeoutToken);
            if (response.IsSuccessStatusCode)
                return CancellationResult(body, documentReference);

            if (response.StatusCode == HttpStatusCode.UnprocessableEntity)
            {
                var existing = await ConsultCoreAsync(documentReference, timeoutToken);
                return existing.Status == "canceled"
                    ? existing
                    : new(false, "rejected", documentReference, "FOCUS_CANCELLATION_REJECTED");
            }
            return HttpFailure(response.StatusCode, documentReference);
        }, cancellationToken, documentReference);
    }

    public async Task<FiscalResult> InvalidateNumbersAsync(
        FiscalNumberInvalidationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
            return new(false, "unavailable", request.IdempotencyKey, "FOCUS_NOT_CONFIGURED");
        if (!ValidInvalidation(request))
            return new(false, "rejected", request.IdempotencyKey, "FOCUS_REQUEST_INVALID");

        return await ExecuteAsync(async timeoutToken =>
        {
            using var message = AuthorizedRequest(
                HttpMethod.Post,
                new Uri(BaseAddress, "v2/nfce/inutilizacao"));
            message.Content = JsonContent(new
            {
                cnpj = request.Cnpj.Trim().ToUpperInvariant(),
                serie = request.Series.Trim(),
                numero_inicial = request.InitialNumber,
                numero_final = request.FinalNumber,
                justificativa = request.Justification.Trim(),
            });
            using var response = await httpClient.SendAsync(
                message,
                HttpCompletionOption.ResponseHeadersRead,
                timeoutToken);
            var body = await ReadBoundedAsync(response, timeoutToken);
            var result = response.IsSuccessStatusCode
                ? InvalidationResult(body, request.IdempotencyKey)
                : HttpFailure(response.StatusCode, request.IdempotencyKey);
            if (result.Success ||
                response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.UnprocessableEntity))
                return result;

            var existing = await ConsultInvalidationCoreAsync(request, timeoutToken);
            return existing ?? result;
        }, cancellationToken, request.IdempotencyKey);
    }

    private async Task<FiscalResult> ExecuteAsync(
        Func<CancellationToken, Task<FiscalResult>> operation,
        CancellationToken cancellationToken,
        string reference)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(_options.RequestTimeoutSeconds, 5, 60)));
        try
        {
            return await operation(timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(false, "retryable", reference, "FOCUS_TIMEOUT");
        }
        catch (HttpRequestException)
        {
            return new(false, "retryable", reference, "FOCUS_NETWORK_ERROR");
        }
        catch (InvalidDataException)
        {
            return new(false, "retryable", reference, "FOCUS_RESPONSE_TOO_LARGE");
        }
        catch (JsonException)
        {
            return new(false, "retryable", reference, "FOCUS_RESPONSE_INVALID");
        }
    }

    private async Task<FiscalResult> ConsultCoreAsync(string reference, CancellationToken cancellationToken)
    {
        using var message = AuthorizedRequest(
            HttpMethod.Get,
            new Uri(BaseAddress, $"v2/nfce/{Uri.EscapeDataString(reference)}"));
        using var response = await httpClient.SendAsync(
            message,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var body = await ReadBoundedAsync(response, cancellationToken);
        return response.IsSuccessStatusCode
            ? DocumentResult(body, reference)
            : HttpFailure(response.StatusCode, reference);
    }

    private async Task<FiscalResult?> ConsultInvalidationCoreAsync(
        FiscalNumberInvalidationRequest request,
        CancellationToken cancellationToken)
    {
        var cnpj = Uri.EscapeDataString(request.Cnpj.Trim().ToUpperInvariant());
        using var message = AuthorizedRequest(
            HttpMethod.Get,
            new Uri(
                BaseAddress,
                $"v2/nfce/inutilizacoes?cnpj={cnpj}&numero_inicial={request.InitialNumber}&numero_final={request.FinalNumber}"));
        using var response = await httpClient.SendAsync(
            message,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var body = await ReadBoundedAsync(response, cancellationToken);
        if (!response.IsSuccessStatusCode) return null;

        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Array)
            throw new JsonException("Focus invalidation query response is not an array.");
        var expectedCnpj = request.Cnpj.Trim().ToUpperInvariant();
        var expectedSeries = request.Series.Trim();
        var expectedInitial = request.InitialNumber.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var expectedFinal = request.FinalNumber.ToString(System.Globalization.CultureInfo.InvariantCulture);
        foreach (var item in document.RootElement.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object &&
                NormalizeStatus(item) == "autorizado" &&
                ReadString(item, "cnpj")?.ToUpperInvariant() == expectedCnpj &&
                ReadStringOrNumber(item, "serie") == expectedSeries &&
                ReadStringOrNumber(item, "numero_inicial") == expectedInitial &&
                ReadStringOrNumber(item, "numero_final") == expectedFinal)
            {
                return new(
                    true,
                    "invalidated",
                    ReadString(item, "protocolo_sefaz") ?? request.IdempotencyKey,
                    null);
            }
        }
        return null;
    }

    private HttpRequestMessage AuthorizedRequest(HttpMethod method, Uri uri)
    {
        var message = new HttpRequestMessage(method, uri);
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_options.Token}:"));
        message.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        message.Headers.UserAgent.ParseAdd("GiroMesa-EdgeHub/2.0");
        return message;
    }

    private static FiscalResult DocumentResult(string body, string fallbackReference)
    {
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new JsonException("Focus response is not an object.");
        var normalized = NormalizeStatus(document.RootElement);
        var reference =
            ReadString(document.RootElement, "chave_nfe") ??
            ReadString(document.RootElement, "ref") ??
            fallbackReference;
        if (normalized == "autorizado")
            return new(true, "authorized", reference, null);
        if (normalized is "cancelado" or "cancelada")
            return new(true, "canceled", reference, null);
        if (normalized.Contains("erro", StringComparison.Ordinal) ||
            normalized.Contains("rejeitado", StringComparison.Ordinal))
            return new(false, "rejected", reference, "FOCUS_DOCUMENT_REJECTED");
        return new(false, "processing", reference, "FOCUS_PROCESSING");
    }

    private static FiscalResult CancellationResult(string body, string fallbackReference)
    {
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new JsonException("Focus response is not an object.");
        var normalized = NormalizeStatus(document.RootElement);
        return normalized is "cancelado" or "cancelada"
            ? new(true, "canceled", fallbackReference, null)
            : normalized.Contains("erro", StringComparison.Ordinal) ||
              normalized.Contains("rejeitado", StringComparison.Ordinal)
                ? new(false, "rejected", fallbackReference, "FOCUS_CANCELLATION_REJECTED")
                : new(false, "processing", fallbackReference, "FOCUS_CANCELLATION_UNCONFIRMED");
    }

    private static FiscalResult InvalidationResult(string body, string fallbackReference)
    {
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new JsonException("Focus response is not an object.");
        var normalized = NormalizeStatus(document.RootElement);
        var reference = ReadString(document.RootElement, "protocolo_sefaz") ?? fallbackReference;
        return normalized == "autorizado"
            ? new(true, "invalidated", reference, null)
            : normalized.Contains("erro", StringComparison.Ordinal) ||
              normalized.Contains("rejeitado", StringComparison.Ordinal)
                ? new(false, "rejected", reference, "FOCUS_INVALIDATION_REJECTED")
                : new(false, "processing", reference, "FOCUS_INVALIDATION_UNCONFIRMED");
    }

    private static string NormalizeStatus(JsonElement root) =>
        (ReadString(root, "status") ?? string.Empty).Trim().ToLowerInvariant();

    private static FiscalResult HttpFailure(HttpStatusCode statusCode, string? reference)
    {
        if (statusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return new(false, "unavailable", reference, "FOCUS_AUTHENTICATION_FAILED");
        if (statusCode == HttpStatusCode.NotFound)
            return new(false, "not_found", reference, "FOCUS_DOCUMENT_NOT_FOUND");
        if ((int)statusCode == 429 || (int)statusCode >= 500)
            return new(false, "retryable", reference, "FOCUS_TEMPORARILY_UNAVAILABLE");
        return new(false, "rejected", reference, $"FOCUS_HTTP_{(int)statusCode}");
    }

    private static StringContent JsonContent(object value) =>
        new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? ReadStringOrNumber(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };
    }

    private static bool ValidRequest(FiscalRequest request)
    {
        if (!ValidReference(request.IdempotencyKey) ||
            !ValidActor(request.ActorIdentityId) ||
            !Guid.TryParse(request.OrderId, out _) ||
            request.TotalInCents <= 0 ||
            request.DocumentPayload is not { } documentPayload ||
            Encoding.UTF8.GetByteCount(documentPayload) > 1024 * 1024)
            return false;
        try
        {
            using var payload = JsonDocument.Parse(documentPayload);
            return payload.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool ValidInvalidation(FiscalNumberInvalidationRequest request) =>
        ValidActor(request.ActorIdentityId) &&
        ValidReference(request.IdempotencyKey) &&
        request.Cnpj is { } cnpj &&
        cnpj.Trim().Length == 14 &&
        cnpj.Trim()[..12].All(char.IsAsciiLetterOrDigit) &&
        cnpj.Trim()[12..].All(char.IsAsciiDigit) &&
        request.Series is { } series &&
        series.Trim().Length is >= 1 and <= 3 &&
        series.Trim().All(char.IsAsciiDigit) &&
        request.InitialNumber > 0 &&
        request.FinalNumber >= request.InitialNumber &&
        ValidJustification(request.Justification);

    private static bool ValidActor(string? actorIdentityId) =>
        Guid.TryParse(actorIdentityId, out _);

    private static bool ValidReference(string? reference) =>
        reference is not null &&
        reference.Length is >= 8 and <= 100 &&
        reference.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.');

    private static bool ValidJustification(string? justification) =>
        justification is not null &&
        justification.Trim().Length is >= 15 and <= 255;

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
