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
        var printerCommands = await CreatePrinterCommandsAsync(store, options);
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            fiscalCredentials,
            printerCommands,
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
        var printerCommands = await CreatePrinterCommandsAsync(store, options);
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            new FocusCredentialStore(),
            printerCommands,
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

    [Fact]
    public async Task SendsDiscriminatedPrintResultInCommandResultsAcknowledgement()
    {
        var options = PrinterOptions();
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var commandId = Guid.NewGuid().ToString();
        var cloudPrintJobId = Guid.NewGuid().ToString();
        var handler = new PrinterCommandHandler(commandId, cloudPrintJobId);
        var gateway = new RecordingPrinterGateway(new(true, "accepted", null, 128, "kitchen"));
        var processor = await CreatePrinterCommandsAsync(store, options, gateway);
        var worker = new CloudSyncWorker(
            new HttpClient(handler),
            store,
            new FocusCredentialStore(),
            processor,
            options,
            NullLogger<CloudSyncWorker>.Instance);

        await worker.SyncOnceAsync();

        Assert.Equal(2, handler.CallCount);
        Assert.Equal(1, gateway.CallCount);
        var state = Assert.IsType<CloudCommandState>(await store.GetCloudCommandStateAsync(commandId));
        Assert.NotNull(state.CloudAcknowledgedAt);
        Assert.Equal("printed", state.Result?.GetProperty("status").GetString());
    }

    [Fact]
    public async Task NeverReprintsAConfirmationRequiredJobForAnotherCloudCommandReplay()
    {
        var options = PrinterOptions();
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var gateway = new RecordingPrinterGateway(new(
            false,
            "confirmation_required",
            "PRINTER_RESULT_UNKNOWN",
            0,
            "kitchen"));
        var processor = await CreatePrinterCommandsAsync(store, options, gateway);
        var payload = JsonSerializer.SerializeToElement(new
        {
            cloudPrintJobId = Guid.NewGuid().ToString(),
            idempotencyKey = "cloud-print-stable-0001",
            stationId = "33333333-3333-4333-8333-333333333333",
            stationName = "Cozinha",
            printerId = "kitchen",
            documentType = "kds_ticket",
            copies = 1,
            payload = new { reference = "101", items = Array.Empty<object>() },
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var firstId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([new(
            firstId,
            "print_job.execute",
            payload,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddMinutes(5))]);
        Assert.Equal(1, await processor.ProcessPendingAsync());

        var replayId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([new(
            replayId,
            "print_job.execute",
            payload,
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddMinutes(5))]);
        Assert.Equal(1, await processor.ProcessPendingAsync());

        Assert.Equal(1, gateway.CallCount);
        var replay = Assert.IsType<CloudCommandState>(await store.GetCloudCommandStateAsync(replayId));
        Assert.Equal("confirmation_required", replay.Result?.GetProperty("status").GetString());
        Assert.True(replay.Result!.Value.GetProperty("duplicate").GetBoolean());
    }

    [Fact]
    public async Task ExecutesAnAlreadyPersistedPrintCommandBeforeAnOfflineSyncAttempt()
    {
        var options = PrinterOptions();
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var commandId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([new(
            commandId,
            "print_job.execute",
            JsonSerializer.SerializeToElement(new
            {
                cloudPrintJobId = Guid.NewGuid().ToString(),
                idempotencyKey = "cloud-print-offline-0001",
                stationId = "33333333-3333-4333-8333-333333333333",
                stationName = "Cozinha",
                printerId = "kitchen",
                documentType = "kds_ticket",
                copies = 1,
                payload = new { reference = "102", items = Array.Empty<object>() },
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddMinutes(5))]);
        var gateway = new RecordingPrinterGateway(new(true, "accepted", null, 90, "kitchen"));
        var processor = await CreatePrinterCommandsAsync(store, options, gateway);
        var worker = new CloudSyncWorker(
            new HttpClient(new OfflineHandler()),
            store,
            new FocusCredentialStore(),
            processor,
            options,
            NullLogger<CloudSyncWorker>.Instance);

        await worker.SyncOnceAsync();

        Assert.Equal(1, gateway.CallCount);
        Assert.Equal("offline", worker.Status);
        var state = Assert.IsType<CloudCommandState>(await store.GetCloudCommandStateAsync(commandId));
        Assert.NotNull(state.ProcessedAt);
        Assert.Null(state.CloudAcknowledgedAt);
        Assert.Equal("printed", state.Result?.GetProperty("status").GetString());
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

    private static async Task<CloudPrinterCommandProcessor> CreatePrinterCommandsAsync(
        HubStore store,
        IOptions<HubOptions> options,
        IPrinterGateway? gateway = null)
    {
        var configurations = new PrinterConfigurationRegistry(
            store,
            options,
            NullLogger<PrinterConfigurationRegistry>.Instance);
        await configurations.InitializeAsync();
        var printJobs = new PrintJobExecutor(
            store,
            gateway ?? new DisabledPrinterGateway(),
            NullLogger<PrintJobExecutor>.Instance);
        return new(
            store,
            configurations,
            printJobs,
            NullLogger<CloudPrinterCommandProcessor>.Instance);
    }

    private IOptions<HubOptions> PrinterOptions() => Options.Create(new HubOptions
    {
        DataDirectory = _directory,
        DatabaseKey = "test-database-key-32-characters-long",
        CloudApiBaseUrl = "https://cloud.example",
        CloudSyncKey = "cloud-sync-secret",
        Printers =
        [
            new PrinterOptions
            {
                Enabled = true,
                Id = "kitchen",
                Host = "127.0.0.1",
                Port = 9100,
                PaperWidthMm = 80,
                CharactersPerLine = 48,
                Default = true,
                StationIds = ["33333333-3333-4333-8333-333333333333"],
                DocumentTypes = ["kds_ticket", "partial_statement"],
            },
        ],
    });

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

    private sealed class PrinterCommandHandler(string commandId, string cloudPrintJobId)
        : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount += 1;
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            object response;
            if (CallCount == 1)
            {
                Assert.Empty(body.RootElement.GetProperty("commandResults").EnumerateArray());
                response = new
                {
                    acceptedEventIds = Array.Empty<string>(),
                    rejectedEvents = Array.Empty<object>(),
                    commands = new[]
                    {
                        new
                        {
                            id = commandId,
                            type = "print_job.execute",
                            payload = new
                            {
                                cloudPrintJobId,
                                idempotencyKey = "cloud-print-ack-0001",
                                stationId = "33333333-3333-4333-8333-333333333333",
                                stationName = "Cozinha",
                                printerId = "kitchen",
                                documentType = "kds_ticket",
                                copies = 1,
                                payload = new { reference = "100", items = Array.Empty<object>() },
                            },
                            createdAt = DateTimeOffset.UtcNow,
                            expiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
                        },
                    },
                    serverTime = DateTimeOffset.UtcNow,
                };
            }
            else
            {
                Assert.Contains(
                    commandId,
                    body.RootElement.GetProperty("acknowledgedCommandIds")
                        .EnumerateArray().Select(value => value.GetString()));
                var result = Assert.Single(body.RootElement.GetProperty("commandResults").EnumerateArray());
                Assert.Equal(commandId, result.GetProperty("commandId").GetString());
                Assert.Equal("print_job.execute", result.GetProperty("type").GetString());
                Assert.Equal(cloudPrintJobId, result.GetProperty("cloudPrintJobId").GetString());
                Assert.Equal("printed", result.GetProperty("status").GetString());
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

    private sealed class RecordingPrinterGateway(PrintResult result) : IPrinterGateway
    {
        public int CallCount { get; private set; }
        public CapabilityState Capability => new(true, "test", "test");

        public Task<PrintResult> PrintAsync(
            PrintRequest request,
            CancellationToken cancellationToken = default)
        {
            CallCount += 1;
            return Task.FromResult(result);
        }

        public Task<IReadOnlyList<PrinterStatus>> GetStatusesAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PrinterStatus>>([]);
    }

    private sealed class OfflineHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            throw new HttpRequestException("offline");
    }
}
