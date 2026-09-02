using System.Net.Http.Json;

namespace GiroMesa.EdgeHub.Enrollment;

public sealed record CloudEnrollment(
    string DeviceId,
    string OrganizationId,
    string UnitId,
    string SyncKey);

public static class CloudEnrollmentClient
{
    public static string NormalizeCode(string value) =>
        new(value.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    public static async Task<CloudEnrollment> RedeemAsync(
        HttpClient client,
        Uri apiBaseUrl,
        string code,
        CancellationToken cancellationToken = default)
    {
        var normalizedCode = NormalizeCode(code);
        if (normalizedCode.Length != 8)
            throw new ArgumentException("O código deve ter 8 caracteres.", nameof(code));
        if (apiBaseUrl.Scheme != Uri.UriSchemeHttps && !apiBaseUrl.IsLoopback)
            throw new ArgumentException("A conexão com a nuvem deve usar HTTPS.", nameof(apiBaseUrl));

        using var response = await client.PostAsJsonAsync(
            new Uri(apiBaseUrl, "/api/v1/device/edge-hub-pairings/redeem"),
            new { code = normalizedCode },
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var codeValue = await ReadErrorCodeAsync(response, cancellationToken);
            throw new InvalidOperationException(codeValue switch
            {
                "EDGE_HUB_PAIRING_INVALID_OR_EXPIRED" =>
                    "O código venceu ou já foi usado. Gere um novo código no GiroMesa.",
                _ => "Não foi possível conectar este computador ao GiroMesa.",
            });
        }
        return await response.Content.ReadFromJsonAsync<CloudEnrollment>(cancellationToken)
            ?? throw new InvalidOperationException("A nuvem devolveu uma resposta vazia.");
    }

    private static async Task<string?> ReadErrorCodeAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        try
        {
            return (await response.Content.ReadFromJsonAsync<EnrollmentError>(cancellationToken))?.Code;
        }
        catch
        {
            return null;
        }
    }

    private sealed record EnrollmentError(string Code);
}
