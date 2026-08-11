using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;

namespace GiroMesa.EdgeHub.Sync;

public sealed class DispatchProcessor(
    HubStore store,
    IPrinterGateway printer,
    IKitchenDispatchGateway kitchen,
    ILogger<DispatchProcessor> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task ProcessPendingCommandsAsync(CancellationToken cancellationToken = default)
    {
        await store.RecoverInterruptedDispatchesAsync(TimeSpan.FromMinutes(2));
        foreach (var command in await store.GetPendingCloudCommandsAsync(50))
        {
            if (command.Type != "dispatch.effect.execute")
            {
                await store.MarkCloudCommandFailedAsync(command.Id, "UNSUPPORTED_CLOUD_COMMAND");
                continue;
            }

            try
            {
                var payload = command.Payload.Deserialize<DispatchCommandPayload>(JsonOptions)
                    ?? throw new InvalidOperationException("DISPATCH_COMMAND_INVALID");
                payload.Validate();
                var effectPayload = payload.Payload.GetRawText();
                await store.ScheduleDispatchAsync(new(
                    payload.EffectId,
                    payload.OrganizationId,
                    payload.UnitId,
                    payload.EffectKey,
                    payload.Destination,
                    payload.TargetRef,
                    payload.Operation,
                    effectPayload,
                    command.CreatedAt));

                var claim = await store.ClaimDispatchAttemptAsync(
                    payload.EffectId,
                    payload.DeliveryKey,
                    command.Id);
                if (claim == "executing")
                {
                    await store.MarkCloudCommandFailedAsync(command.Id, "DISPATCH_OUTCOME_UNCERTAIN");
                    continue;
                }
                if (claim is "delivered" or "failed")
                {
                    await store.MarkCloudCommandProcessedAsync(command.Id);
                    continue;
                }
                if (claim != "claimed") throw new InvalidOperationException("DISPATCH_ATTEMPT_STATE_INVALID");

                var result = payload.Destination == "printer"
                    ? await PrintAsync(payload, effectPayload, cancellationToken)
                    : await DispatchKitchenAsync(payload, effectPayload, cancellationToken);
                await store.CompleteDispatchAttemptAsync(
                    payload.EffectId,
                    payload.DeliveryKey,
                    result.Success,
                    result.ErrorCode);
                if (result.Success && payload.Destination == "printer")
                {
                    await store.AcknowledgeDispatchAsync(
                        payload.EffectId,
                        $"printer:{payload.DeliveryKey}");
                }
                else if (!result.Success && payload.AttemptNumber >= 3)
                {
                    await store.MoveDispatchToDeadLetterAsync(
                        payload.EffectId,
                        result.ErrorCode ?? "DISPATCH_TERMINAL_FAILURE");
                }
                await store.MarkCloudCommandProcessedAsync(command.Id);
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Cloud dispatch command {CommandId} was not acknowledged", command.Id);
                await store.MarkCloudCommandFailedAsync(command.Id, "DISPATCH_COMMAND_PROCESSING_FAILED");
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await ProcessPendingCommandsAsync(stoppingToken);
            await Task.Delay(TimeSpan.FromMilliseconds(500), stoppingToken);
        }
    }

    private async Task<GatewayResult> PrintAsync(
        DispatchCommandPayload command,
        string payload,
        CancellationToken cancellationToken)
    {
        var result = await printer.PrintAsync(
            new(
                command.DeliveryKey,
                command.TargetRef,
                command.Payload.TryGetProperty("stationId", out var station)
                    ? station.ToString()
                    : command.TargetRef,
                command.Payload.TryGetProperty("content", out var content) &&
                content.ValueKind == JsonValueKind.String
                    ? content.GetString() ?? payload
                    : payload),
            cancellationToken);
        return new(result.Success, result.ErrorCode);
    }

    private async Task<GatewayResult> DispatchKitchenAsync(
        DispatchCommandPayload command,
        string payload,
        CancellationToken cancellationToken)
    {
        var result = await kitchen.DeliverAsync(
            new(
                command.EffectId,
                command.DeliveryKey,
                command.TargetRef,
                command.Operation,
                payload),
            cancellationToken);
        return new(result.Success, result.ErrorCode);
    }

    private sealed record GatewayResult(bool Success, string? ErrorCode);

    private sealed record DispatchCommandPayload(
        string EffectId,
        string OrganizationId,
        string UnitId,
        string EffectKey,
        string Destination,
        string TargetRef,
        string Operation,
        string DeliveryKey,
        int AttemptNumber,
        JsonElement Payload)
    {
        public void Validate()
        {
            if (!Guid.TryParse(EffectId, out _) ||
                !Guid.TryParse(OrganizationId, out _) ||
                !Guid.TryParse(UnitId, out _) ||
                string.IsNullOrWhiteSpace(EffectKey) ||
                Destination is not ("printer" or "kds") ||
                string.IsNullOrWhiteSpace(TargetRef) ||
                Operation is not ("dispatch" or "reprint" or "cancel" or "contingency") ||
                string.IsNullOrWhiteSpace(DeliveryKey) ||
                AttemptNumber is < 1 or > 100 ||
                Payload.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("DISPATCH_COMMAND_INVALID");
        }
    }
}
