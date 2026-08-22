using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub;

public sealed class FiscalRecoveryWorker(
    IFiscalGateway gateway,
    HubStore store,
    IOptions<HubOptions> options,
    ILogger<FiscalRecoveryWorker> logger) : BackgroundService
{
    private readonly FocusOptions _options = options.Value.Focus;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessDueAsync(DateTimeOffset.UtcNow, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Fiscal recovery scan failed; durable operations were preserved");
            }
            await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(_options.RetryBaseSeconds, 1, 30)), stoppingToken);
        }
    }

    public async Task ProcessDueAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var ids = await store.GetDueFiscalOperationIdsAsync(now, 20, MaxAttempts);
        foreach (var id in ids)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await TryProcessAsync(id, now, cancellationToken);
        }
    }

    public async Task<FiscalResult?> TryProcessAsync(
        string id,
        DateTimeOffset? now = null,
        CancellationToken cancellationToken = default)
    {
        var attemptAt = now ?? DateTimeOffset.UtcNow;
        var operation = await store.ClaimFiscalOperationAsync(
            id,
            attemptAt,
            RetryLease,
            MaxAttempts);
        if (operation is null) return (await store.GetFiscalOperationAsync(id))?.LastResult;

        FiscalResult result;
        OperationalCommand? fiscalEvent = null;
        var nextPhase = operation.Phase;
        var providerReference = operation.ProviderReference;
        try
        {
            var snapshot = await store.GetOperationalSnapshotAsync(
                operation.OrganizationId, operation.UnitId);
            if (snapshot is null)
            {
                result = new(false, "unavailable", providerReference, "OFFLINE_SNAPSHOT_UNAVAILABLE");
            }
            else
            {
                (result, fiscalEvent, nextPhase, providerReference) = await ExecuteAsync(
                    snapshot, operation, attemptAt, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (JsonException exception)
        {
            logger.LogError(exception, "Stored fiscal operation {OperationId} is invalid", operation.Id);
            result = new(false, "rejected", providerReference, "FISCAL_OPERATION_INVALID");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Fiscal operation {OperationId} failed and will be retried", operation.Id);
            result = new(false, "retryable", providerReference, "FISCAL_OPERATION_FAILED");
        }

        if (fiscalEvent is not null)
        {
            await store.AcceptCommandAsync(fiscalEvent);
        }

        var terminal = IsTerminal(operation.Operation, nextPhase, result);
        var exhausted = !terminal && operation.AttemptCount >= MaxAttempts;
        var status = terminal ? "completed" : exhausted ? "dead_letter" : "waiting";
        var nextAttemptAt = terminal || exhausted
            ? attemptAt
            : attemptAt.Add(Backoff(operation.AttemptCount));
        var saved = await store.SaveFiscalOperationAttemptAsync(
            operation.Id,
            operation.LeaseToken!,
            nextPhase,
            providerReference ?? result.DocumentReference,
            result,
            status,
            nextAttemptAt,
            attemptAt);
        if (!saved)
        {
            logger.LogWarning("Fiscal operation {OperationId} lost its lease before result persistence", operation.Id);
        }
        if (exhausted)
        {
            logger.LogError(
                "Fiscal operation {OperationId} reached the retry limit with {ErrorCode}",
                operation.Id,
                result.ErrorCode);
        }
        return result;
    }

    private async Task<(FiscalResult Result, OperationalCommand? Event, string Phase, string? ProviderReference)>
        ExecuteAsync(
            OperationalSnapshot snapshot,
            StoredFiscalOperation operation,
            DateTimeOffset occurredAt,
            CancellationToken cancellationToken)
    {
        if (operation.Operation == "issue")
        {
            var request = Deserialize<FiscalRequest>(operation.RequestPayload);
            if (operation.Phase == "reconcile")
            {
                var reference = operation.ProviderReference ?? request.IdempotencyKey;
                var consult = new FiscalConsultRequest(request.ActorIdentityId, reference);
                var result = await gateway.ConsultAsync(consult, cancellationToken);
                return (
                    result,
                    FiscalEventFactory.FromConsult(snapshot, operation.DeviceId, consult, result, occurredAt),
                    "reconcile",
                    result.DocumentReference ?? reference);
            }

            var issued = await gateway.IssueAsync(request, cancellationToken);
            return (
                issued,
                FiscalEventFactory.FromIssue(snapshot, operation.DeviceId, request, issued, occurredAt),
                issued.Status == "processing" ? "reconcile" : "submit",
                issued.DocumentReference ?? operation.ProviderReference);
        }

        if (operation.Operation == "cancel")
        {
            var request = Deserialize<FiscalCancellationRequest>(operation.RequestPayload);
            var result = await gateway.CancelAsync(operation.IdempotencyKey, request, cancellationToken);
            return (
                result,
                FiscalEventFactory.FromCancellation(
                    snapshot, operation.DeviceId, operation.IdempotencyKey, request, result, occurredAt),
                "submit",
                result.DocumentReference ?? operation.IdempotencyKey);
        }

        var invalidation = Deserialize<FiscalNumberInvalidationRequest>(operation.RequestPayload);
        var invalidationResult = await gateway.InvalidateNumbersAsync(invalidation, cancellationToken);
        return (
            invalidationResult,
            FiscalEventFactory.FromInvalidation(
                snapshot, operation.DeviceId, invalidation, invalidationResult, occurredAt),
            "submit",
            invalidationResult.DocumentReference ?? operation.ProviderReference);
    }

    private static T Deserialize<T>(string value) =>
        JsonSerializer.Deserialize<T>(value)
        ?? throw new JsonException("Stored fiscal operation payload is empty.");

    private static bool IsTerminal(string operation, string phase, FiscalResult result) =>
        operation switch
        {
            "issue" when phase == "reconcile" => result.Status is "authorized" or "canceled" or "rejected",
            "issue" => result.Status is "authorized" or "rejected",
            "cancel" => result.Status is "canceled" or "rejected",
            "invalidate" => result.Status is "invalidated" or "rejected",
            _ => true,
        };

    private TimeSpan Backoff(int attemptCount)
    {
        var baseSeconds = Math.Clamp(_options.RetryBaseSeconds, 1, 300);
        var maxSeconds = Math.Clamp(_options.RetryMaxSeconds, baseSeconds, 3_600);
        var exponent = Math.Min(Math.Max(attemptCount - 1, 0), 10);
        return TimeSpan.FromSeconds(Math.Min(maxSeconds, baseSeconds * Math.Pow(2, exponent)));
    }

    private int MaxAttempts => Math.Clamp(_options.RetryMaxAttempts, 1, 10_000);

    private TimeSpan RetryLease => TimeSpan.FromSeconds(Math.Max(
        Math.Clamp(_options.RetryLeaseSeconds, 30, 300),
        Math.Clamp(_options.RequestTimeoutSeconds, 5, 60) + 30));
}
