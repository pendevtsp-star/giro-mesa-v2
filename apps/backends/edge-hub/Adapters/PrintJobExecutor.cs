using System.Security.Cryptography;
using System.Text.Json;
using GiroMesa.EdgeHub.Storage;

namespace GiroMesa.EdgeHub.Adapters;

public sealed record PrintExecutionResult(
    StoredPrintJob Job,
    PrintResult Result);

public sealed class PrintJobExecutor(
    HubStore store,
    IPrinterGateway gateway,
    ILogger<PrintJobExecutor> logger)
{
    public async Task<PrintExecutionResult> ExecuteAsync(
        PrintRequest request,
        CancellationToken cancellationToken = default)
    {
        var validationError = PrintJobRules.Validate(request);
        if (validationError is not null)
        {
            var rejected = new PrintResult(false, "rejected", validationError, PrinterId: request.PrinterId);
            throw new ArgumentException(rejected.ErrorCode, nameof(request));
        }

        var fingerprint = PrintJobRules.Fingerprint(request);
        var (job, inserted) = await store.CreateOrGetPrintJobAsync(request, fingerprint);
        if (!inserted)
        {
            var duplicate = job.Status == "printing"
                ? new PrintResult(
                    false,
                    "confirmation_required",
                    "PRINT_ATTEMPT_IN_PROGRESS_OR_UNKNOWN",
                    job.BytesWritten,
                    job.PrinterId,
                    true)
                : new PrintResult(
                    job.Status == "accepted",
                    job.Status,
                    job.ErrorCode,
                    job.BytesWritten,
                    job.PrinterId,
                    true);
            return new(job, duplicate);
        }

        PrintResult result;
        try
        {
            result = await gateway.PrintAsync(request, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException ||
            !cancellationToken.IsCancellationRequested)
        {
            logger.LogError(exception, "Unexpected printer failure for {PrinterId}", request.PrinterId);
            result = new(false, "confirmation_required", "PRINTER_RESULT_UNKNOWN", PrinterId: request.PrinterId);
        }
        job = await store.CompletePrintJobAsync(job.Id, result);
        return new(job, result);
    }
}

public static class PrintJobRules
{
    private static readonly HashSet<string> DocumentTypes = new(
        ["partial_statement", "payment_statement", "final_receipt", "kds_ticket"],
        StringComparer.Ordinal);

    public static string? Validate(PrintRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || request.IdempotencyKey.Length > 180 ||
            request.PrinterId?.Length > 80 ||
            request.Station?.Length > 120 ||
            request.StationName?.Length > 120 ||
            (request.StationId is not null && !Guid.TryParse(request.StationId, out _)) ||
            (request.StationId is null && string.IsNullOrWhiteSpace(request.Station)) ||
            !DocumentTypes.Contains(request.DocumentType) ||
            request.Payload.ValueKind != JsonValueKind.Object ||
            request.Payload.GetRawText().Length > 128_000 ||
            request.Copies is < 1 or > 5)
            return "PRINT_JOB_INVALID";
        return null;
    }

    public static string Fingerprint(PrintRequest request) => Convert.ToHexString(
        SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));
}
