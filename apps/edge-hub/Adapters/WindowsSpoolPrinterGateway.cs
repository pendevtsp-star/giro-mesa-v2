using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace GiroMesa.EdgeHub.Adapters;

public sealed class WindowsSpoolPrinterGateway : IPrinterGateway
{
    public CapabilityState Capability => OperatingSystem.IsWindows()
        ? new(true, "windows-raw-spooler", "Fila de impressão RAW do Windows disponível.")
        : new(false, "windows-raw-spooler", "A impressão RAW requer o serviço Edge Hub no Windows.");

    public Task<PrintResult> PrintAsync(
        PrintRequest request,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!OperatingSystem.IsWindows())
            return Task.FromResult(new PrintResult(false, "unavailable", "PRINTER_PLATFORM_UNAVAILABLE"));
        if (string.IsNullOrWhiteSpace(request.PrinterId) || string.IsNullOrWhiteSpace(request.Content))
            return Task.FromResult(new PrintResult(false, "invalid", "PRINT_JOB_INVALID"));

        var content = Encoding.UTF8.GetBytes(request.Content);
        if (content.Length > 262_144)
            return Task.FromResult(new PrintResult(false, "invalid", "PRINT_JOB_TOO_LARGE"));

        IntPtr printer = IntPtr.Zero;
        var startedDocument = false;
        var startedPage = false;
        try
        {
            if (!OpenPrinter(request.PrinterId, out printer, IntPtr.Zero))
                return Task.FromResult(Failure("PRINTER_OPEN_FAILED"));
            var document = new DocInfo
            {
                DocumentName = $"GiroMesa {request.Station} {request.IdempotencyKey}",
                DataType = "RAW",
            };
            if (StartDocPrinter(printer, 1, ref document) == 0)
                return Task.FromResult(Failure("PRINTER_DOCUMENT_FAILED"));
            startedDocument = true;
            if (!StartPagePrinter(printer))
                return Task.FromResult(Failure("PRINTER_PAGE_FAILED"));
            startedPage = true;

            var unmanaged = Marshal.AllocCoTaskMem(content.Length);
            try
            {
                Marshal.Copy(content, 0, unmanaged, content.Length);
                if (!WritePrinter(printer, unmanaged, content.Length, out var written) || written != content.Length)
                    return Task.FromResult(Failure("PRINTER_WRITE_FAILED"));
            }
            finally
            {
                Marshal.FreeCoTaskMem(unmanaged);
            }
            return Task.FromResult(new PrintResult(true, "spooled", null));
        }
        finally
        {
            if (startedPage) EndPagePrinter(printer);
            if (startedDocument) EndDocPrinter(printer);
            if (printer != IntPtr.Zero) ClosePrinter(printer);
        }
    }

    private static PrintResult Failure(string code) =>
        new(false, "failed", $"{code}:{new Win32Exception(Marshal.GetLastWin32Error()).NativeErrorCode}");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string DocumentName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? OutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
    }

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr printer, int level, ref DocInfo document);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printer, IntPtr bytes, int count, out int written);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printer);
}
