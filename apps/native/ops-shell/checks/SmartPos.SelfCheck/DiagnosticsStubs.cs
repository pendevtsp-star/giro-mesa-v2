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
