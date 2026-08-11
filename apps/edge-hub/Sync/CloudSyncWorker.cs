using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Sync;

public sealed record EdgeConflictInput(
    string CommandType,
    string Delivery,
    string Protocol,
    string? CommandEpoch,
    string? CurrentEpoch,
    int? CommandVersion,
    int? CurrentVersion,
    string ResourceState);

public sealed record EdgeConflictDecision(string Outcome, string Code);

public static class EdgeConflictMatrix
{
    public static EdgeConflictDecision Decide(EdgeConflictInput input)
    {
        var transport = input.Delivery switch
        {
            "new" => null,
            "duplicate-identical" => Decision("replay", "IDENTICAL_COMMAND_REPLAY"),
            "duplicate-divergent" => Decision("reject", "IDEMPOTENCY_KEY_REUSED"),
            "gap" => Decision("reconcile", "AGGREGATE_SEQUENCE_GAP"),
            "reordered" => Decision("reconcile", "AGGREGATE_SEQUENCE_OUT_OF_ORDER"),
            _ => throw new ArgumentOutOfRangeException(nameof(input), "Unknown delivery state."),
        };
        if (transport is not null) return transport;

        if (!TryPolicy(input.CommandType, out var policy))
        {
            return Decision("reject", "UNSUPPORTED_PILOT_COMMAND");
        }
        if (input.Protocol == "legacy")
        {
            if (policy.CreatesResource && input.ResourceState == "missing")
                return Decision("apply", "LEGACY_SAFE_CREATE");
            if (policy.CommutativeWhenStale && input.ResourceState == "active")
                return Decision("apply", "LEGACY_COMMUTATIVE_ADD");
            return Decision("reject", "LEGACY_PRECONDITION_REQUIRED");
        }
        if (input.Protocol != "ordered")
            throw new ArgumentOutOfRangeException(nameof(input), "Unknown protocol policy.");

        if (input.ResourceState == "missing")
        {
            return policy.CreatesResource && input.CommandVersion == 0
                ? Decision("apply", "INITIAL_RESOURCE")
                : Decision("reject", "RESOURCE_NOT_FOUND");
        }
        if (input.ResourceState == "terminal") return Decision("reject", "RESOURCE_TERMINAL");
        if (input.ResourceState != "active")
            throw new ArgumentOutOfRangeException(nameof(input), "Unknown resource state.");
        if (input.CommandEpoch != input.CurrentEpoch)
            return Decision("reconcile", "OCCUPANCY_EPOCH_MISMATCH");
        if (input.CommandVersion is null || input.CurrentVersion is null)
            return Decision("reject", "RESOURCE_PRECONDITION_REQUIRED");
        if (input.CommandVersion > input.CurrentVersion)
            return Decision("reconcile", "RESOURCE_VERSION_AHEAD");
        if (input.CommandVersion < input.CurrentVersion)
        {
            return policy.CommutativeWhenStale
                ? Decision("apply", "COMMUTATIVE_STALE_VERSION")
                : Decision("reject", "RESOURCE_VERSION_CONFLICT");
        }
        return Decision("apply", "CURRENT_RESOURCE");
    }

    private static EdgeConflictDecision Decision(string outcome, string code) => new(outcome, code);

    private static bool TryPolicy(string commandType, out CommandPolicy policy)
    {
        switch (commandType)
        {
            case "pos.tab.open_requested":
                policy = new(true, false);
                return true;
            case "pos.order.create_requested":
                policy = new(false, true);
                return true;
            case "pos.order.send_requested":
            case "pos.tab.transfer_requested":
            case "pos.tabs.merge_requested":
            case "pos.tab.split_requested":
            case "pos.tab.service_charge_requested":
            case "pos.tab.tip_requested":
            case "pos.item.discount_requested":
            case "pos.item.cancel_requested":
            case "pos.kds.transition_requested":
                policy = new(false, false);
                return true;
            default:
                policy = default;
                return false;
        }
    }

    private readonly record struct CommandPolicy(bool CreatesResource, bool CommutativeWhenStale);
}

public sealed class CloudSyncWorker(
    HttpClient httpClient,
    HubStore store,
    IOptions<HubOptions> options,
    ILogger<CloudSyncWorker> logger) : BackgroundService
{
    private readonly HubOptions _options = options.Value;
    private readonly Dictionary<string, ServerEventOutcome> _authoritativeOutcomes = new(StringComparer.Ordinal);
    private bool _configured;
    public string Status { get; private set; } = "not-configured";
    public IReadOnlyList<ServerEventOutcome> AuthoritativeOutcomes { get; private set; } = [];

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
            var pendingAcknowledgements = await store.GetPendingCloudAcknowledgementsAsync(100);
            IReadOnlyList<string> acknowledgements = pendingAcknowledgements;
            var responses = new List<SyncResponse>();
            foreach (var group in pending.GroupBy(item => item.ProtocolVersion).OrderBy(group => group.Key))
            {
                responses.Add(await PostBatchAsync(group.ToArray(), acknowledgements, group.Key, cancellationToken));
                acknowledgements = [];
            }
            if (responses.Count == 0)
                responses.Add(await PostBatchAsync([], acknowledgements, 2, cancellationToken));

            var needsReconciliation = false;
            foreach (var response in responses)
                needsReconciliation = await ApplyResponseAsync(response, needsReconciliation);
            await store.MarkCloudAcknowledgementsAsync(pendingAcknowledgements);

            var receivedCommandIds = responses.SelectMany(response => response.Commands)
                .Select(command => command.Id).Distinct().ToArray();
            if (receivedCommandIds.Length > 0)
            {
                var acknowledgementResponse = await PostBatchAsync([], receivedCommandIds, 2, cancellationToken);
                needsReconciliation = await ApplyResponseAsync(acknowledgementResponse, needsReconciliation);
                await store.MarkCloudAcknowledgementsAsync(receivedCommandIds);
            }
            Status = needsReconciliation ? "reconciling" : "idle";
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

    private async Task<bool> ApplyResponseAsync(SyncResponse response, bool priorReconciliation)
    {
        await store.SaveCloudCommandsAsync(response.Commands);
        var authoritative = response.EventResults ?? [];
        var classifiedIds = authoritative.Select(outcome => outcome.Id).ToHashSet(StringComparer.Ordinal);
        var needsReconciliation = priorReconciliation;
        foreach (var outcome in authoritative)
        {
            switch (outcome.Status)
            {
                case "applied":
                    await store.AcknowledgeAsync(outcome.Id);
                    _authoritativeOutcomes.Remove(outcome.Id);
                    break;
                case "rejected":
                    await store.RejectEventAsync(outcome.Id, outcome.Code ?? "COMMAND_REJECTED");
                    _authoritativeOutcomes.Remove(outcome.Id);
                    break;
                case "quarantined":
                case "reconcile":
                    needsReconciliation = true;
                    _authoritativeOutcomes[outcome.Id] = outcome;
                    break;
                default:
                    needsReconciliation = true;
                    _authoritativeOutcomes[outcome.Id] = outcome;
                    logger.LogWarning(
                        "Cloud returned unknown authoritative outcome {Outcome} for event {EventId}",
                        outcome.Status,
                        outcome.Id);
                    break;
            }
        }
        foreach (var eventId in response.AcceptedEventIds.Where(id => !classifiedIds.Contains(id)))
        {
            await store.AcknowledgeAsync(eventId);
            _authoritativeOutcomes.Remove(eventId);
        }
        foreach (var rejection in response.RejectedEvents.Where(item => !classifiedIds.Contains(item.Id)))
        {
            await store.RejectEventAsync(rejection.Id, rejection.Code);
            _authoritativeOutcomes.Remove(rejection.Id);
        }
        AuthoritativeOutcomes = _authoritativeOutcomes.Values.OrderBy(value => value.Id).ToArray();
        if (response.Snapshot is not null && !needsReconciliation)
        {
            if (_options.UnitId != "unconfigured" && response.Snapshot.UnitId != _options.UnitId)
            {
                throw new InvalidOperationException("Cloud snapshot does not match the configured hub unit.");
            }
            await store.SaveOperationalSnapshotAsync(response.Snapshot);
        }
        return needsReconciliation;
    }

    private async Task<SyncResponse> PostBatchAsync(
        IReadOnlyList<PendingEvent> events,
        IReadOnlyList<string> acknowledgedCommandIds,
        int protocolVersion,
        CancellationToken cancellationToken)
    {
        if (events.Any(item => item.ProtocolVersion != protocolVersion))
            throw new InvalidOperationException("A sync batch cannot mix protocol versions.");
        var outboundEvents = events.Select(CreateOutboundEvent).ToArray();
        using var response = await httpClient.PostAsJsonAsync(
            "/api/v1/sync/batches",
            new SyncBatch(protocolVersion, HubVersion(), new Dictionary<string, object>(), acknowledgedCommandIds, outboundEvents),
            cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<SyncResponse>(cancellationToken)
            ?? throw new InvalidOperationException("Cloud returned an empty sync acknowledgement.");
    }

    public static object CreateOutboundEvent(PendingEvent item)
    {
        if (item.ProtocolVersion == 1)
            return new LegacySyncEvent(
                item.Id, item.ActorId, item.DeviceId, item.IdempotencyKey, item.Type,
                ParsePayload(item.Payload), item.Version, item.OccurredAt);
        if (item.ProtocolVersion != 2 || item.ResourcePreconditions is not { Count: > 0 } ||
            item.AggregateSequence is null)
            throw new InvalidOperationException("Ordered event metadata is incomplete.");
        var resources = item.ResourcePreconditions
            .OrderBy(resource => resource.Type, StringComparer.Ordinal)
            .ThenBy(resource => resource.Id, StringComparer.Ordinal)
            .ToArray();
        if (item.PrimaryResourceId is null)
            throw new InvalidOperationException("Ordered primary resource is missing.");
        var primary = resources.Single(resource =>
            resource.Type == "tab" && resource.Id == item.PrimaryResourceId);
        return new OrderedSyncEvent(
            item.Id, item.ActorId, item.DeviceId, item.IdempotencyKey, item.Type,
            ParsePayload(item.Payload),
            new CommandAggregate(primary.Type, primary.Id),
            primary.OccupancyEpoch,
            primary.ResourceVersion,
            item.AggregateSequence.Value,
            resources,
            item.PriceReferences ?? []);
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
    IReadOnlyList<object> Events);

public sealed record LegacySyncEvent(
    string Id,
    string ActorId,
    string DeviceId,
    string IdempotencyKey,
    string Type,
    JsonElement Payload,
    int Version,
    DateTimeOffset OccurredAt);

public sealed record CommandAggregate(string Type, string Id);

public sealed record OrderedSyncEvent(
    string CommandId,
    string ActorId,
    string DeviceId,
    string IdempotencyKey,
    string Type,
    JsonElement Payload,
    CommandAggregate Aggregate,
    string OccupancyEpoch,
    int ResourceVersion,
    int AggregateSequence,
    IReadOnlyList<ResourcePrecondition> ResourcePreconditions,
    IReadOnlyList<PriceReference> PriceReferences);

public sealed record RejectedEvent(string Id, string Code);

public sealed record ServerEventResult(string Status, string? Code);

public sealed record ServerEventOutcome(string Id, bool Replayed, ServerEventResult Result)
{
    public string Status => Result.Status;
    public string? Code => Result.Code;
}

public sealed record SyncResponse(
    IReadOnlyList<string> AcceptedEventIds,
    IReadOnlyList<RejectedEvent> RejectedEvents,
    IReadOnlyList<CloudCommand> Commands,
    DateTimeOffset ServerTime,
    OperationalSnapshot? Snapshot = null,
    IReadOnlyList<ServerEventOutcome>? EventResults = null);
