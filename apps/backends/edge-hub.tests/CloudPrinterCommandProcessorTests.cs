using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;
using GiroMesa.EdgeHub.Sync;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class CloudPrinterCommandProcessorTests : IAsyncLifetime
{
    private const string TestKey = "test-database-key-32-characters-long";
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(),
        "giromesa-edgehub-cloud-printer-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task AppliesAndArchivesOnlyMonotonicCloudConfigurationRevisions()
    {
        var options = CreateOptions(withStaticPrinter: false);
        var (store, registry, processor) = await CreateProcessorAsync(options, new DisabledPrinterGateway());
        var upsertId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([Command(
            upsertId,
            "printer.configuration.upsert",
            new
            {
                printerId = "kitchen",
                revision = 7,
                configuration = new
                {
                    host = "192.168.1.25",
                    port = 9100,
                    paperWidthMm = 80,
                    charactersPerLine = 48,
                    codeTable = 16,
                    cut = true,
                    supportsRasterGraphics = false,
                    isDefault = true,
                    stationIds = new[] { "33333333-3333-4333-8333-333333333333" },
                    documentTypes = new[] { "kds_ticket" },
                    fallbackPrinterId = (string?)null,
                    timeoutSeconds = 5,
                },
            })]);

        Assert.Equal(1, await processor.ProcessPendingAsync());
        var applied = Assert.Single(await registry.ListAsync());
        Assert.Equal(7, applied.Revision);
        Assert.Equal("applied", (await store.GetCloudCommandStateAsync(upsertId))?
            .Result?.GetProperty("status").GetString());

        var staleId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([Command(
            staleId,
            "printer.configuration.archive",
            new { printerId = "kitchen", revision = 6 })]);
        Assert.Equal(1, await processor.ProcessPendingAsync());
        var stale = Assert.IsType<CloudCommandState>(await store.GetCloudCommandStateAsync(staleId));
        Assert.Equal("failed", stale.Result?.GetProperty("status").GetString());
        Assert.Equal("PRINTER_CONFIGURATION_STALE", stale.Result?.GetProperty("errorCode").GetString());
        Assert.Equal(7, Assert.Single(await registry.ListAsync()).Revision);

        var archiveId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([Command(
            archiveId,
            "printer.configuration.archive",
            new { printerId = "kitchen", revision = 8 })]);
        Assert.Equal(1, await processor.ProcessPendingAsync());
        Assert.Empty(await registry.ListAsync());
        Assert.Equal(8, Assert.Single(await registry.ListAsync(includeArchived: true)).Revision);
        Assert.Equal("applied", (await store.GetCloudCommandStateAsync(archiveId))?
            .Result?.GetProperty("status").GetString());
    }

    [Fact]
    public async Task PrinterTestUsesTheDurablePrintJobAndDoesNotRepeatAStableKey()
    {
        var options = CreateOptions(withStaticPrinter: true);
        var gateway = new RecordingPrinterGateway();
        var (store, _, processor) = await CreateProcessorAsync(options, gateway);
        var stableKey = "cloud-printer-test-stable-0001";
        var firstId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([Command(
            firstId,
            "printer.test",
            new { printerId = "kitchen", idempotencyKey = stableKey })]);
        Assert.Equal(1, await processor.ProcessPendingAsync());

        var replayId = Guid.NewGuid().ToString();
        await store.SaveCloudCommandsAsync([Command(
            replayId,
            "printer.test",
            new { printerId = "kitchen", idempotencyKey = stableKey })]);
        Assert.Equal(1, await processor.ProcessPendingAsync());

        Assert.Equal(1, gateway.CallCount);
        var first = Assert.IsType<CloudCommandState>(await store.GetCloudCommandStateAsync(firstId));
        var replay = Assert.IsType<CloudCommandState>(await store.GetCloudCommandStateAsync(replayId));
        Assert.Equal("printed", first.Result?.GetProperty("status").GetString());
        Assert.Equal(1, first.Result?.GetProperty("revision").GetInt32());
        Assert.Equal("printed", replay.Result?.GetProperty("status").GetString());
        Assert.True(replay.Result!.Value.GetProperty("duplicate").GetBoolean());
    }

    [Fact]
    public async Task ProbesAndReportsAReachableNetworkPrinter()
    {
        var options = CreateOptions(withStaticPrinter: false);
        var (store, _, processor) = await CreateProcessorAsync(options, new DisabledPrinterGateway());
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var commandId = Guid.NewGuid().ToString();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            await store.SaveCloudCommandsAsync([Command(
                commandId,
                "printer.connection.probe",
                new { host = "127.0.0.1", port })]);

            Assert.Equal(1, await processor.ProcessPendingAsync());
            var result = Assert.Single(await store.GetPendingCloudCommandResultsAsync(10));
            Assert.Equal(commandId, result.GetProperty("commandId").GetString());
            Assert.Equal("reachable", result.GetProperty("status").GetString());
        }
        finally
        {
            listener.Stop();
        }
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    private IOptions<HubOptions> CreateOptions(bool withStaticPrinter) => Options.Create(new HubOptions
    {
        DataDirectory = _directory,
        DatabaseKey = TestKey,
        Printers = withStaticPrinter
            ?
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
                    DocumentTypes = ["partial_statement", "kds_ticket"],
                },
            ]
            : [],
    });

    private static async Task<(HubStore Store, PrinterConfigurationRegistry Registry, CloudPrinterCommandProcessor Processor)>
        CreateProcessorAsync(IOptions<HubOptions> options, IPrinterGateway gateway)
    {
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var registry = new PrinterConfigurationRegistry(
            store,
            options,
            NullLogger<PrinterConfigurationRegistry>.Instance);
        await registry.InitializeAsync();
        var printJobs = new PrintJobExecutor(
            store,
            gateway,
            NullLogger<PrintJobExecutor>.Instance);
        var processor = new CloudPrinterCommandProcessor(
            store,
            registry,
            printJobs,
            NullLogger<CloudPrinterCommandProcessor>.Instance);
        return (store, registry, processor);
    }

    private static CloudCommand Command(string id, string type, object payload) => new(
        id,
        type,
        JsonSerializer.SerializeToElement(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
        DateTimeOffset.UtcNow,
        DateTimeOffset.UtcNow.AddMinutes(5));

    private sealed class RecordingPrinterGateway : IPrinterGateway
    {
        public int CallCount { get; private set; }
        public CapabilityState Capability => new(true, "test", "test");

        public Task<PrintResult> PrintAsync(
            PrintRequest request,
            CancellationToken cancellationToken = default)
        {
            CallCount += 1;
            return Task.FromResult(new PrintResult(true, "accepted", null, 100, request.PrinterId));
        }

        public Task<IReadOnlyList<PrinterStatus>> GetStatusesAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PrinterStatus>>([]);
    }
}
