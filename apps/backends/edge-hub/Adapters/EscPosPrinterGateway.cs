using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Adapters;

public sealed class EscPosPrinterGateway : IPrinterGateway
{
    private readonly Func<IReadOnlyList<PrinterOptions>> _getPrinters;
    private readonly ILogger<EscPosPrinterGateway> _logger;

    public EscPosPrinterGateway(
        IOptions<HubOptions> options,
        ILogger<EscPosPrinterGateway> logger)
        : this(() => options.Value.AvailablePrinters, logger)
    {
    }

    public EscPosPrinterGateway(
        PrinterConfigurationRegistry registry,
        ILogger<EscPosPrinterGateway> logger)
        : this(() => registry.ActivePrinters, logger)
    {
    }

    private EscPosPrinterGateway(
        Func<IReadOnlyList<PrinterOptions>> getPrinters,
        ILogger<EscPosPrinterGateway> logger)
    {
        _getPrinters = getPrinters;
        _logger = logger;
    }

    public CapabilityState Capability
    {
        get
        {
            var count = _getPrinters().Count(PrinterConfiguration.IsValid);
            return count > 0
                ? new(true, "escpos-tcp", $"{count} ESC/POS network printer(s) configured.")
                : new(false, "escpos-tcp", "Configure Hub:Printers with at least one paired network printer.");
        }
    }

    public async Task<PrintResult> PrintAsync(
        PrintRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.Copies is < 1 or > 5 ||
            (request.StationId is not null && !Guid.TryParse(request.StationId, out _)) ||
            request.Payload.ValueKind != System.Text.Json.JsonValueKind.Object ||
            request.Payload.GetRawText().Length > 128_000)
            return new(false, "rejected", "PRINT_JOB_INVALID");

        var printers = _getPrinters();
        var printer = SelectPrinter(printers, request);
        if (printer is null)
            return new(false, "rejected", "PRINTER_ROUTE_NOT_FOUND");
        var result = await PrintToAsync(printer, request, cancellationToken);
        if (result.ErrorCode is not ("PRINTER_UNREACHABLE" or "PRINTER_TIMEOUT") ||
            string.IsNullOrWhiteSpace(printer.FallbackPrinterId))
            return result;
        var fallback = printers.FirstOrDefault(candidate =>
            PrinterConfiguration.IsValid(candidate) &&
            candidate.Id.Equals(printer.FallbackPrinterId, StringComparison.OrdinalIgnoreCase));
        return fallback is null
            ? result
            : await PrintToAsync(fallback, request, cancellationToken);
    }

    public async Task<IReadOnlyList<PrinterStatus>> GetStatusesAsync(
        CancellationToken cancellationToken = default) =>
        await Task.WhenAll(_getPrinters().Select(printer => ProbeAsync(printer, cancellationToken)));

    private static PrinterOptions? SelectPrinter(
        IReadOnlyList<PrinterOptions> printers,
        PrintRequest request)
    {
        var configured = printers.Where(PrinterConfiguration.IsValid).ToArray();
        if (configured.Length == 0) return null;
        if (!string.IsNullOrWhiteSpace(request.PrinterId) && request.PrinterId != "default")
            return configured.FirstOrDefault(candidate =>
                candidate.Id.Equals(request.PrinterId, StringComparison.OrdinalIgnoreCase));

        var candidates = configured
            .Where(candidate => Matches(candidate.DocumentTypes, request.DocumentType))
            .Where(candidate => request.StationId is not null
                ? MatchesStationId(candidate.StationIds, request.StationId)
                : MatchesLegacyStation(candidate.Stations, request.Station))
            .OrderByDescending(candidate => RouteScore(candidate, request))
            .ThenBy(candidate => candidate.Id, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return candidates.FirstOrDefault();
    }

    private async Task<PrintResult> PrintToAsync(
        PrinterOptions printer,
        PrintRequest request,
        CancellationToken cancellationToken)
    {
        var charactersPerLine = Math.Clamp(printer.CharactersPerLine, 24, 64);
        var document = ThermalReceiptFormatter.FormatDocument(
            request.DocumentType,
            request.Payload,
            charactersPerLine);
        var payload = EscPosDocument.Render(
            document,
            charactersPerLine,
            Math.Clamp(printer.CodeTable, 0, 255),
            printer.Cut,
            printer.SupportsRasterGraphics,
            printer.PaperWidthMm == 58 ? 384 : 576);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(printer.TimeoutSeconds, 1, 30)));
        using var client = new TcpClient();
        try
        {
            await client.ConnectAsync(printer.Host, printer.Port, timeout.Token);
        }
        catch (OperationCanceledException)
        {
            return new(false, "failed", "PRINTER_TIMEOUT", PrinterId: printer.Id);
        }
        catch (SocketException exception)
        {
            _logger.LogWarning(exception, "ESC/POS printer {PrinterId} is unreachable", printer.Id);
            return new(false, "failed", "PRINTER_UNREACHABLE", PrinterId: printer.Id);
        }
        var written = 0;
        var writeStarted = false;
        try
        {
            await using var stream = client.GetStream();
            for (var copy = 0; copy < request.Copies; copy += 1)
            {
                timeout.Token.ThrowIfCancellationRequested();
                writeStarted = true;
                await stream.WriteAsync(payload, timeout.Token);
                await stream.FlushAsync(timeout.Token);
                written += payload.Length;
            }
            return new(true, "accepted", null, written, printer.Id);
        }
        catch (OperationCanceledException)
        {
            return writeStarted
                ? new(
                    false,
                    "confirmation_required",
                    "PRINTER_RESULT_UNKNOWN",
                    written,
                    printer.Id)
                : new(false, "failed", "PRINTER_TIMEOUT", written, printer.Id);
        }
        catch (IOException exception)
        {
            _logger.LogWarning(exception, "ESC/POS printer {PrinterId} failed while writing", printer.Id);
            return writeStarted
                ? new(
                    false,
                    "confirmation_required",
                    "PRINTER_RESULT_UNKNOWN",
                    written,
                    printer.Id)
                : new(false, "failed", "PRINTER_UNREACHABLE", written, printer.Id);
        }
    }

    private static async Task<PrinterStatus> ProbeAsync(
        PrinterOptions printer,
        CancellationToken cancellationToken)
    {
        if (!PrinterConfiguration.IsValid(printer))
            return new(
                printer.Id,
                false,
                false,
                printer.Default,
                printer.PaperWidthMm,
                "PRINTER_NOT_CONFIGURED",
                printer.SupportsRasterGraphics);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(printer.TimeoutSeconds, 1, 5)));
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(printer.Host, printer.Port, timeout.Token);
            return new(
                printer.Id,
                true,
                true,
                printer.Default,
                printer.PaperWidthMm,
                SupportsRasterGraphics: printer.SupportsRasterGraphics);
        }
        catch
        {
            return new(
                printer.Id,
                true,
                false,
                printer.Default,
                printer.PaperWidthMm,
                "PRINTER_UNREACHABLE",
                printer.SupportsRasterGraphics);
        }
    }

    private static bool Matches(IEnumerable<string> values, string candidate)
    {
        var routes = values.Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
        return routes.Length == 0 || routes.Contains(candidate, StringComparer.OrdinalIgnoreCase);
    }

    private static bool MatchesStationId(IEnumerable<string> values, string stationId)
    {
        var routes = values.Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
        return routes.Length == 0 || routes.Contains(stationId, StringComparer.OrdinalIgnoreCase);
    }

    private static bool MatchesLegacyStation(IEnumerable<string> values, string? station)
    {
        var routes = values.Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
        return routes.Length == 0 ||
            (station is not null && routes.Contains(station, StringComparer.OrdinalIgnoreCase));
    }

    private static int RouteScore(PrinterOptions printer, PrintRequest request)
    {
        var score = printer.Default ? 1 : 0;
        if (printer.DocumentTypes.Contains(request.DocumentType, StringComparer.OrdinalIgnoreCase)) score += 2;
        if (request.StationId is not null &&
            printer.StationIds.Contains(request.StationId, StringComparer.OrdinalIgnoreCase)) score += 8;
        if (request.StationId is null && request.Station is not null &&
            printer.Stations.Contains(request.Station, StringComparer.OrdinalIgnoreCase)) score += 8;
        return score;
    }
}

public static class PrinterConfiguration
{
    public static bool IsValid(PrinterOptions options) =>
        options.Enabled &&
        !string.IsNullOrWhiteSpace(options.Id) &&
        !string.IsNullOrWhiteSpace(options.Host) &&
        options.Port is > 0 and <= 65_535 &&
        options.PaperWidthMm is 58 or 80 &&
        options.CharactersPerLine is >= 24 and <= 64 &&
        options.CodeTable is >= 0 and <= 255 &&
        options.TimeoutSeconds is >= 1 and <= 30 &&
        options.StationIds.All(value => Guid.TryParse(value, out _));
}

public static class EscPosDocument
{
    private static readonly byte[] Initialize = [0x1b, 0x40];
    private static readonly byte[] FeedAndCut = [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x01];
    private static readonly byte[] FeedOnly = [0x0a, 0x0a, 0x0a];

    public static byte[] Render(string content, int charactersPerLine, int codeTable, bool cut)
        => Render(
            new ThermalPrintDocument(content),
            charactersPerLine,
            codeTable,
            cut,
            supportsRasterGraphics: false,
            maximumRasterWidthDots: 0);

    public static byte[] Render(
        ThermalPrintDocument document,
        int charactersPerLine,
        int codeTable,
        bool cut,
        bool supportsRasterGraphics,
        int maximumRasterWidthDots)
    {
        var normalized = new string(document.Text
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Where(character => character == '\n' || !char.IsControl(character))
            .ToArray());
        var lines = normalized.Split('\n').SelectMany(line => Wrap(line, charactersPerLine));
        var body = Encoding.Latin1.GetBytes(string.Join('\n', lines) + "\n");
        var graphic = supportsRasterGraphics &&
            document.HeaderGraphic is { } candidate &&
            candidate.WidthDots <= maximumRasterWidthDots
                ? RenderRaster(candidate)
                : [];
        var suffix = cut ? FeedAndCut : FeedOnly;
        var result = new byte[
            Initialize.Length + 3 + graphic.Length + body.Length + suffix.Length];
        Initialize.CopyTo(result, 0);
        result[Initialize.Length] = 0x1b;
        result[Initialize.Length + 1] = 0x74;
        result[Initialize.Length + 2] = (byte)codeTable;
        var offset = Initialize.Length + 3;
        graphic.CopyTo(result, offset);
        offset += graphic.Length;
        body.CopyTo(result, offset);
        suffix.CopyTo(result, offset + body.Length);
        return result;
    }

    private static byte[] RenderRaster(ThermalRasterGraphic graphic)
    {
        var widthBytes = (graphic.WidthDots + 7) / 8;
        if (graphic.Data.Length != widthBytes * graphic.HeightDots) return [];
        const int storeParametersLength = 10;
        var storePayloadLength = storeParametersLength + graphic.Data.Length;
        var command = new byte[5 + storePayloadLength + 7];
        var offset = 0;
        // Epson GS ( L, function 112: store raster graphics in the print buffer.
        command[offset++] = 0x1d;
        command[offset++] = 0x28;
        command[offset++] = 0x4c;
        command[offset++] = (byte)(storePayloadLength & 0xff);
        command[offset++] = (byte)((storePayloadLength >> 8) & 0xff);
        command[offset++] = 0x30;
        command[offset++] = 0x70;
        command[offset++] = 0x30;
        command[offset++] = 0x01;
        command[offset++] = 0x01;
        command[offset++] = 0x31;
        command[offset++] = (byte)(widthBytes & 0xff);
        command[offset++] = (byte)((widthBytes >> 8) & 0xff);
        command[offset++] = (byte)(graphic.HeightDots & 0xff);
        command[offset++] = (byte)((graphic.HeightDots >> 8) & 0xff);
        graphic.Data.CopyTo(command, offset);
        offset += graphic.Data.Length;
        // Epson GS ( L, function 50: print the graphics stored above.
        command[offset++] = 0x1d;
        command[offset++] = 0x28;
        command[offset++] = 0x4c;
        command[offset++] = 0x02;
        command[offset++] = 0x00;
        command[offset++] = 0x30;
        command[offset] = 0x32;
        return command;
    }

    private static IEnumerable<string> Wrap(string line, int width)
    {
        if (line.Length == 0) return [""];
        var result = new List<string>();
        var remaining = line;
        while (remaining.Length > width)
        {
            var boundary = remaining.LastIndexOf(' ', width);
            if (boundary < 1) boundary = width;
            result.Add(remaining[..boundary].TrimEnd());
            remaining = remaining[boundary..].TrimStart();
        }
        result.Add(remaining);
        return result;
    }
}
