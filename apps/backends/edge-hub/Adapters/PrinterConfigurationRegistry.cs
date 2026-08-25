using System.Net;
using System.Text.RegularExpressions;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Adapters;

public sealed record PrinterConfigurationMutation(
    string Host,
    int Port,
    int PaperWidthMm,
    int CharactersPerLine,
    int CodeTable,
    bool Cut,
    bool SupportsRasterGraphics,
    bool IsDefault,
    string[] StationIds,
    string[] DocumentTypes,
    string? FallbackPrinterId = null,
    int TimeoutSeconds = 5);

public sealed record StoredPrinterConfiguration(
    string Id,
    string Host,
    int Port,
    int PaperWidthMm,
    int CharactersPerLine,
    int CodeTable,
    bool Cut,
    bool SupportsRasterGraphics,
    bool IsDefault,
    string[] StationIds,
    string[] DocumentTypes,
    string[] LegacyStationNames,
    string? FallbackPrinterId,
    int TimeoutSeconds,
    int Revision,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? ArchivedAt,
    string UpdatedBy,
    string Source)
{
    public PrinterOptions ToOptions() => new()
    {
        Enabled = ArchivedAt is null,
        Id = Id,
        Host = Host,
        Port = Port,
        PaperWidthMm = PaperWidthMm,
        CharactersPerLine = CharactersPerLine,
        CodeTable = CodeTable,
        Cut = Cut,
        SupportsRasterGraphics = SupportsRasterGraphics,
        TimeoutSeconds = TimeoutSeconds,
        Default = IsDefault,
        FallbackPrinterId = FallbackPrinterId,
        StationIds = StationIds,
        Stations = LegacyStationNames,
        DocumentTypes = DocumentTypes,
    };
}

public sealed record PrinterConfigurationDiagnostics(
    int ActivePrinters,
    string? DefaultPrinterId,
    IReadOnlyList<string> Issues);

public sealed record AppliedPrinterConfiguration(
    StoredPrinterConfiguration Configuration,
    bool Duplicate);

public sealed class PrinterConfigurationException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

public sealed class PrinterConfigurationRegistry(
    HubStore store,
    IOptions<HubOptions> options,
    ILogger<PrinterConfigurationRegistry> logger)
{
    private static readonly Regex SafeId = new(
        "^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly HashSet<string> SupportedDocumentTypes = new(
        ["partial_statement", "payment_statement", "final_receipt", "kds_ticket"],
        StringComparer.Ordinal);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly HubOptions _options = options.Value;
    private IReadOnlyList<StoredPrinterConfiguration> _configurations = [];

    public IReadOnlyList<PrinterOptions> ActivePrinters =>
        _configurations.Where(item => item.ArchivedAt is null).Select(item => item.ToOptions()).ToArray();

    public async Task InitializeAsync()
    {
        await _gate.WaitAsync();
        try
        {
            var persisted = await store.GetPrinterConfigurationsAsync(includeArchived: true);
            if (persisted.Count == 0)
            {
                var bootstrap = BuildBootstrap(_options.AvailablePrinters);
                if (bootstrap.Count > 0)
                {
                    var issues = ValidateCollection(bootstrap);
                    if (issues.Count > 0)
                    {
                        logger.LogError(
                            "Static printer bootstrap was rejected: {Issues}",
                            string.Join(", ", issues));
                    }
                    else
                    {
                        await store.SeedPrinterConfigurationsAsync(bootstrap);
                    }
                }
                persisted = await store.GetPrinterConfigurationsAsync(includeArchived: true);
            }
            _configurations = persisted;
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task<IReadOnlyList<StoredPrinterConfiguration>> ListAsync(bool includeArchived = false) =>
        Task.FromResult<IReadOnlyList<StoredPrinterConfiguration>>(
            _configurations.Where(item => includeArchived || item.ArchivedAt is null).ToArray());

    public PrinterConfigurationDiagnostics Diagnose()
    {
        var active = _configurations.Where(item => item.ArchivedAt is null).ToArray();
        var issues = ValidateCollection(active);
        return new(
            active.Length,
            active.SingleOrDefault(item => item.IsDefault)?.Id,
            issues);
    }

    public async Task<AppliedPrinterConfiguration> ApplyCloudUpsertAsync(
        string printerId,
        int revision,
        PrinterConfigurationMutation mutation,
        string cloudCommandId)
    {
        if (revision < 1) throw new PrinterConfigurationException("PRINTER_CONFIGURATION_REVISION_INVALID");
        await _gate.WaitAsync();
        try
        {
            var id = NormalizeId(printerId);
            var all = (await store.GetPrinterConfigurationsAsync(includeArchived: true)).ToList();
            var existing = all.SingleOrDefault(item =>
                item.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
            if (existing is not null && existing.Revision >= revision)
            {
                if (existing.Revision == revision && existing.ArchivedAt is null &&
                    ConfigurationMatches(existing, mutation))
                    return new(existing, true);
                throw new PrinterConfigurationException("PRINTER_CONFIGURATION_STALE");
            }

            var now = DateTimeOffset.UtcNow;
            var candidate = new StoredPrinterConfiguration(
                id,
                mutation.Host?.Trim() ?? "",
                mutation.Port,
                mutation.PaperWidthMm,
                mutation.CharactersPerLine,
                mutation.CodeTable,
                mutation.Cut,
                mutation.SupportsRasterGraphics,
                mutation.IsDefault,
                NormalizeStationIds(mutation.StationIds),
                NormalizeDocumentTypes(mutation.DocumentTypes),
                existing?.LegacyStationNames ?? [],
                NormalizeOptionalId(mutation.FallbackPrinterId),
                mutation.TimeoutSeconds,
                revision,
                existing?.CreatedAt ?? now,
                now,
                null,
                cloudCommandId,
                "cloud-command");
            var itemIssues = Validate(candidate);
            if (itemIssues.Count > 0) throw new PrinterConfigurationException(itemIssues[0]);
            var previousDefaultIds = candidate.IsDefault
                ? all.Where(item => item.ArchivedAt is null && item.IsDefault &&
                        !item.Id.Equals(candidate.Id, StringComparison.OrdinalIgnoreCase))
                    .Select(item => item.Id)
                    .ToArray()
                : [];
            all.RemoveAll(item => item.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
            if (candidate.IsDefault)
            {
                all = all.Select(item => item.ArchivedAt is null && item.IsDefault
                    ? item with { IsDefault = false }
                    : item).ToList();
            }
            all.Add(candidate);
            var collectionIssues = ValidateCollection(all.Where(item => item.ArchivedAt is null).ToArray());
            if (collectionIssues.Count > 0)
                throw new PrinterConfigurationException(collectionIssues[0]);
            var saved = await store.UpsertPrinterConfigurationAsync(
                candidate,
                existing?.Revision,
                previousDefaultIds);
            _configurations = await store.GetPrinterConfigurationsAsync(includeArchived: true);
            return new(saved, false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<AppliedPrinterConfiguration> ApplyCloudArchiveAsync(
        string printerId,
        int revision,
        string cloudCommandId)
    {
        if (revision < 1) throw new PrinterConfigurationException("PRINTER_CONFIGURATION_REVISION_INVALID");
        await _gate.WaitAsync();
        try
        {
            var id = NormalizeId(printerId);
            var all = (await store.GetPrinterConfigurationsAsync(includeArchived: true)).ToList();
            var existing = all.SingleOrDefault(item =>
                item.Id.Equals(id, StringComparison.OrdinalIgnoreCase))
                ?? throw new PrinterConfigurationException("PRINTER_CONFIGURATION_NOT_FOUND");
            if (existing.Revision >= revision)
            {
                if (existing.Revision == revision && existing.ArchivedAt is not null)
                    return new(existing, true);
                throw new PrinterConfigurationException("PRINTER_CONFIGURATION_STALE");
            }
            if (existing.ArchivedAt is null && all.Any(item => item.ArchivedAt is null &&
                item.FallbackPrinterId?.Equals(id, StringComparison.OrdinalIgnoreCase) == true))
                throw new PrinterConfigurationException("PRINTER_CONFIGURATION_IN_USE_AS_FALLBACK");
            if (existing.ArchivedAt is null && existing.IsDefault &&
                all.Count(item => item.ArchivedAt is null) > 1)
                throw new PrinterConfigurationException("PRINTER_DEFAULT_REQUIRED");
            var archived = await store.ArchivePrinterConfigurationAsync(
                id,
                existing.Revision,
                revision,
                cloudCommandId,
                "cloud-command");
            _configurations = await store.GetPrinterConfigurationsAsync(includeArchived: true);
            return new(archived, existing.ArchivedAt is not null);
        }
        finally
        {
            _gate.Release();
        }
    }

    public static IReadOnlyList<string> ValidateCollection(
        IReadOnlyCollection<StoredPrinterConfiguration> configurations)
    {
        var issues = new List<string>();
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var configuration in configurations)
        {
            if (!ids.Add(configuration.Id)) issues.Add("PRINTER_CONFIGURATION_ID_DUPLICATE");
            issues.AddRange(Validate(configuration));
        }
        if (configurations.Count > 0 && configurations.Count(item => item.IsDefault) != 1)
            issues.Add("PRINTER_DEFAULT_REQUIRED");

        var byId = configurations
            .GroupBy(item => item.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        foreach (var configuration in configurations)
        {
            if (configuration.FallbackPrinterId is { } fallback && !byId.ContainsKey(fallback))
                issues.Add("PRINTER_FALLBACK_NOT_FOUND");
        }
        foreach (var configuration in configurations)
        {
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var cursor = configuration;
            while (cursor.FallbackPrinterId is { } fallback && byId.TryGetValue(fallback, out cursor!))
            {
                if (!visited.Add(fallback))
                {
                    issues.Add("PRINTER_FALLBACK_CYCLE");
                    break;
                }
            }
        }
        return issues.Distinct(StringComparer.Ordinal).ToArray();
    }

    public static IReadOnlyList<string> Validate(StoredPrinterConfiguration configuration)
    {
        var issues = new List<string>();
        if (!SafeId.IsMatch(configuration.Id)) issues.Add("PRINTER_ID_INVALID");
        if (!IsValidHost(configuration.Host)) issues.Add("PRINTER_HOST_INVALID");
        if (configuration.Port is < 1 or > 65_535) issues.Add("PRINTER_PORT_INVALID");
        if (configuration.PaperWidthMm is not (58 or 80)) issues.Add("PRINTER_PAPER_WIDTH_INVALID");
        var maxCharacters = configuration.PaperWidthMm == 58 ? 42 : 64;
        if (configuration.CharactersPerLine is < 24 || configuration.CharactersPerLine > maxCharacters)
            issues.Add("PRINTER_CHARACTERS_PER_LINE_INVALID");
        if (configuration.CodeTable is < 0 or > 255) issues.Add("PRINTER_CODE_TABLE_INVALID");
        if (configuration.TimeoutSeconds is < 1 or > 30) issues.Add("PRINTER_TIMEOUT_INVALID");
        if (configuration.StationIds.Length > 100 ||
            configuration.StationIds.Distinct(StringComparer.OrdinalIgnoreCase).Count() != configuration.StationIds.Length ||
            configuration.StationIds.Any(value => !Guid.TryParse(value, out _)))
            issues.Add("PRINTER_STATION_IDS_INVALID");
        if (configuration.DocumentTypes.Length > SupportedDocumentTypes.Count ||
            configuration.DocumentTypes.Distinct(StringComparer.Ordinal).Count() != configuration.DocumentTypes.Length ||
            configuration.DocumentTypes.Any(value => !SupportedDocumentTypes.Contains(value)))
            issues.Add("PRINTER_DOCUMENT_TYPES_INVALID");
        if (configuration.FallbackPrinterId is { } fallback &&
            (!SafeId.IsMatch(fallback) || fallback.Equals(configuration.Id, StringComparison.OrdinalIgnoreCase)))
            issues.Add("PRINTER_FALLBACK_INVALID");
        return issues;
    }

    private static List<StoredPrinterConfiguration> BuildBootstrap(
        IReadOnlyList<PrinterOptions> configured)
    {
        var enabled = configured.Where(item => item.Enabled).ToArray();
        var defaultId = enabled.FirstOrDefault(item => item.Default)?.Id ?? enabled.FirstOrDefault()?.Id;
        var now = DateTimeOffset.UtcNow;
        return enabled.Select(item => new StoredPrinterConfiguration(
            NormalizeId(item.Id),
            item.Host.Trim(),
            item.Port,
            item.PaperWidthMm,
            item.CharactersPerLine,
            item.CodeTable,
            item.Cut,
            item.SupportsRasterGraphics,
            item.Id.Equals(defaultId, StringComparison.OrdinalIgnoreCase),
            NormalizeStationIds(item.StationIds),
            NormalizeDocumentTypes(item.DocumentTypes),
            item.Stations.Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
            NormalizeOptionalId(item.FallbackPrinterId),
            item.TimeoutSeconds,
            1,
            now,
            now,
            null,
            "static-bootstrap",
            "static-bootstrap")).ToList();
    }

    private static string NormalizeId(string value)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? "";
        if (!SafeId.IsMatch(normalized)) throw new PrinterConfigurationException("PRINTER_ID_INVALID");
        return normalized;
    }

    private static string? NormalizeOptionalId(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : NormalizeId(value);

    private static string[] NormalizeStationIds(IEnumerable<string>? values) =>
        (values ?? []).Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => Guid.TryParse(value, out var parsed) ? parsed.ToString() : value.Trim())
        .ToArray();

    private static string[] NormalizeDocumentTypes(IEnumerable<string>? values) =>
        (values ?? []).Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => value.Trim().ToLowerInvariant()).ToArray();

    private static bool IsValidHost(string host)
    {
        if (string.IsNullOrWhiteSpace(host) || host.Length > 253 ||
            host.Any(char.IsWhiteSpace) || host.Any(char.IsControl) ||
            host.Contains('/') || host.Contains('\\') || host.Contains('@'))
            return false;
        if (!IPAddress.TryParse(host, out var address)) return false;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address)) return true;
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return bytes[0] == 10 ||
                (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) ||
                (bytes[0] == 192 && bytes[1] == 168) ||
                (bytes[0] == 169 && bytes[1] == 254);
        }
        return address.IsIPv6LinkLocal || (bytes[0] & 0xfe) == 0xfc;
    }

    private static bool ConfigurationMatches(
        StoredPrinterConfiguration existing,
        PrinterConfigurationMutation mutation)
    {
        return existing.Host.Equals(mutation.Host?.Trim(), StringComparison.OrdinalIgnoreCase) &&
            existing.Port == mutation.Port &&
            existing.PaperWidthMm == mutation.PaperWidthMm &&
            existing.CharactersPerLine == mutation.CharactersPerLine &&
            existing.CodeTable == mutation.CodeTable &&
            existing.Cut == mutation.Cut &&
            existing.SupportsRasterGraphics == mutation.SupportsRasterGraphics &&
            existing.IsDefault == mutation.IsDefault &&
            existing.StationIds.SequenceEqual(NormalizeStationIds(mutation.StationIds), StringComparer.OrdinalIgnoreCase) &&
            existing.DocumentTypes.SequenceEqual(NormalizeDocumentTypes(mutation.DocumentTypes), StringComparer.Ordinal) &&
            string.Equals(existing.FallbackPrinterId, NormalizeOptionalId(mutation.FallbackPrinterId), StringComparison.OrdinalIgnoreCase) &&
            existing.TimeoutSeconds == mutation.TimeoutSeconds;
    }
}
