using System.Text.Json;
using System.Text.Json.Serialization;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;

namespace GiroMesa.EdgeHub.Sync;

public sealed class CloudPrinterCommandProcessor(
    HubStore store,
    PrinterConfigurationRegistry configurations,
    PrintJobExecutor printJobs,
    ILogger<CloudPrinterCommandProcessor> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public async Task<int> ProcessPendingAsync(CancellationToken cancellationToken = default)
    {
        var pending = await store.GetPendingPrinterCloudCommandsAsync(100);
        var processed = 0;
        foreach (var command in pending
            .OrderBy(command => command.Type.StartsWith("printer.configuration.", StringComparison.Ordinal) ? 0 : 1)
            .ThenBy(command => command.CreatedAt)
            .ThenBy(command => command.Id, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            JsonElement result;
            string? errorCode = null;
            try
            {
                if (command.ExpiresAt <= DateTimeOffset.UtcNow)
                    throw new CloudPrinterCommandException("CLOUD_COMMAND_EXPIRED");
                result = command.Type switch
                {
                    "print_job.execute" => await ExecutePrintJobAsync(command, cancellationToken),
                    "printer.configuration.upsert" => await ApplyConfigurationAsync(command),
                    "printer.configuration.archive" => await ArchiveConfigurationAsync(command),
                    "printer.test" => await TestPrinterAsync(command, cancellationToken),
                    _ => throw new CloudPrinterCommandException("CLOUD_COMMAND_UNSUPPORTED"),
                };
            }
            catch (Exception exception) when (exception is JsonException or ArgumentException or
                InvalidOperationException or PrinterConfigurationException or CloudPrinterCommandException)
            {
                errorCode = ErrorCode(exception);
                result = Failure(command, errorCode);
                logger.LogWarning(
                    "Cloud printer command {CommandId} ({CommandType}) was rejected: {ErrorCode}",
                    command.Id,
                    command.Type,
                    errorCode);
            }
            await store.CompleteCloudCommandAsync(command.Id, result, errorCode);
            processed += 1;
        }
        return processed;
    }

    private async Task<JsonElement> ExecutePrintJobAsync(
        CloudCommand command,
        CancellationToken cancellationToken)
    {
        var input = command.Payload.Deserialize<CloudPrintJobInput>(JsonOptions)
            ?? throw new CloudPrinterCommandException("CLOUD_PRINT_JOB_INVALID");
        if (string.IsNullOrWhiteSpace(input.CloudPrintJobId) || input.CloudPrintJobId.Length > 180 ||
            string.IsNullOrWhiteSpace(input.IdempotencyKey) || input.IdempotencyKey.Length > 180 ||
            !Guid.TryParse(input.StationId, out var stationId) ||
            input.StationName?.Length > 120 ||
            input.PrinterId?.Length > 80 ||
            input.DocumentType != "kds_ticket" ||
            input.Copies is < 1 or > 5 ||
            input.Payload.ValueKind != JsonValueKind.Object)
            throw new CloudPrinterCommandException("CLOUD_PRINT_JOB_INVALID");
        var request = new PrintRequest(
            input.IdempotencyKey,
            input.PrinterId,
            null,
            input.DocumentType,
            input.Payload.Clone(),
            input.Copies,
            stationId.ToString(),
            string.IsNullOrWhiteSpace(input.StationName) ? null : input.StationName.Trim());
        var execution = await printJobs.ExecuteAsync(request, cancellationToken);
        var status = CloudPrintStatus(execution.Result);
        return JsonSerializer.SerializeToElement(new
        {
            commandId = command.Id,
            type = command.Type,
            cloudPrintJobId = input.CloudPrintJobId,
            localPrintJobId = execution.Job.Id,
            printerId = execution.Result.PrinterId ?? execution.Job.PrinterId,
            status,
            errorCode = status == "printed" ? null : execution.Result.ErrorCode ?? "PRINTER_RESULT_UNKNOWN",
            duplicate = execution.Result.Duplicate,
        }, JsonOptions);
    }

    private async Task<JsonElement> ApplyConfigurationAsync(CloudCommand command)
    {
        var input = command.Payload.Deserialize<CloudPrinterConfigurationUpsertInput>(JsonOptions)
            ?? throw new CloudPrinterCommandException("PRINTER_CONFIGURATION_COMMAND_INVALID");
        if (input.Configuration is null || string.IsNullOrWhiteSpace(input.PrinterId))
            throw new CloudPrinterCommandException("PRINTER_CONFIGURATION_COMMAND_INVALID");
        var mutation = input.Configuration.ToMutation();
        var applied = await configurations.ApplyCloudUpsertAsync(
            input.PrinterId,
            input.Revision,
            mutation,
            command.Id);
        return JsonSerializer.SerializeToElement(new
        {
            commandId = command.Id,
            type = command.Type,
            printerId = applied.Configuration.Id,
            revision = applied.Configuration.Revision,
            status = "applied",
            errorCode = (string?)null,
            duplicate = applied.Duplicate,
        }, JsonOptions);
    }

    private async Task<JsonElement> ArchiveConfigurationAsync(CloudCommand command)
    {
        var input = command.Payload.Deserialize<CloudPrinterConfigurationArchiveInput>(JsonOptions)
            ?? throw new CloudPrinterCommandException("PRINTER_CONFIGURATION_COMMAND_INVALID");
        if (string.IsNullOrWhiteSpace(input.PrinterId))
            throw new CloudPrinterCommandException("PRINTER_CONFIGURATION_COMMAND_INVALID");
        var applied = await configurations.ApplyCloudArchiveAsync(
            input.PrinterId,
            input.Revision,
            command.Id);
        return JsonSerializer.SerializeToElement(new
        {
            commandId = command.Id,
            type = command.Type,
            printerId = applied.Configuration.Id,
            revision = applied.Configuration.Revision,
            status = "applied",
            errorCode = (string?)null,
            duplicate = applied.Duplicate,
        }, JsonOptions);
    }

    private async Task<JsonElement> TestPrinterAsync(
        CloudCommand command,
        CancellationToken cancellationToken)
    {
        var input = command.Payload.Deserialize<CloudPrinterTestInput>(JsonOptions)
            ?? throw new CloudPrinterCommandException("PRINTER_TEST_COMMAND_INVALID");
        if (string.IsNullOrWhiteSpace(input.PrinterId) || input.PrinterId.Length > 80)
            throw new CloudPrinterCommandException("PRINTER_TEST_COMMAND_INVALID");
        var configured = (await configurations.ListAsync())
            .SingleOrDefault(item => item.Id.Equals(input.PrinterId, StringComparison.OrdinalIgnoreCase))
            ?? throw new CloudPrinterCommandException("PRINTER_CONFIGURATION_NOT_FOUND");
        var idempotencyKey = string.IsNullOrWhiteSpace(input.IdempotencyKey)
            ? $"printer-test:{command.Id}"
            : input.IdempotencyKey;
        if (idempotencyKey.Length > 180)
            throw new CloudPrinterCommandException("PRINTER_TEST_COMMAND_INVALID");
        var payload = JsonSerializer.SerializeToElement(new
        {
            schemaVersion = 2,
            tab = new { label = "Teste de impressao" },
            totals = new { },
            items = Array.Empty<object>(),
            payments = Array.Empty<object>(),
        }, JsonOptions);
        var execution = await printJobs.ExecuteAsync(new PrintRequest(
            idempotencyKey,
            configured.Id,
            "diagnostics",
            "partial_statement",
            payload), cancellationToken);
        var status = CloudPrintStatus(execution.Result);
        return JsonSerializer.SerializeToElement(new
        {
            commandId = command.Id,
            type = command.Type,
            printerId = configured.Id,
            revision = configured.Revision,
            status,
            errorCode = status == "printed" ? null : execution.Result.ErrorCode ?? "PRINTER_RESULT_UNKNOWN",
            duplicate = execution.Result.Duplicate,
        }, JsonOptions);
    }

    private static JsonElement Failure(CloudCommand command, string errorCode)
    {
        var printerId = TryString(command.Payload, "printerId");
        var revision = TryInt(command.Payload, "revision");
        return command.Type switch
        {
            "print_job.execute" => JsonSerializer.SerializeToElement(new
            {
                commandId = command.Id,
                type = command.Type,
                cloudPrintJobId = TryString(command.Payload, "cloudPrintJobId"),
                status = "failed",
                errorCode,
            }, JsonOptions),
            "printer.test" => JsonSerializer.SerializeToElement(new
            {
                commandId = command.Id,
                type = command.Type,
                printerId,
                revision = revision ?? 0,
                status = "failed",
                errorCode,
            }, JsonOptions),
            _ => JsonSerializer.SerializeToElement(new
            {
                commandId = command.Id,
                type = command.Type,
                printerId,
                revision = revision ?? 0,
                status = "failed",
                errorCode,
            }, JsonOptions),
        };
    }

    private static string CloudPrintStatus(PrintResult result) => result.Status switch
    {
        "accepted" when result.Success => "printed",
        "confirmation_required" => "confirmation_required",
        _ => "failed",
    };

    private static string ErrorCode(Exception exception) => exception switch
    {
        PrinterConfigurationException configuration => configuration.Code,
        CloudPrinterCommandException command => command.Code,
        InvalidOperationException invalid when invalid.Message == "PRINT_IDEMPOTENCY_CONFLICT" =>
            "PRINT_IDEMPOTENCY_CONFLICT",
        ArgumentException argument when !string.IsNullOrWhiteSpace(argument.Message) &&
            argument.Message.Contains("PRINT_JOB_INVALID", StringComparison.Ordinal) => "PRINT_JOB_INVALID",
        JsonException => "CLOUD_PRINTER_COMMAND_INVALID",
        _ => "CLOUD_PRINTER_COMMAND_INVALID",
    };

    private static string? TryString(JsonElement payload, string property) =>
        payload.ValueKind == JsonValueKind.Object &&
        payload.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? TryInt(JsonElement payload, string property) =>
        payload.ValueKind == JsonValueKind.Object &&
        payload.TryGetProperty(property, out var value) && value.TryGetInt32(out var parsed)
            ? parsed
            : null;

    private sealed record CloudPrintJobInput(
        string CloudPrintJobId,
        string IdempotencyKey,
        string StationId,
        string? StationName,
        string? PrinterId,
        string DocumentType,
        int Copies,
        JsonElement Payload);

    private sealed record CloudPrinterConfigurationUpsertInput(
        string PrinterId,
        int Revision,
        CloudPrinterConfigurationInput? Configuration);

    private sealed record CloudPrinterConfigurationArchiveInput(string PrinterId, int Revision);

    private sealed record CloudPrinterTestInput(string PrinterId, string? IdempotencyKey);

    private sealed record CloudPrinterConfigurationInput(
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
        string? FallbackPrinterId,
        int TimeoutSeconds = 5)
    {
        public PrinterConfigurationMutation ToMutation() => new(
            Host,
            Port,
            PaperWidthMm,
            CharactersPerLine,
            CodeTable,
            Cut,
            SupportsRasterGraphics,
            IsDefault,
            StationIds ?? [],
            DocumentTypes ?? [],
            FallbackPrinterId,
            TimeoutSeconds: TimeoutSeconds);
    }
}

public sealed class CloudPrinterCommandException(string code) : Exception(code)
{
    public string Code { get; } = code;
}
