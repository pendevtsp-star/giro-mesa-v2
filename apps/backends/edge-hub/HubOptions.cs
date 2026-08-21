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
    public int EmptySyncIntervalSeconds { get; init; } = 10;
    public int CloudRequestTimeoutSeconds { get; init; } = 10;
    public FocusOptions Focus { get; init; } = new();
    public PrinterOptions Printer { get; init; } = new();
    public List<PrinterOptions> Printers { get; init; } = [];

    public IReadOnlyList<PrinterOptions> AvailablePrinters =>
        Printers.Count > 0 ? Printers : [Printer];
}

public sealed class FocusOptions
{
    public bool Enabled { get; init; }
    public string Environment { get; init; } = "homologation";
    public string? Token { get; init; }
    public int RequestTimeoutSeconds { get; init; } = 20;
}

public sealed class PrinterOptions
{
    public bool Enabled { get; init; }
    public string Id { get; init; } = "default";
    public string Host { get; init; } = "";
    public int Port { get; init; } = 9100;
    public int PaperWidthMm { get; init; } = 80;
    public int CharactersPerLine { get; init; } = 48;
    public int CodeTable { get; init; } = 16;
    public bool Cut { get; init; } = true;
    public int TimeoutSeconds { get; init; } = 5;
    public bool Default { get; init; }
    public string? FallbackPrinterId { get; init; }
    public string[] Stations { get; init; } = [];
    public string[] DocumentTypes { get; init; } = [];
}
