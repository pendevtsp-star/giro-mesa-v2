using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GiroMesa.EdgeHub.Security;

public sealed record MachineConfiguration(
    string DeviceId,
    string OrganizationId,
    string UnitId,
    string CloudApiBaseUrl,
    string CloudSyncKey,
    string DatabaseKey,
    string DataDirectory);

public static class MachineConfigurationStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("GiroMesa.EdgeHub.v1");

    public static string ConfigurationPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "GiroMesa",
        "EdgeHub",
        "enrollment.bin");

    public static void Save(MachineConfiguration configuration, string? path = null)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Protected Edge Hub configuration requires Windows.");
        var target = path ?? ConfigurationPath;
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var clear = JsonSerializer.SerializeToUtf8Bytes(configuration);
        try
        {
            var encrypted = ProtectedData.Protect(clear, Entropy, DataProtectionScope.LocalMachine);
            var temporary = $"{target}.{Guid.NewGuid():N}.tmp";
            File.WriteAllBytes(temporary, encrypted);
            File.Move(temporary, target, true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(clear);
        }
    }

    public static MachineConfiguration? TryLoad(string? path = null)
    {
        if (!OperatingSystem.IsWindows()) return null;
        var target = path ?? ConfigurationPath;
        if (!File.Exists(target)) return null;
        var encrypted = File.ReadAllBytes(target);
        var clear = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.LocalMachine);
        try
        {
            var configuration = JsonSerializer.Deserialize<MachineConfiguration>(clear);
            return IsComplete(configuration) ? configuration : null;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(clear);
        }
    }

    private static bool IsComplete(MachineConfiguration? configuration) =>
        configuration is not null &&
        Guid.TryParse(configuration.DeviceId, out _) &&
        Guid.TryParse(configuration.OrganizationId, out _) &&
        Guid.TryParse(configuration.UnitId, out _) &&
        Uri.TryCreate(configuration.CloudApiBaseUrl, UriKind.Absolute, out var api) &&
        (api.Scheme == Uri.UriSchemeHttps || api.Scheme == Uri.UriSchemeHttp) &&
        !string.IsNullOrWhiteSpace(configuration.CloudSyncKey) &&
        !string.IsNullOrWhiteSpace(configuration.DatabaseKey) &&
        !string.IsNullOrWhiteSpace(configuration.DataDirectory);
}
