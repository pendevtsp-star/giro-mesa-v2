using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Sync;

public sealed class CloudSyncWorker(
    HttpClient httpClient,
    HubStore store,
    FocusCredentialStore fiscalCredentials,
    CloudPrinterCommandProcessor printerCommands,
    IOptions<HubOptions> options,
    ILogger<CloudSyncWorker> logger) : BackgroundService
{
    private readonly HubOptions _options = options.Value;
    private bool _configured;
    private int _consecutiveFailures;
    private DateTimeOffset? _lastNetworkSyncAt;
    public string Status { get; private set; } = "not-configured";
    public DateTimeOffset? LastSuccessfulSyncAt { get; private set; }
    public string? LastErrorCode { get; private set; }
    public DateTimeOffset? NextRetryAt { get; private set; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!CanSynchronize())
        {
            try
            {
                await ProcessDurableCommandsAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "Persisted cloud commands could not be processed at startup");
            }
            logger.LogWarning("Cloud synchronization is disabled until CloudApiBaseUrl and CloudSyncKey are configured");
            return;
        }

        ConfigureClient();
        while (!stoppingToken.IsCancellationRequested)
        {
            await SyncOnceAsync(stoppingToken);
            var delay = _consecutiveFailures == 0
                ? TimeSpan.FromSeconds(Math.Clamp(_options.SyncIntervalSeconds, 1, 60))
                : BackoffDelay();
            NextRetryAt = DateTimeOffset.UtcNow.Add(delay);
            await Task.Delay(delay, stoppingToken);
        }
    }

    public async Task SyncOnceAsync(CancellationToken cancellationToken = default)
    {
        if (!CanSynchronize())
        {
            await ProcessDurableCommandsAsync(cancellationToken);
            Status = "not-configured";
            return;
        }
        ConfigureClient();
        try
        {
            await ProcessDurableCommandsAsync(cancellationToken);
            Status = "syncing";
            var pending = await store.GetPendingAsync(100, includeSecrets: true);
            var acknowledgements = await store.GetPendingCloudAcknowledgementsAsync(100);
            var commandResults = await store.GetPendingCloudCommandResultsAsync(100);
            var now = DateTimeOffset.UtcNow;
            var emptyInterval = TimeSpan.FromSeconds(Math.Clamp(_options.EmptySyncIntervalSeconds, 1, 60));
            if (_consecutiveFailures == 0 && pending.Count == 0 && acknowledgements.Count == 0 &&
                _lastNetworkSyncAt is { } lastNetworkSyncAt && now - lastNetworkSyncAt < emptyInterval)
            {
                Status = "idle";
                return;
            }
            var revision = await store.GetSnapshotRevisionAsync();
            var response = await PostBatchAsync(
                pending,
                acknowledgements,
                commandResults,
                revision,
                cancellationToken);

            await ApplyResponseAsync(response, cancellationToken);
            await store.MarkCloudAcknowledgementsAsync(acknowledgements);

            var processedCommandIds = await store.GetPendingCloudAcknowledgementsAsync(100);
            if (processedCommandIds.Count > 0)
            {
                var processedCommandResults = await store.GetPendingCloudCommandResultsAsync(100);
                var acknowledgementResponse = await PostBatchAsync(
                    [],
                    processedCommandIds,
                    processedCommandResults,
                    response.SnapshotRevision ?? revision,
                    cancellationToken);
                await ApplyResponseAsync(acknowledgementResponse, cancellationToken);
                await store.MarkCloudAcknowledgementsAsync(processedCommandIds);
            }
            await store.MarkSyncSuccessfulAsync(DateTimeOffset.UtcNow);
            _lastNetworkSyncAt = DateTimeOffset.UtcNow;
            LastSuccessfulSyncAt = DateTimeOffset.UtcNow;
            LastErrorCode = null;
            NextRetryAt = null;
            _consecutiveFailures = 0;
            Status = "idle";
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _consecutiveFailures += 1;
            Status = "offline";
            LastErrorCode = ErrorCode(exception);
            NextRetryAt = DateTimeOffset.UtcNow.Add(BackoffDelay());
            logger.LogWarning(exception, "Cloud synchronization failed; durable local queues were preserved");
        }
    }

    private async Task ApplyResponseAsync(
        SyncResponse response,
        CancellationToken cancellationToken)
    {
        fiscalCredentials.Apply(response.FiscalConfiguration);
        await store.SaveCloudCommandsAsync(response.Commands);
        foreach (var eventId in response.AcceptedEventIds)
        {
            await store.AcknowledgeAsync(eventId);
        }
        foreach (var rejection in response.RejectedEvents)
        {
            await store.RejectEventAsync(rejection.Id, rejection.Code);
        }
        if (response.Snapshot is not null)
        {
            if (_options.UnitId != "unconfigured" && response.Snapshot.UnitId != _options.UnitId)
            {
                throw new InvalidOperationException("Cloud snapshot does not match the configured hub unit.");
            }
            await store.SaveOperationalSnapshotAsync(response.Snapshot, response.SnapshotRevision);
        }
        await ProcessDurableCommandsAsync(cancellationToken);
    }

    private async Task ProcessDurableCommandsAsync(CancellationToken cancellationToken = default)
    {
        await store.ProcessPendingCloudCommandsAsync();
        await printerCommands.ProcessPendingAsync(cancellationToken);
    }

    private async Task<SyncResponse> PostBatchAsync(
        IReadOnlyList<PendingEvent> events,
        IReadOnlyList<string> acknowledgedCommandIds,
        IReadOnlyList<JsonElement> commandResults,
        string? snapshotRevision,
        CancellationToken cancellationToken)
    {
        var outboundEvents = events.Select(item => new SyncEvent(
            item.Id,
            item.ActorId,
            item.DeviceId,
            item.IdempotencyKey,
            item.Type,
            ParsePayload(item.Payload),
            item.Version,
            item.OccurredAt)).ToArray();
        using var response = await httpClient.PostAsJsonAsync(
            "/api/v1/sync/batches",
            new SyncBatch(
                1,
                HubVersion(),
                snapshotRevision is null
                    ? new Dictionary<string, object>()
                    : new Dictionary<string, object> { ["snapshotRevision"] = snapshotRevision },
                acknowledgedCommandIds,
                commandResults,
                outboundEvents),
            cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<SyncResponse>(cancellationToken)
            ?? throw new InvalidOperationException("Cloud returned an empty sync acknowledgement.");
    }

    private bool CanSynchronize() =>
        !string.IsNullOrWhiteSpace(_options.CloudApiBaseUrl) &&
        !string.IsNullOrWhiteSpace(_options.CloudSyncKey);

    private void ConfigureClient()
    {
        if (_configured) return;
        httpClient.BaseAddress = new Uri(_options.CloudApiBaseUrl!, UriKind.Absolute);
        httpClient.Timeout = TimeSpan.FromSeconds(Math.Clamp(_options.CloudRequestTimeoutSeconds, 2, 30));
        httpClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("GiroMesaHub", _options.CloudSyncKey);
        _configured = true;
    }

    private static string HubVersion() =>
        typeof(CloudSyncWorker).Assembly.GetName().Version?.ToString() ?? "2.0.0";

    private static JsonElement ParsePayload(string payload)
    {
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.Clone();
    }

    private TimeSpan BackoffDelay()
    {
        var baseSeconds = Math.Clamp(_options.SyncIntervalSeconds, 1, 60);
        var exponent = Math.Min(Math.Max(_consecutiveFailures - 1, 0), 6);
        var seconds = Math.Min(60, baseSeconds * Math.Pow(2, exponent));
        return TimeSpan.FromMilliseconds(seconds * 1_000 * (1 + Random.Shared.NextDouble() * 0.2));
    }

    private static string ErrorCode(Exception exception) => exception switch
    {
        HttpRequestException { StatusCode: { } statusCode } => $"CLOUD_HTTP_{(int)statusCode}",
        HttpRequestException => "CLOUD_UNREACHABLE",
        JsonException => "CLOUD_PROTOCOL_INVALID",
        TaskCanceledException => "CLOUD_TIMEOUT",
        InvalidOperationException invalid when invalid.Message.Contains("snapshot", StringComparison.OrdinalIgnoreCase) =>
            "CLOUD_SNAPSHOT_INVALID",
        _ => "CLOUD_SYNC_FAILED",
    };
}

public sealed record SyncBatch(
    int ProtocolVersion,
    string HubVersion,
    IReadOnlyDictionary<string, object> Metadata,
    IReadOnlyList<string> AcknowledgedCommandIds,
    IReadOnlyList<JsonElement> CommandResults,
    IReadOnlyList<SyncEvent> Events);

public sealed record SyncEvent(
    string Id,
    string ActorId,
    string DeviceId,
    string IdempotencyKey,
    string Type,
    JsonElement Payload,
    int Version,
    DateTimeOffset OccurredAt);

public sealed record RejectedEvent(string Id, string Code);

public sealed record SyncResponse(
    IReadOnlyList<string> AcceptedEventIds,
    IReadOnlyList<RejectedEvent> RejectedEvents,
    IReadOnlyList<CloudCommand> Commands,
    DateTimeOffset ServerTime,
    OperationalSnapshot? Snapshot = null,
    string? SnapshotRevision = null,
    bool SnapshotUnchanged = false,
    FocusRuntimeConfiguration? FiscalConfiguration = null);
