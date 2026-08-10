namespace GiroMesa.EdgeHub;

public sealed class HubOptions
{
    public const string Section = "Hub";

    public string UnitId { get; init; } = "unconfigured";
    public string DataDirectory { get; init; } = "data";
    public string? DatabaseKey { get; init; }
    public string? EnrollmentCode { get; init; }
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
