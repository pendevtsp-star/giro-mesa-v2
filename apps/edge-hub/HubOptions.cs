namespace GiroMesa.EdgeHub;

public sealed record HubOptions
{
    public const string Section = "Hub";

    public string UnitId { get; init; } = "unconfigured";
    public string? InstallationId { get; init; }
    public string DataDirectory { get; init; } = "data";
    public string? DatabaseKey { get; init; }
    public string? EnrollmentCode { get; init; }
    public bool RequireMutualTls { get; init; } = true;
    public int HttpsPort { get; init; } = 43120;
    public string? ServerCertificateThumbprint { get; init; }
    public string ServerCertificateStoreLocation { get; init; } = "LocalMachine";
    public string? CloudClientCertificateThumbprint { get; init; }
    public string CloudClientCertificateStoreLocation { get; init; } = "LocalMachine";
    public string[] DeviceClientCertificateThumbprints { get; init; } = [];
    public long MinimumFreeDiskBytes { get; init; } = 536_870_912;
    public int MaximumClockSkewSeconds { get; init; } = 120;
    public string? BackupDirectory { get; init; }
    public string? CloudApiBaseUrl { get; init; }
    public string? CloudSyncKey { get; init; }
    public int SyncIntervalSeconds { get; init; } = 5;
    public int CloudRequestTimeoutSeconds { get; init; } = 10;
    public FocusOptions Focus { get; init; } = new();
}

public sealed class FocusOptions
{
    public bool Enabled { get; init; }
    public string Environment { get; init; } = "homologation";
    public string? Token { get; init; }
    public int RequestTimeoutSeconds { get; init; } = 20;
}
