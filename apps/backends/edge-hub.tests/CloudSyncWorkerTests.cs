using System.Net;
using System.Text;
using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
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
    public async Task AcknowledgesPublicOrderOnlyAfterSnapshotContainsLocalKdsTicket()
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
        var fiscalCredentials = new FocusCredentialStore();
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            fiscalCredentials,
            options,
            NullLogger<CloudSyncWorker>.Instance);

        await worker.SyncOnceAsync();

        Assert.Equal("idle", worker.Status);
        Assert.Equal(2, handler.CallCount);
        Assert.Empty(await store.GetPendingAsync(10));
        Assert.True(await store.HasCloudCommandAsync(cloudCommandId));
        Assert.Empty(await store.GetPendingCloudAcknowledgementsAsync(10));
        Assert.NotNull(await store.GetOperationalSnapshotAsync(edgeCommand.OrganizationId, edgeCommand.UnitId));
        var cloudState = Assert.IsType<CloudCommandState>(
            await store.GetCloudCommandStateAsync(cloudCommandId));
        Assert.NotNull(cloudState.ProcessedAt);
        Assert.NotNull(cloudState.CloudAcknowledgedAt);
        Assert.True(cloudState.Result.HasValue);
        Assert.Equal("projected", cloudState.Result.Value.GetProperty("state").GetString());
        Assert.Equal("focus-company-token", fiscalCredentials.Current?.Token);
    }

    [Fact]
    public async Task UnsupportedPublicCommandIsRecordedAndNeverAcknowledged()
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
        var cloudCommandId = Guid.NewGuid().ToString();
        var handler = new UnsupportedCommandHandler(cloudCommandId);
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            new FocusCredentialStore(),
            options,
            NullLogger<CloudSyncWorker>.Instance);

        await worker.SyncOnceAsync();

        Assert.Equal(1, handler.CallCount);
        Assert.Empty(await store.GetPendingCloudAcknowledgementsAsync(10));
        var cloudState = await store.GetCloudCommandStateAsync(cloudCommandId);
        Assert.Null(cloudState?.ProcessedAt);
        Assert.Null(cloudState?.CloudAcknowledgedAt);
        Assert.Equal("CLOUD_COMMAND_UNSUPPORTED", cloudState?.Error);
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
        "edge-command-0001");

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
                    fiscalConfiguration = new
                    {
                        provider = "focus",
                        enabled = true,
                        environment = "homologation",
                        token = "focus-company-token",
                    },
                    snapshot = new
                    {
                        organizationId = ValidOrganizationId,
                        unitId = ValidUnitId,
                        capturedAt = DateTimeOffset.UtcNow,
                        catalog = new { products = Array.Empty<object>() },
                        floor = new { rooms = Array.Empty<object>(), tables = Array.Empty<object>(), openTabs = Array.Empty<object>() },
                        tabs = Array.Empty<object>(),
                        tabDetails = new { },
                        kds = new
                        {
                            tickets = new[]
                            {
                                new
                                {
                                    id = "cloud-ticket-1",
                                    orderId = "cloud-order-1",
                                    stationId = "33333333-3333-4333-8333-333333333333",
                                    status = "pending",
                                },
                            },
                            items = Array.Empty<object>(),
                        },
                    },
                };
            }
            else
            {
                Assert.True(await store.HasCloudCommandAsync(cloudCommandId));
                Assert.NotNull((await store.GetCloudCommandStateAsync(cloudCommandId))?.ProcessedAt);
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
                    fiscalConfiguration = new
                    {
                        provider = "focus",
                        enabled = true,
                        environment = "homologation",
                        token = "focus-company-token",
                    },
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

    private sealed class UnsupportedCommandHandler(string cloudCommandId) : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount += 1;
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            Assert.Empty(body.RootElement.GetProperty("acknowledgedCommandIds").EnumerateArray());
            var response = new
            {
                acceptedEventIds = Array.Empty<string>(),
                rejectedEvents = Array.Empty<object>(),
                commands = new[]
                {
                    new
                    {
                        id = cloudCommandId,
                        type = "call_waiter",
                        payload = new { tableId = "33333333-3333-4333-8333-333333333333" },
                        createdAt = DateTimeOffset.UtcNow,
                        expiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
                    },
                },
                serverTime = DateTimeOffset.UtcNow,
            };
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                    Encoding.UTF8,
                    "application/json"),
            };
        }
    }
}
