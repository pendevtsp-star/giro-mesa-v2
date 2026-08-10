using System.Security.Cryptography;
using System.Text;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Security;

public sealed record PairDeviceRequest(string DeviceId, string DeviceName, string EnrollmentCode);
public sealed record PairResult(bool IsSuccess, string? Token, string? Error, int StatusCode);

public sealed class DeviceAuthenticator(IOptions<HubOptions> options, HubStore store)
{
    private readonly HubOptions _options = options.Value;

    public async Task<PairResult> PairAsync(PairDeviceRequest request)
    {
        if (string.IsNullOrWhiteSpace(_options.EnrollmentCode))
        {
            return new(false, null, "PAIRING_NOT_CONFIGURED", StatusCodes.Status503ServiceUnavailable);
        }

        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.DeviceName))
        {
            return new(false, null, "INVALID_DEVICE", StatusCodes.Status400BadRequest);
        }

        var expected = Encoding.UTF8.GetBytes(_options.EnrollmentCode);
        var provided = Encoding.UTF8.GetBytes(request.EnrollmentCode ?? string.Empty);
        if (expected.Length != provided.Length || !CryptographicOperations.FixedTimeEquals(expected, provided))
        {
            return new(false, null, "INVALID_ENROLLMENT_CODE", StatusCodes.Status401Unauthorized);
        }

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await store.SavePairedDeviceAsync(Hash(token), request.DeviceId, request.DeviceName);
        return new(true, token, null, StatusCodes.Status200OK);
    }

    public async Task<bool> IsAuthorizedAsync(string? token) =>
        !string.IsNullOrWhiteSpace(token) && await store.HasActiveTokenAsync(Hash(token));

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
