using System.Net;
using System.Text;
using System.Text.Json;
using GiroMesa.EdgeHub.Storage;
using GiroMesa.EdgeHub.Sync;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class CloudSyncWorkerTests : IAsyncLifetime
{
    private const string ValidOrganizationId = "11111111-1111-4111-8111-111111111111";
    private const string ValidUnitId = "22222222-2222-4222-8222-222222222222";
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(),
        "giromesa-edgehub-sync-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task PushesPullsPersistsAndAcknowledgesWithoutLooping()
    {
        var options = Options.Create(new HubOptions
        {
            DataDirectory = _directory,
            DatabaseKey = "test-database-key-32-characters-long",
            CloudApiBaseUrl = "https://cloud.example",
            CloudSyncKey = "cloud-sync-secret",
        });
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var edgeCommand = ValidCommand();
        await store.AcceptCommandAsync(edgeCommand);
        var cloudCommandId = Guid.NewGuid().ToString();
        var handler = new SyncHandler(store, edgeCommand.Id, cloudCommandId);
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            options,
            NullLogger<CloudSyncWorker>.Instance);

        await worker.SyncOnceAsync();

        Assert.Equal("idle", worker.Status);
        Assert.Equal(2, handler.CallCount);
        Assert.Empty(await store.GetPendingAsync(10));
        Assert.True(await store.HasCloudCommandAsync(cloudCommandId));
        Assert.Empty(await store.GetPendingCloudAcknowledgementsAsync(10));
        Assert.NotNull(await store.GetOperationalSnapshotAsync(edgeCommand.OrganizationId, edgeCommand.UnitId));
    }

    [Fact]
    public void MapsEveryPilotJournalCommandToTheCanonicalV2Envelope()
    {
        var commandTypes = new[]
        {
            "pos.tab.open_requested",
            "pos.order.create_requested",
            "pos.order.send_requested",
            "pos.tab.transfer_requested",
            "pos.tabs.merge_requested",
            "pos.tab.split_requested",
            "pos.tab.service_charge_requested",
            "pos.tab.tip_requested",
            "pos.item.discount_requested",
            "pos.item.cancel_requested",
            "pos.kds.transition_requested",
        };
        var primary = new ResourcePrecondition(
            "tab",
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            7);
        var secondary = new ResourcePrecondition(
            "table",
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            3);
        var lexicallyEarlierTab = new ResourcePrecondition(
            "tab",
            "00000000-0000-4000-8000-000000000001",
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            2);

        foreach (var type in commandTypes)
        {
            var pending = new PendingEvent(
                Guid.NewGuid().ToString(),
                ValidOrganizationId,
                ValidUnitId,
                Guid.NewGuid().ToString(),
                Guid.NewGuid().ToString(),
                $"idem-{Guid.NewGuid():N}",
                type,
                "{}",
                1,
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow,
                2,
                [lexicallyEarlierTab, primary, secondary],
                9,
                [],
                primary.Id);

            var outbound = CloudSyncWorker.CreateOutboundEvent(pending);
            var json = JsonSerializer.SerializeToElement(
                outbound,
                new JsonSerializerOptions(JsonSerializerDefaults.Web));

            Assert.Equal(pending.Id, json.GetProperty("commandId").GetString());
            Assert.False(json.TryGetProperty("id", out _));
            Assert.Equal(type, json.GetProperty("type").GetString());
            Assert.Equal("tab", json.GetProperty("aggregate").GetProperty("type").GetString());
            Assert.Equal(primary.Id, json.GetProperty("aggregate").GetProperty("id").GetString());
            Assert.Equal(primary.OccupancyEpoch, json.GetProperty("occupancyEpoch").GetString());
            Assert.Equal(7, json.GetProperty("resourceVersion").GetInt32());
            Assert.Equal(9, json.GetProperty("aggregateSequence").GetInt32());
            Assert.Equal(3, json.GetProperty("resourcePreconditions").GetArrayLength());
        }
    }

    [Fact]
    public void SupportsMaximumMergeVectorAndDeduplicatesRepeatedPriceReferences()
    {
        var primaryId = Guid.NewGuid().ToString();
        var resources = Enumerable.Range(0, 51)
            .SelectMany(index => new[]
            {
                new ResourcePrecondition("tab", index == 0 ? primaryId : Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 1),
                new ResourcePrecondition("table", Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 1),
            })
            .ToArray();
        var reference = new PriceReference(
            "product",
            Guid.NewGuid().ToString(),
            "2026-08-10T12:00:00.000Z",
            new string('t', 64));
        var pending = OrderedPending(resources, primaryId, [reference, reference]);

        var outbound = CloudSyncWorker.CreateOutboundEvent(pending);
        var json = JsonSerializer.SerializeToElement(outbound, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal(102, json.GetProperty("resourcePreconditions").GetArrayLength());
        Assert.Single(json.GetProperty("priceReferences").EnumerateArray());
        Assert.Throws<LocalEnvelopeException>(() => CloudSyncWorker.CreateOutboundEvent(
            OrderedPending(
                resources.Concat(Enumerable.Range(0, 27).Select(_ =>
                    new ResourcePrecondition("table", Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 1))).ToArray(),
                primaryId,
                [])));
    }

    [Fact]
    public async Task QuarantinesOversizedV2EventWithoutPoisoningValidSibling()
    {
        var options = Options.Create(new HubOptions
        {
            DataDirectory = _directory,
            DatabaseKey = "test-database-key-32-characters-long",
            CloudApiBaseUrl = "https://cloud.example",
            CloudSyncKey = "cloud-sync-secret",
        });
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var oversized = ValidCommand();
        var sibling = ValidCommand();
        await store.AcceptCommandAsync(oversized);
        await store.AcceptCommandAsync(sibling);
        var primaryId = Guid.NewGuid().ToString();
        var resources = JsonSerializer.Serialize(new[]
        {
            new ResourcePrecondition("tab", primaryId, Guid.NewGuid().ToString(), 1),
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await using (var connection = OpenConnection(options.Value))
        {
            await connection.OpenAsync();
            var update = connection.CreateCommand();
            update.CommandText = """
                UPDATE operational_events SET protocol_version = 2,
                  resource_preconditions = $resources, aggregate_sequence = 1,
                  primary_resource_id = $primary,
                  payload = CASE WHEN id = $oversized THEN $oversizedPayload ELSE payload END
                WHERE id IN ($oversized, $sibling);
                """;
            update.Parameters.AddWithValue("$resources", resources);
            update.Parameters.AddWithValue("$primary", primaryId);
            update.Parameters.AddWithValue("$oversized", oversized.Id);
            update.Parameters.AddWithValue("$sibling", sibling.Id);
            update.Parameters.AddWithValue("$oversizedPayload", JsonSerializer.Serialize(new { pad = new string('x', SyncEnvelopeLimits.MaximumPayloadBytes) }));
            await update.ExecuteNonQueryAsync();
        }
        var handler = new SingleAcceptedEventHandler(sibling.Id);
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            options,
            NullLogger<CloudSyncWorker>.Instance);

        await worker.SyncOnceAsync();

        Assert.Equal(sibling.Id, handler.UploadedEventId);
        Assert.Equal("reconciling", worker.Status);
        var reconciliation = await store.GetReconciliationAsync(10);
        Assert.Contains(reconciliation, item =>
            item.Id == oversized.Id && item.Reason == "LOCAL_ENVELOPE_LIMIT_EXCEEDED");
        Assert.Empty(await store.GetPendingAsync(10));
    }

    [Fact]
    public async Task ASecondAckOnlyResponseCannotOverwriteAReconciliationSnapshot()
    {
        var options = Options.Create(new HubOptions
        {
            DataDirectory = _directory,
            DatabaseKey = "test-database-key-32-characters-long",
            CloudApiBaseUrl = "https://cloud.example",
            CloudSyncKey = "cloud-sync-secret",
        });
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var edgeCommand = ValidCommand();
        await store.AcceptCommandAsync(edgeCommand);
        var cloudCommandId = Guid.NewGuid().ToString();
        var handler = new ReconciliationThenAckHandler(edgeCommand.Id, cloudCommandId);
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            options,
            NullLogger<CloudSyncWorker>.Instance);

        await worker.SyncOnceAsync();

        Assert.Equal("reconciling", worker.Status);
        Assert.Single(worker.AuthoritativeOutcomes);
        Assert.Null(await store.GetOperationalSnapshotAsync(ValidOrganizationId, ValidUnitId));
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    private static OperationalCommand ValidCommand() => new(
        Guid.NewGuid().ToString(),
        ValidOrganizationId,
        ValidUnitId,
        Guid.NewGuid().ToString(),
        Guid.NewGuid().ToString(),
        "order.created",
        JsonDocument.Parse("{\"orderId\":\"order-1\"}").RootElement.Clone(),
        1,
        DateTimeOffset.UtcNow,
        $"edge-{Guid.NewGuid():N}");

    private static PendingEvent OrderedPending(
        IReadOnlyList<ResourcePrecondition> resources,
        string primaryId,
        IReadOnlyList<PriceReference> references) => new(
            Guid.NewGuid().ToString(),
            ValidOrganizationId,
            ValidUnitId,
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            $"idem-{Guid.NewGuid():N}",
            "pos.tabs.merge_requested",
            "{}",
            1,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow,
            2,
            resources,
            1,
            references,
            primaryId);

    private static SqliteConnection OpenConnection(HubOptions options)
    {
        var path = Path.Combine(Path.GetFullPath(options.DataDirectory), "giromesa-edge.db").Replace('\\', '/');
        return new(new SqliteConnectionStringBuilder
        {
            DataSource = $"file:{path}?cipher=sqlcipher&legacy=4",
            Mode = SqliteOpenMode.ReadWrite,
            Password = options.DatabaseKey,
            Pooling = false,
        }.ToString());
    }

    private sealed class SyncHandler(HubStore store, string eventId, string cloudCommandId)
        : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount += 1;
            Assert.Equal("GiroMesaHub", request.Headers.Authorization?.Scheme);
            Assert.Equal("cloud-sync-secret", request.Headers.Authorization?.Parameter);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            Assert.False(body.RootElement.TryGetProperty("organizationId", out _));
            Assert.False(body.RootElement.TryGetProperty("unitId", out _));

            object response;
            if (CallCount == 1)
            {
                Assert.Single(body.RootElement.GetProperty("events").EnumerateArray());
                response = new
                {
                    acceptedEventIds = new[] { eventId },
                    rejectedEvents = Array.Empty<object>(),
                    commands = new[]
                    {
                        new
                        {
                            id = cloudCommandId,
                            type = "place_order",
                            payload = new { orderId = "cloud-order-1" },
                            createdAt = DateTimeOffset.UtcNow,
                            expiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
                        },
                    },
                    serverTime = DateTimeOffset.UtcNow,
                    snapshot = new
                    {
                        organizationId = ValidOrganizationId,
                        unitId = ValidUnitId,
                        capturedAt = DateTimeOffset.UtcNow,
                        catalog = new { products = Array.Empty<object>() },
                        floor = new { rooms = Array.Empty<object>(), tables = Array.Empty<object>(), openTabs = Array.Empty<object>() },
                        tabs = Array.Empty<object>(),
                        tabDetails = new { },
                        kds = new { tickets = Array.Empty<object>(), items = Array.Empty<object>() },
                    },
                };
            }
            else
            {
                Assert.True(await store.HasCloudCommandAsync(cloudCommandId));
                Assert.Contains(
                    cloudCommandId,
                    body.RootElement.GetProperty("acknowledgedCommandIds")
                        .EnumerateArray()
                        .Select(value => value.GetString()));
                response = new
                {
                    acceptedEventIds = Array.Empty<string>(),
                    rejectedEvents = Array.Empty<object>(),
                    commands = Array.Empty<object>(),
                    serverTime = DateTimeOffset.UtcNow,
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                    Encoding.UTF8,
                    "application/json"),
            };
        }
    }

    private sealed class ReconciliationThenAckHandler(string eventId, string cloudCommandId)
        : HttpMessageHandler
    {
        private int _calls;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            _calls += 1;
            _ = await request.Content!.ReadAsStringAsync(cancellationToken);
            object result = _calls == 1
                ? new
                {
                    acceptedEventIds = Array.Empty<string>(),
                    rejectedEvents = Array.Empty<object>(),
                    eventResults = new[]
                    {
                        new
                        {
                            id = eventId,
                            replayed = false,
                            result = new { status = "reconcile", code = "OCCUPANCY_EPOCH_MISMATCH" },
                        },
                    },
                    commands = new[]
                    {
                        new
                        {
                            id = cloudCommandId,
                            type = "refresh",
                            payload = new { },
                            createdAt = DateTimeOffset.UtcNow,
                            expiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
                        },
                    },
                    serverTime = DateTimeOffset.UtcNow,
                    snapshot = SnapshotPayload(),
                }
                : new
                {
                    acceptedEventIds = Array.Empty<string>(),
                    rejectedEvents = Array.Empty<object>(),
                    eventResults = Array.Empty<object>(),
                    commands = Array.Empty<object>(),
                    serverTime = DateTimeOffset.UtcNow,
                    snapshot = SnapshotPayload(),
                };
            var content = new StringContent(
                JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                Encoding.UTF8);
            content.Headers.ContentType = new("application/json");
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        }

        private static object SnapshotPayload() => new
        {
            organizationId = ValidOrganizationId,
            unitId = ValidUnitId,
            capturedAt = DateTimeOffset.UtcNow,
            catalog = new { products = Array.Empty<object>() },
            floor = new { rooms = Array.Empty<object>(), tables = Array.Empty<object>(), openTabs = Array.Empty<object>() },
            tabs = Array.Empty<object>(),
            tabDetails = new { },
            kds = new { tickets = Array.Empty<object>(), items = Array.Empty<object>() },
        };
    }

    private sealed class SingleAcceptedEventHandler(string acceptedId) : HttpMessageHandler
    {
        public string? UploadedEventId { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            var events = body.RootElement.GetProperty("events").EnumerateArray().ToArray();
            Assert.Single(events);
            UploadedEventId = events[0].GetProperty("commandId").GetString();
            var result = new
            {
                acceptedEventIds = new[] { acceptedId },
                rejectedEvents = Array.Empty<object>(),
                eventResults = Array.Empty<object>(),
                commands = Array.Empty<object>(),
                serverTime = DateTimeOffset.UtcNow,
            };
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                    Encoding.UTF8,
                    "application/json"),
            };
        }
    }
}
