using System.Security.Cryptography;

namespace GiroMesa.OpsShell;

internal sealed record SmartPosDeviceDiagnostics(
    string Manufacturer,
    string Model,
    string AndroidVersion,
    string FirmwareVersion,
    string AppVersion,
    string PackageName,
    string? SigningCertificateSha256);

internal interface ISmartPosDeviceDiagnosticsProvider
{
    Task<SmartPosDeviceDiagnostics> CollectAsync();
}

internal sealed class MauiSmartPosDeviceDiagnosticsProvider : ISmartPosDeviceDiagnosticsProvider
{
    public Task<SmartPosDeviceDiagnostics> CollectAsync()
    {
        var packageName = AppInfo.Current.PackageName;
        return Task.FromResult(new SmartPosDeviceDiagnostics(
            Normalize(DeviceInfo.Current.Manufacturer, "unknown", 120),
            Normalize(DeviceInfo.Current.Model, "unknown", 120),
            Normalize(DeviceInfo.Current.VersionString, "unknown", 64),
            FirmwareVersion(),
            $"{Normalize(AppInfo.Current.VersionString, "unknown", 30)}+{Normalize(AppInfo.Current.BuildString, "unknown", 30)}",
            Normalize(packageName, "unknown", 160),
            SigningCertificateSha256(packageName)));
    }

    private static string FirmwareVersion()
    {
#if ANDROID
        return Normalize(Android.OS.Build.Display, "unknown", 120);
#else
        return Normalize(DeviceInfo.Current.VersionString, "unknown", 120);
#endif
    }

    private static string? SigningCertificateSha256(string packageName)
    {
#if ANDROID
        try
        {
            var packageManager = Android.App.Application.Context.PackageManager;
            if (packageManager is null) return null;
            var packageInfo = OperatingSystem.IsAndroidVersionAtLeast(28)
                ? packageManager.GetPackageInfo(
                    packageName,
                    Android.Content.PM.PackageInfoFlags.SigningCertificates)
                : packageManager.GetPackageInfo(
                    packageName,
                    Android.Content.PM.PackageInfoFlags.Signatures);
            if (packageInfo is null) return null;
            var signature = OperatingSystem.IsAndroidVersionAtLeast(28)
                ? packageInfo.SigningInfo?.GetApkContentsSigners()?.FirstOrDefault()
                : packageInfo.Signatures?.FirstOrDefault();
            var signatureBytes = signature?.ToByteArray();
            return signatureBytes is null
                ? null
                : Convert.ToHexString(SHA256.HashData(signatureBytes)).ToLowerInvariant();
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return null;
        }
#else
        return null;
#endif
    }

    private static string Normalize(string? value, string fallback, int maximumLength)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        return normalized[..Math.Min(normalized.Length, maximumLength)];
    }
}
