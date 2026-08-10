using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Sync;

public sealed class CloudSyncWorker(
    HttpClient httpClient,
    HubStore store,
    IOptions<HubOptions> options,
    ILogger<CloudSyncWorker> logger) : BackgroundService
{
    private readonly HubOptions _options = options.Value;
    private bool _configured;
    public string Status { get; private set; } = "not-configured";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!CanSynchronize())
        {
            logger.LogWarning("Cloud synchronization is disabled until CloudApiBaseUrl and CloudSyncKey are configured");
            return;
        }

        ConfigureClient();
        while (!stoppingToken.IsCancellationRequested)
        {
            await SyncOnceAsync(stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(_options.SyncIntervalSeconds, 1, 60)), stoppingToken);
        }
    }

    public async Task SyncOnceAsync(CancellationToken cancellationToken = default)
    {
        if (!CanSynchronize())
        {
            Status = "not-configured";
            return;
        }
        ConfigureClient();
        try
        {
            Status = "syncing";
            var pending = await store.GetPendingAsync(100, includeSecrets: true);
            var acknowledgements = await store.GetPendingCloudAcknowledgementsAsync(100);
            var response = await PostBatchAsync(pending, acknowledgements, cancellationToken);

            await ApplyResponseAsync(response);
            await store.MarkCloudAcknowledgementsAsync(acknowledgements);

            var receivedCommandIds = response.Commands.Select(command => command.Id).Distinct().ToArray();
            if (receivedCommandIds.Length > 0)
            {
                var acknowledgementResponse = await PostBatchAsync([], receivedCommandIds, cancellationToken);
                await ApplyResponseAsync(acknowledgementResponse);
                await store.MarkCloudAcknowledgementsAsync(receivedCommandIds);
            }
            Status = "idle";
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            Status = "offline";
            logger.LogWarning(exception, "Cloud synchronization failed; durable local queues were preserved");
        }
    }

    private async Task ApplyResponseAsync(SyncResponse response)
    {
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
            await store.SaveOperationalSnapshotAsync(response.Snapshot);
        }
    }

    private async Task<SyncResponse> PostBatchAsync(
        IReadOnlyList<PendingEvent> events,
        IReadOnlyList<string> acknowledgedCommandIds,
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
            new SyncBatch(1, HubVersion(), new Dictionary<string, object>(), acknowledgedCommandIds, outboundEvents),
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
}

public sealed record SyncBatch(
    int ProtocolVersion,
    string HubVersion,
    IReadOnlyDictionary<string, object> Metadata,
    IReadOnlyList<string> AcknowledgedCommandIds,
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
    OperationalSnapshot? Snapshot = null);
