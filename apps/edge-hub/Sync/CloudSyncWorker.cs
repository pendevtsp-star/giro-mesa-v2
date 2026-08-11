using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Sync;

public sealed class LocalEnvelopeException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

public sealed class CloudEventValidationException(IReadOnlyList<int> eventIndexes)
    : Exception("SYNC_EVENT_SCHEMA_INVALID")
{
    public IReadOnlyList<int> EventIndexes { get; } = eventIndexes;
}

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
            var pending = await store.GetPendingAsync(SyncEnvelopeLimits.MaximumBatchEvents, includeSecrets: true);
            var pendingAcknowledgements = await store.GetPendingCloudAcknowledgementsAsync(
                SyncEnvelopeLimits.MaximumAcknowledgements);
            IReadOnlyList<string> acknowledgements = pendingAcknowledgements;
            var responses = new List<SyncResponse>();
            var sendable = new List<PendingEvent>();
            var needsReconciliation = false;
            foreach (var item in pending)
            {
                try
                {
                    _ = CreateOutboundEvent(item);
                    sendable.Add(item);
                }
                catch (LocalEnvelopeException exception)
                {
                    await store.RejectEventAsync(item.Id, exception.Code);
                    _authoritativeOutcomes[item.Id] = new(
                        item.Id,
                        false,
                        new("reconcile", exception.Code));
                    needsReconciliation = true;
                }
            }
            AuthoritativeOutcomes = _authoritativeOutcomes.Values.OrderBy(value => value.Id).ToArray();
            foreach (var group in sendable.GroupBy(item => item.ProtocolVersion).OrderBy(group => group.Key))
            {
                foreach (var batch in PartitionBatches(group.ToArray(), acknowledgements, group.Key))
                {
                    needsReconciliation =
                        await PostBatchIsolatedAsync(
                            batch,
                            acknowledgements,
                            group.Key,
                            responses,
                            cancellationToken) || needsReconciliation;
                    acknowledgements = [];
                }
            }
            if (responses.Count == 0)
                responses.Add(await PostBatchAsync([], acknowledgements, 2, cancellationToken));

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
        if (!SyncEnvelopeLimits.ProtocolVersions.Contains(protocolVersion) ||
            acknowledgedCommandIds.Count > SyncEnvelopeLimits.MaximumAcknowledgements)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        var canonicalAcknowledgements = acknowledgedCommandIds.Select(CanonicalUuid).ToArray();
        var outboundEvents = events.Select(CreateOutboundEvent).ToArray();
        var batch = new SyncBatch(
            protocolVersion,
            HubVersion(),
            new Dictionary<string, object>(),
            canonicalAcknowledgements,
            outboundEvents);
        if (JsonSerializer.SerializeToUtf8Bytes(batch, JsonOptions).Length > SyncEnvelopeLimits.MaximumBatchBytes)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_LIMIT_EXCEEDED");
        using var response = await httpClient.PostAsJsonAsync(
            "/api/v1/sync/batches",
            batch,
            cancellationToken);
        if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity)
        {
            var eventIndexes = await ReadAuthenticatedEventValidationAsync(response, events.Count, cancellationToken);
            if (eventIndexes is not null) throw new CloudEventValidationException(eventIndexes);
        }
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<SyncResponse>(cancellationToken)
            ?? throw new InvalidOperationException("Cloud returned an empty sync acknowledgement.");
    }

    private async Task<bool> PostBatchIsolatedAsync(
        IReadOnlyList<PendingEvent> events,
        IReadOnlyList<string> acknowledgedCommandIds,
        int protocolVersion,
        List<SyncResponse> responses,
        CancellationToken cancellationToken)
    {
        try
        {
            responses.Add(await PostBatchAsync(
                events,
                acknowledgedCommandIds,
                protocolVersion,
                cancellationToken));
            return false;
        }
        catch (CloudEventValidationException exception)
        {
            var rejectedIndexes = exception.EventIndexes.ToHashSet();
            foreach (var index in rejectedIndexes)
            {
                var item = events[index];
                await store.RejectEventAsync(item.Id, "SYNC_EVENT_SCHEMA_INVALID");
                _authoritativeOutcomes[item.Id] = new(
                    item.Id,
                    false,
                    new("reconcile", "SYNC_EVENT_SCHEMA_INVALID"));
            }
            AuthoritativeOutcomes = _authoritativeOutcomes.Values.OrderBy(value => value.Id).ToArray();

            var validSiblings = events.Where((_, index) => !rejectedIndexes.Contains(index)).ToArray();
            if (validSiblings.Length > 0)
            {
                _ = await PostBatchIsolatedAsync(
                    validSiblings,
                    [],
                    protocolVersion,
                    responses,
                    cancellationToken);
            }
            if (acknowledgedCommandIds.Count > 0)
            {
                responses.Add(await PostBatchAsync(
                    [],
                    acknowledgedCommandIds,
                    protocolVersion,
                    cancellationToken));
            }
            return true;
        }
    }

    private async Task<IReadOnlyList<int>?> ReadAuthenticatedEventValidationAsync(
        HttpResponseMessage response,
        int submittedEventCount,
        CancellationToken cancellationToken)
    {
        if (!IsAuthenticatedCloudJson(response) ||
            submittedEventCount < 1 ||
            submittedEventCount > SyncEnvelopeLimits.MaximumBatchEvents)
            return null;

        var bytes = await ReadBoundedProblemBodyAsync(response.Content, cancellationToken);
        if (bytes is null) return null;
        try
        {
            using var document = JsonDocument.Parse(bytes);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            var properties = root.EnumerateObject().ToArray();
            if (properties.Length != 3 ||
                properties.Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() != 3 ||
                properties.Any(property => property.Name is not ("code" or "scope" or "eventIndexes")))
                return null;
            if (!root.TryGetProperty("code", out var code) ||
                code.ValueKind != JsonValueKind.String ||
                code.GetString() != "SYNC_EVENT_SCHEMA_INVALID" ||
                !root.TryGetProperty("scope", out var scope) ||
                scope.ValueKind != JsonValueKind.String ||
                scope.GetString() != "event" ||
                !root.TryGetProperty("eventIndexes", out var indexesElement) ||
                indexesElement.ValueKind != JsonValueKind.Array)
                return null;

            var indexes = new List<int>();
            foreach (var element in indexesElement.EnumerateArray())
            {
                if (!element.TryGetInt32(out var index) || index < 0 || index >= submittedEventCount)
                    return null;
                if (indexes.Count > 0 && index <= indexes[^1]) return null;
                indexes.Add(index);
                if (indexes.Count > SyncEnvelopeLimits.MaximumBatchEvents) return null;
            }
            return indexes.Count > 0 ? indexes : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private bool IsAuthenticatedCloudJson(HttpResponseMessage response)
    {
        var mediaType = response.Content.Headers.ContentType?.MediaType;
        if (mediaType is null ||
            !(mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase) ||
              mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase)))
            return false;
        var requestUri = response.RequestMessage?.RequestUri;
        var authorization = response.RequestMessage?.Headers.Authorization;
        var configuredBase = Uri.TryCreate(_options.CloudApiBaseUrl, UriKind.Absolute, out var value) ? value : null;
        return configuredBase is not null &&
            configuredBase.Scheme == Uri.UriSchemeHttps &&
            requestUri is not null &&
            requestUri.Scheme == Uri.UriSchemeHttps &&
            requestUri.Host.Equals(configuredBase.Host, StringComparison.OrdinalIgnoreCase) &&
            requestUri.Port == configuredBase.Port &&
            authorization?.Scheme.Equals("GiroMesaHub", StringComparison.OrdinalIgnoreCase) == true &&
            !string.IsNullOrEmpty(authorization.Parameter) &&
            !string.IsNullOrEmpty(_options.CloudSyncKey) &&
            SecretsEqual(authorization.Parameter, _options.CloudSyncKey);
    }

    private static bool SecretsEqual(string actual, string expected)
    {
        var actualDigest = SHA256.HashData(Encoding.UTF8.GetBytes(actual));
        var expectedDigest = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        return CryptographicOperations.FixedTimeEquals(actualDigest, expectedDigest);
    }

    private static async Task<byte[]?> ReadBoundedProblemBodyAsync(
        HttpContent content,
        CancellationToken cancellationToken)
    {
        const int maximumProblemBytes = 8_192;
        if (content.Headers.ContentLength is > maximumProblemBytes) return null;
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        var buffer = new byte[maximumProblemBytes + 1];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(length, buffer.Length - length), cancellationToken);
            if (read == 0) break;
            length += read;
        }
        return length <= maximumProblemBytes ? buffer.AsSpan(0, length).ToArray() : null;
    }

    public static object CreateOutboundEvent(PendingEvent item)
    {
        var commandId = CanonicalUuid(item.Id);
        var actorId = CanonicalUuid(item.ActorId);
        var deviceId = CanonicalUuid(item.DeviceId);
        var idempotencyKey = item.IdempotencyKey.Trim();
        var eventType = item.Type.Trim();
        if (!LengthBetween(
                idempotencyKey,
                SyncEnvelopeLimits.MinimumIdempotencyKeyLength,
                SyncEnvelopeLimits.MaximumIdempotencyKeyLength) ||
            !LengthBetween(
                eventType,
                SyncEnvelopeLimits.MinimumEventTypeLength,
                SyncEnvelopeLimits.MaximumEventTypeLength) ||
            item.Version < SyncEnvelopeLimits.MinimumCommandVersion ||
            item.Version > SyncEnvelopeLimits.MaximumCommandVersion ||
            item.OccurredAt < DateTimeOffset.UtcNow.AddDays(-SyncEnvelopeLimits.MaximumOfflineCommandAgeDays) ||
            item.OccurredAt > DateTimeOffset.UtcNow.AddSeconds(SyncEnvelopeLimits.MaximumFutureClockSkewSeconds))
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        if (Encoding.UTF8.GetByteCount(item.Payload) > SyncEnvelopeLimits.MaximumPayloadBytes)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_LIMIT_EXCEEDED");
        if (item.ProtocolVersion == 1)
        {
            var legacy = new LegacySyncEvent(
                commandId, actorId, deviceId, idempotencyKey, eventType,
                ParsePayload(item.Payload), item.Version, item.OccurredAt);
            if (JsonSerializer.SerializeToUtf8Bytes(legacy, JsonOptions).Length > SyncEnvelopeLimits.MaximumEventBytes)
                throw new LocalEnvelopeException("LOCAL_ENVELOPE_LIMIT_EXCEEDED");
            return legacy;
        }
        if (item.ProtocolVersion != 2 || item.ResourcePreconditions is not { Count: > 0 } ||
            item.AggregateSequence is null ||
            item.AggregateSequence < SyncEnvelopeLimits.MinimumAggregateSequence ||
            item.AggregateSequence > SyncEnvelopeLimits.MaximumAggregateSequence)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        var resources = item.ResourcePreconditions
            .Select(resource => new ResourcePrecondition(
                resource.Type?.Trim() ?? throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID"),
                CanonicalUuid(resource.Id),
                CanonicalUuid(resource.OccupancyEpoch),
                resource.ResourceVersion))
            .OrderBy(resource => resource.Type, StringComparer.Ordinal)
            .ThenBy(resource => resource.Id, StringComparer.Ordinal)
            .ToArray();
        if (resources.Length > SyncEnvelopeLimits.MaximumResourcePreconditions)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_LIMIT_EXCEEDED");
        if (resources.Select(resource => $"{resource.Type}:{resource.Id}").Distinct(StringComparer.Ordinal).Count() != resources.Length ||
            resources.Any(resource =>
                !LengthBetween(
                    resource.Type,
                    SyncEnvelopeLimits.MinimumAggregateTypeLength,
                    SyncEnvelopeLimits.MaximumAggregateTypeLength) ||
                resource.ResourceVersion < SyncEnvelopeLimits.MinimumResourceVersion ||
                resource.ResourceVersion > SyncEnvelopeLimits.MaximumResourceVersion))
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        if (item.PrimaryResourceId is null)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        var primaryResourceId = CanonicalUuid(item.PrimaryResourceId);
        var primary = resources.SingleOrDefault(resource =>
            resource.Type == "tab" && resource.Id == primaryResourceId)
            ?? throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        var priceReferences = (item.PriceReferences ?? [])
            .Select(reference => new PriceReference(
                reference.Kind?.Trim() ?? throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID"),
                CanonicalUuid(reference.EntityId),
                reference.PriceRevision?.Trim() ?? throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID"),
                reference.Token?.Trim() ?? throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID")))
            .DistinctBy(reference => (reference.Kind, reference.EntityId, reference.PriceRevision))
            .OrderBy(reference => reference.Kind, StringComparer.Ordinal)
            .ThenBy(reference => reference.EntityId, StringComparer.Ordinal)
            .ThenBy(reference => reference.PriceRevision, StringComparer.Ordinal)
            .ToArray();
        if (priceReferences.Length > SyncEnvelopeLimits.MaximumPriceReferences)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_LIMIT_EXCEEDED");
        if (priceReferences.Any(reference =>
                !SyncEnvelopeLimits.PriceReferenceKinds.Contains(reference.Kind) ||
                !LengthBetween(
                    reference.PriceRevision,
                    SyncEnvelopeLimits.MinimumPriceRevisionLength,
                    SyncEnvelopeLimits.MaximumPriceRevisionLength) ||
                !LengthBetween(
                    reference.Token,
                    SyncEnvelopeLimits.MinimumPriceTokenLength,
                    SyncEnvelopeLimits.MaximumPriceTokenLength)))
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        var outbound = new OrderedSyncEvent(
            commandId, actorId, deviceId, idempotencyKey, eventType,
            ParsePayload(item.Payload),
            new CommandAggregate(primary.Type, primary.Id),
            primary.OccupancyEpoch,
            primary.ResourceVersion,
            item.AggregateSequence.Value,
            resources,
            priceReferences);
        if (JsonSerializer.SerializeToUtf8Bytes(outbound, JsonOptions).Length > SyncEnvelopeLimits.MaximumEventBytes)
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_LIMIT_EXCEEDED");
        return outbound;
    }

    private static string CanonicalUuid(string? value)
    {
        if (!SyncEnvelopeLimits.IsCanonicalUuid(value))
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        return value ?? throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
    }

    private static bool LengthBetween(string value, int minimum, int maximum) =>
        value.Length >= minimum && value.Length <= maximum;

    private static IReadOnlyList<IReadOnlyList<PendingEvent>> PartitionBatches(
        IReadOnlyList<PendingEvent> events,
        IReadOnlyList<string> acknowledgedCommandIds,
        int protocolVersion)
    {
        var batches = new List<IReadOnlyList<PendingEvent>>();
        var current = new List<PendingEvent>();
        IReadOnlyList<string> acknowledgements = acknowledgedCommandIds;
        foreach (var item in events)
        {
            var candidate = current.Append(item).ToArray();
            var outbound = candidate.Select(CreateOutboundEvent).ToArray();
            var size = JsonSerializer.SerializeToUtf8Bytes(
                new SyncBatch(protocolVersion, HubVersion(), new Dictionary<string, object>(), acknowledgements, outbound),
                JsonOptions).Length;
            if (size <= SyncEnvelopeLimits.MaximumBatchBytes)
            {
                current.Add(item);
                continue;
            }
            if (current.Count == 0) throw new LocalEnvelopeException("LOCAL_ENVELOPE_LIMIT_EXCEEDED");
            batches.Add(current.ToArray());
            current = [item];
            acknowledgements = [];
        }
        if (current.Count > 0) batches.Add(current.ToArray());
        return batches;
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
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            throw new LocalEnvelopeException("LOCAL_ENVELOPE_INVALID");
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
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
