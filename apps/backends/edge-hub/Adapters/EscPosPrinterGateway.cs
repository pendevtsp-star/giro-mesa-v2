using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Adapters;

public sealed class EscPosPrinterGateway(IOptions<HubOptions> options, ILogger<EscPosPrinterGateway> logger)
    : IPrinterGateway
{
    private readonly IReadOnlyList<PrinterOptions> _printers = options.Value.AvailablePrinters;

    public CapabilityState Capability
    {
        get
        {
            var count = _printers.Count(PrinterConfiguration.IsValid);
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
            request.Payload.ValueKind != System.Text.Json.JsonValueKind.Object ||
            request.Payload.GetRawText().Length > 128_000)
            return new(false, "rejected", "PRINT_JOB_INVALID");

        var printer = SelectPrinter(request);
        if (printer is null)
            return new(false, "rejected", "PRINTER_NOT_FOUND");
        var result = await PrintToAsync(printer, request, cancellationToken);
        if (result.ErrorCode is not ("PRINTER_UNREACHABLE" or "PRINTER_TIMEOUT") ||
            string.IsNullOrWhiteSpace(printer.FallbackPrinterId))
            return result;
        var fallback = _printers.FirstOrDefault(candidate =>
            PrinterConfiguration.IsValid(candidate) &&
            candidate.Id.Equals(printer.FallbackPrinterId, StringComparison.OrdinalIgnoreCase));
        return fallback is null
            ? result
            : await PrintToAsync(fallback, request, cancellationToken);
    }

    public async Task<IReadOnlyList<PrinterStatus>> GetStatusesAsync(
        CancellationToken cancellationToken = default) =>
        await Task.WhenAll(_printers.Select(printer => ProbeAsync(printer, cancellationToken)));

    private PrinterOptions? SelectPrinter(PrintRequest request)
    {
        var configured = _printers.Where(PrinterConfiguration.IsValid).ToArray();
        if (configured.Length == 0) return null;
        if (!string.IsNullOrWhiteSpace(request.PrinterId) && request.PrinterId != "default")
            return configured.FirstOrDefault(candidate =>
                candidate.Id.Equals(request.PrinterId, StringComparison.OrdinalIgnoreCase));
        return configured.FirstOrDefault(candidate =>
                   Matches(candidate.Stations, request.Station) &&
                   Matches(candidate.DocumentTypes, request.DocumentType))
               ?? configured.FirstOrDefault(candidate => candidate.Default)
               ?? configured[0];
    }

    private async Task<PrintResult> PrintToAsync(
        PrinterOptions printer,
        PrintRequest request,
        CancellationToken cancellationToken)
    {
        var charactersPerLine = Math.Clamp(printer.CharactersPerLine, 24, 64);
        var content = ThermalReceiptFormatter.Format(
            request.DocumentType,
            request.Payload,
            charactersPerLine);
        var payload = EscPosDocument.Render(
            content,
            charactersPerLine,
            Math.Clamp(printer.CodeTable, 0, 255),
            printer.Cut);
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
            logger.LogWarning(exception, "ESC/POS printer {PrinterId} is unreachable", printer.Id);
            return new(false, "failed", "PRINTER_UNREACHABLE", PrinterId: printer.Id);
        }
        try
        {
            await using var stream = client.GetStream();
            var written = 0;
            for (var copy = 0; copy < request.Copies; copy += 1)
            {
                await stream.WriteAsync(payload, timeout.Token);
                await stream.FlushAsync(timeout.Token);
                written += payload.Length;
            }
            return new(true, "accepted", null, written, printer.Id);
        }
        catch (OperationCanceledException)
        {
            return new(false, "failed", "PRINTER_RESULT_UNKNOWN", PrinterId: printer.Id);
        }
        catch (IOException exception)
        {
            logger.LogWarning(exception, "ESC/POS printer {PrinterId} failed while writing", printer.Id);
            return new(false, "failed", "PRINTER_RESULT_UNKNOWN", PrinterId: printer.Id);
        }
    }

    private static async Task<PrinterStatus> ProbeAsync(
        PrinterOptions printer,
        CancellationToken cancellationToken)
    {
        if (!PrinterConfiguration.IsValid(printer))
            return new(printer.Id, false, false, printer.Default, printer.PaperWidthMm, "PRINTER_NOT_CONFIGURED");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(printer.TimeoutSeconds, 1, 5)));
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(printer.Host, printer.Port, timeout.Token);
            return new(printer.Id, true, true, printer.Default, printer.PaperWidthMm);
        }
        catch
        {
            return new(printer.Id, true, false, printer.Default, printer.PaperWidthMm, "PRINTER_UNREACHABLE");
        }
    }

    private static bool Matches(IEnumerable<string> values, string candidate)
    {
        var routes = values.Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
        return routes.Length == 0 || routes.Contains(candidate, StringComparer.OrdinalIgnoreCase);
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
        options.CharactersPerLine is >= 24 and <= 64;
}

public static class EscPosDocument
{
    private static readonly byte[] Initialize = [0x1b, 0x40];
    private static readonly byte[] FeedAndCut = [0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x01];
    private static readonly byte[] FeedOnly = [0x0a, 0x0a, 0x0a];

    public static byte[] Render(string content, int charactersPerLine, int codeTable, bool cut)
    {
        var normalized = new string(content
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Where(character => character == '\n' || !char.IsControl(character))
            .ToArray());
        var lines = normalized.Split('\n').SelectMany(line => Wrap(line, charactersPerLine));
        var body = Encoding.Latin1.GetBytes(string.Join('\n', lines) + "\n");
        var suffix = cut ? FeedAndCut : FeedOnly;
        var result = new byte[Initialize.Length + 3 + body.Length + suffix.Length];
        Initialize.CopyTo(result, 0);
        result[Initialize.Length] = 0x1b;
        result[Initialize.Length + 1] = 0x74;
        result[Initialize.Length + 2] = (byte)codeTable;
        body.CopyTo(result, Initialize.Length + 3);
        suffix.CopyTo(result, Initialize.Length + 3 + body.Length);
        return result;
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
