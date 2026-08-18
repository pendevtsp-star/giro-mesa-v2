using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Adapters;

public sealed class EscPosPrinterGateway(IOptions<HubOptions> options, ILogger<EscPosPrinterGateway> logger)
    : IPrinterGateway
{
    private readonly PrinterOptions _options = options.Value.Printer;

    public CapabilityState Capability => PrinterConfiguration.IsValid(_options)
        ? new(true, "escpos-tcp", $"ESC/POS {_options.PaperWidthMm} mm at {_options.Host}:{_options.Port}.")
        : new(false, "escpos-tcp", "Configure Hub:Printer with a paired network printer.");

    public async Task<PrintResult> PrintAsync(
        PrintRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!PrinterConfiguration.IsValid(_options))
            return new(false, "unavailable", "PRINTER_NOT_CONFIGURED");
        if (!string.IsNullOrWhiteSpace(request.PrinterId) &&
            request.PrinterId != "default" &&
            request.PrinterId != _options.Id)
            return new(false, "rejected", "PRINTER_NOT_FOUND");
        if (request.Copies is < 1 or > 5 ||
            request.Payload.ValueKind != System.Text.Json.JsonValueKind.Object ||
            request.Payload.GetRawText().Length > 128_000)
            return new(false, "rejected", "PRINT_JOB_INVALID");

        var charactersPerLine = Math.Clamp(_options.CharactersPerLine, 24, 64);
        var content = ThermalReceiptFormatter.Format(
            request.DocumentType,
            request.Payload,
            charactersPerLine);
        var payload = EscPosDocument.Render(
            content,
            charactersPerLine,
            Math.Clamp(_options.CodeTable, 0, 255),
            _options.Cut);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(_options.TimeoutSeconds, 1, 30)));
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(_options.Host, _options.Port, timeout.Token);
            await using var stream = client.GetStream();
            var written = 0;
            for (var copy = 0; copy < request.Copies; copy += 1)
            {
                await stream.WriteAsync(payload, timeout.Token);
                await stream.FlushAsync(timeout.Token);
                written += payload.Length;
            }
            return new(true, "accepted", null, written, _options.Id);
        }
        catch (OperationCanceledException)
        {
            return new(false, "failed", "PRINTER_TIMEOUT");
        }
        catch (SocketException exception)
        {
            logger.LogWarning(exception, "ESC/POS printer {PrinterId} is unreachable", _options.Id);
            return new(false, "failed", "PRINTER_UNREACHABLE");
        }
        catch (IOException exception)
        {
            logger.LogWarning(exception, "ESC/POS printer {PrinterId} failed while writing", _options.Id);
            return new(false, "failed", "PRINTER_IO_ERROR");
        }
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
