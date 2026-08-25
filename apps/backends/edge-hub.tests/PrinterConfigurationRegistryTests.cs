using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class PrinterConfigurationRegistryTests : IAsyncLifetime
{
    private const string TestKey = "test-database-key-32-characters-long";
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(),
        "giromesa-edgehub-printer-config-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task BootstrapsStaticConfigurationOnceAndThenUsesEncryptedPersistence()
    {
        var stationId = Guid.NewGuid().ToString();
        var options = Options.Create(new HubOptions
        {
            DataDirectory = _directory,
            DatabaseKey = TestKey,
            Printers =
            [
                new PrinterOptions
                {
                    Enabled = true,
                    Id = "Kitchen",
                    Host = "192.168.10.20",
                    Port = 9100,
                    PaperWidthMm = 80,
                    CharactersPerLine = 48,
                    Default = true,
                    StationIds = [stationId],
                    Stations = ["cozinha-legada"],
                    DocumentTypes = ["kds_ticket"],
                },
            ],
        });
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var registry = new PrinterConfigurationRegistry(
            store,
            options,
            NullLogger<PrinterConfigurationRegistry>.Instance);

        await registry.InitializeAsync();
        var bootstrapped = Assert.Single(await registry.ListAsync());
        Assert.Equal("kitchen", bootstrapped.Id);
        Assert.Equal([stationId], bootstrapped.StationIds);
        Assert.Equal(["cozinha-legada"], bootstrapped.LegacyStationNames);
        Assert.Equal("static-bootstrap", bootstrapped.Source);

        SqliteConnection.ClearAllPools();
        var emptyOptions = Options.Create(new HubOptions
        {
            DataDirectory = _directory,
            DatabaseKey = TestKey,
        });
        var restartedStore = new HubStore(emptyOptions, NullLogger<HubStore>.Instance);
        await restartedStore.InitializeAsync();
        var restarted = new PrinterConfigurationRegistry(
            restartedStore,
            emptyOptions,
            NullLogger<PrinterConfigurationRegistry>.Instance);
        await restarted.InitializeAsync();

        Assert.Equal("192.168.10.20", Assert.Single(await restarted.ListAsync()).Host);
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("printer.example.com")]
    [InlineData("203.0.113.10")]
    public async Task RejectsPublicAddressesAndDnsNames(string unsafeHost)
    {
        var (registry, _) = await CreateRegistryAsync();
        var exception = await Assert.ThrowsAsync<PrinterConfigurationException>(() =>
            registry.ApplyCloudUpsertAsync(
                "kitchen",
                1,
                Mutation(unsafeHost, isDefault: true),
                Guid.NewGuid().ToString()));

        Assert.Equal("PRINTER_HOST_INVALID", exception.Code);
    }

    [Fact]
    public async Task AppliesOnlyIncreasingCloudRevisionsAndRejectsFallbackCycles()
    {
        var (registry, _) = await CreateRegistryAsync();
        var first = await registry.ApplyCloudUpsertAsync(
            "kitchen",
            1,
            Mutation("10.0.0.20", isDefault: true),
            Guid.NewGuid().ToString());
        var replay = await registry.ApplyCloudUpsertAsync(
            "kitchen",
            1,
            Mutation("10.0.0.20", isDefault: true),
            Guid.NewGuid().ToString());

        Assert.False(first.Duplicate);
        Assert.True(replay.Duplicate);
        var stale = await Assert.ThrowsAsync<PrinterConfigurationException>(() =>
            registry.ApplyCloudUpsertAsync(
                "kitchen",
                1,
                Mutation("10.0.0.21", isDefault: true),
                Guid.NewGuid().ToString()));
        Assert.Equal("PRINTER_CONFIGURATION_STALE", stale.Code);

        await registry.ApplyCloudUpsertAsync(
            "bar",
            1,
            Mutation("192.168.1.30", isDefault: true),
            Guid.NewGuid().ToString());
        await registry.ApplyCloudUpsertAsync(
            "kitchen",
            2,
            Mutation("10.0.0.20", isDefault: false, fallback: "bar"),
            Guid.NewGuid().ToString());
        var cycle = await Assert.ThrowsAsync<PrinterConfigurationException>(() =>
            registry.ApplyCloudUpsertAsync(
                "bar",
                2,
                Mutation("192.168.1.30", isDefault: true, fallback: "kitchen"),
                Guid.NewGuid().ToString()));
        Assert.Equal("PRINTER_FALLBACK_CYCLE", cycle.Code);
    }

    [Fact]
    public async Task PersistsDefaultPrinterReplacementAtomicallyAcrossRestart()
    {
        var (registry, _) = await CreateRegistryAsync();
        await registry.ApplyCloudUpsertAsync(
            "kitchen",
            1,
            Mutation("10.0.0.20", isDefault: true),
            Guid.NewGuid().ToString());
        await registry.ApplyCloudUpsertAsync(
            "bar",
            1,
            Mutation("192.168.1.30", isDefault: true),
            Guid.NewGuid().ToString());

        var live = await registry.ListAsync();
        Assert.Equal("bar", Assert.Single(live.Where(item => item.IsDefault)).Id);
        Assert.False(Assert.Single(live.Where(item => item.Id == "kitchen")).IsDefault);

        SqliteConnection.ClearAllPools();
        var restartedOptions = Options.Create(new HubOptions
        {
            DataDirectory = _directory,
            DatabaseKey = TestKey,
        });
        var restartedStore = new HubStore(restartedOptions, NullLogger<HubStore>.Instance);
        await restartedStore.InitializeAsync();
        var restarted = new PrinterConfigurationRegistry(
            restartedStore,
            restartedOptions,
            NullLogger<PrinterConfigurationRegistry>.Instance);
        await restarted.InitializeAsync();

        var persisted = await restarted.ListAsync();
        Assert.Equal("bar", Assert.Single(persisted.Where(item => item.IsDefault)).Id);
        Assert.False(Assert.Single(persisted.Where(item => item.Id == "kitchen")).IsDefault);
        Assert.Empty(restarted.Diagnose().Issues);
    }

    [Fact]
    public void RejectsDuplicateIdsBeforeBootstrapPersistence()
    {
        var now = DateTimeOffset.UtcNow;
        var first = Stored("kitchen", now);
        var duplicate = Stored("KITCHEN", now) with { IsDefault = false };

        var issues = PrinterConfigurationRegistry.ValidateCollection([first, duplicate]);

        Assert.Contains("PRINTER_CONFIGURATION_ID_DUPLICATE", issues);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    private async Task<(PrinterConfigurationRegistry Registry, HubStore Store)> CreateRegistryAsync()
    {
        var options = Options.Create(new HubOptions
        {
            DataDirectory = _directory,
            DatabaseKey = TestKey,
        });
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var registry = new PrinterConfigurationRegistry(
            store,
            options,
            NullLogger<PrinterConfigurationRegistry>.Instance);
        await registry.InitializeAsync();
        return (registry, store);
    }

    private static PrinterConfigurationMutation Mutation(
        string host,
        bool isDefault,
        string? fallback = null) => new(
            host,
            9100,
            80,
            48,
            16,
            true,
            false,
            isDefault,
            ["33333333-3333-4333-8333-333333333333"],
            ["kds_ticket"],
            fallback);

    private static StoredPrinterConfiguration Stored(string id, DateTimeOffset now) => new(
        id,
        "127.0.0.1",
        9100,
        80,
        48,
        16,
        true,
        false,
        true,
        [],
        ["kds_ticket"],
        [],
        null,
        5,
        1,
        now,
        now,
        null,
        "test",
        "test");
}
