using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace GiroMesa.EdgeHub.Security;

public static class HubTlsConfiguration
{
    public static void Validate(HubOptions options)
    {
        if (!options.RequireMutualTls) return;

        var server = RequireFingerprint(options.ServerCertificateThumbprint, "HUB_SERVER_CERTIFICATE_REQUIRED");
        var cloud = RequireFingerprint(options.CloudClientCertificateThumbprint, "HUB_CLOUD_CLIENT_CERTIFICATE_REQUIRED");
        if (options.DeviceClientCertificateThumbprints.Length == 0)
            throw new InvalidOperationException("HUB_DEVICE_CERTIFICATE_TRUST_REQUIRED");
        var devices = options.DeviceClientCertificateThumbprints
            .Select(value => RequireFingerprint(value, "HUB_DEVICE_CERTIFICATE_TRUST_INVALID"))
            .ToArray();
        if (devices.Distinct(StringComparer.Ordinal).Count() != devices.Length ||
            FixedEquals(server, cloud) ||
            devices.Any(device => FixedEquals(device, server) || FixedEquals(device, cloud)))
        {
            throw new InvalidOperationException("HUB_TLS_CERTIFICATE_ROLES_MUST_BE_DISTINCT");
        }
        if (!string.IsNullOrWhiteSpace(options.CloudApiBaseUrl) &&
            (!Uri.TryCreate(options.CloudApiBaseUrl, UriKind.Absolute, out var cloudUri) ||
             !string.Equals(cloudUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("HUB_CLOUD_HTTPS_REQUIRED");
        }
    }

    public static X509Certificate2 LoadServerCertificate(HubOptions options) =>
        LoadPrivateCertificate(
            options.ServerCertificateThumbprint,
            options.ServerCertificateStoreLocation,
            "HUB_SERVER_PRIVATE_CERTIFICATE_NOT_FOUND");

    public static X509Certificate2 LoadCloudClientCertificate(HubOptions options) =>
        LoadPrivateCertificate(
            options.CloudClientCertificateThumbprint,
            options.CloudClientCertificateStoreLocation,
            "HUB_CLOUD_CLIENT_PRIVATE_CERTIFICATE_NOT_FOUND");

    public static bool IsTrustedDeviceCertificate(X509Certificate2? certificate, HubOptions options)
    {
        if (!options.RequireMutualTls) return true;
        if (certificate is null || certificate.NotBefore > DateTime.UtcNow || certificate.NotAfter < DateTime.UtcNow)
            return false;
        var presented = NormalizeFingerprint(certificate.GetCertHashString(HashAlgorithmName.SHA256));
        return options.DeviceClientCertificateThumbprints.Any(candidate =>
            FixedEquals(presented, NormalizeFingerprint(candidate)));
    }

    public static string NormalizeFingerprint(string? value) =>
        new((value ?? string.Empty).Where(Uri.IsHexDigit).Select(char.ToUpperInvariant).ToArray());

    private static X509Certificate2 LoadPrivateCertificate(
        string? thumbprint,
        string storeLocation,
        string missingCode)
    {
        var location = string.Equals(storeLocation, "LocalMachine", StringComparison.OrdinalIgnoreCase)
            ? StoreLocation.LocalMachine
            : StoreLocation.CurrentUser;
        using var store = new X509Store(StoreName.My, location);
        store.Open(OpenFlags.ReadOnly);
        var expected = RequireFingerprint(thumbprint, missingCode);
        var certificate = store.Certificates
            .OfType<X509Certificate2>()
            .FirstOrDefault(candidate => candidate.HasPrivateKey &&
                candidate.NotBefore <= DateTime.UtcNow &&
                candidate.NotAfter >= DateTime.UtcNow &&
                FixedEquals(
                    NormalizeFingerprint(candidate.GetCertHashString(HashAlgorithmName.SHA256)),
                    expected));
        return certificate ?? throw new InvalidOperationException(missingCode);
    }

    private static string RequireFingerprint(string? value, string code)
    {
        var normalized = NormalizeFingerprint(value);
        if (normalized.Length != 64) throw new InvalidOperationException(code);
        return normalized;
    }

    private static bool FixedEquals(string left, string right)
    {
        var leftBytes = System.Text.Encoding.ASCII.GetBytes(left);
        var rightBytes = System.Text.Encoding.ASCII.GetBytes(right);
        return leftBytes.Length == rightBytes.Length &&
            CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
}
