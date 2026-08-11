using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Security;

public sealed record PairDeviceRequest(string DeviceId, string DeviceName, string EnrollmentCode);
public sealed record PairResult(bool IsSuccess, string? Token, string? Error, int StatusCode);

public sealed class DeviceAuthenticator(IOptions<HubOptions> options, HubStore store, HubIdentity? hubIdentity = null)
{
    private readonly HubOptions _options = options.Value;

    public async Task<PairResult> PairAsync(PairDeviceRequest request, X509Certificate2? certificate = null)
    {
        if (string.IsNullOrWhiteSpace(_options.EnrollmentCode))
        {
            return new(false, null, "PAIRING_NOT_CONFIGURED", StatusCodes.Status503ServiceUnavailable);
        }

        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.DeviceName))
        {
            return new(false, null, "INVALID_DEVICE", StatusCodes.Status400BadRequest);
        }

        if (!HubTlsConfiguration.IsTrustedDeviceCertificate(certificate, _options) || hubIdentity?.State.Revoked == true)
        {
            return new(false, null, "HUB_MTLS_REQUIRED", StatusCodes.Status401Unauthorized);
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

    public async Task<bool> IsAuthorizedAsync(string? token, X509Certificate2? certificate = null) =>
        HubTlsConfiguration.IsTrustedDeviceCertificate(certificate, _options) &&
        hubIdentity?.State.Revoked != true &&
        !string.IsNullOrWhiteSpace(token) &&
        await store.HasActiveTokenAsync(Hash(token));

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
