using System.Text.Json;
using GiroMesa.EdgeHub.Security;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class HubStoreTests : IAsyncLifetime
{
    private readonly string _testRoot = Path.Combine(Path.GetTempPath(), "giromesa-edgehub-tests");
    private readonly string _directory;

    public HubStoreTests()
    {
        _directory = Path.Combine(_testRoot, Guid.NewGuid().ToString("N"));
    }

    [Fact]
    public async Task PersistsCommandsBeforeAcknowledgingAndDeduplicates()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var command = ValidCommand();

        var first = await store.AcceptCommandAsync(command);
        var duplicate = await store.AcceptCommandAsync(command);
        var pending = await store.GetPendingAsync(10);

        Assert.True(first.Inserted);
        Assert.False(duplicate.Inserted);
        Assert.Single(pending);
        Assert.Equal(command.Id, pending[0].Id);
        Assert.True(await store.AcknowledgeAsync(command.Id));
        Assert.Empty(await store.GetPendingAsync(10));
    }

    [Fact]
    public async Task StoresOnlyHashedPairingTokenAndAuthorizesIt()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var authenticator = new DeviceAuthenticator(
            Options.Create(new HubOptions { DataDirectory = _directory, DatabaseKey = TestKey, EnrollmentCode = "654321", RequireMutualTls = false }),
            store);

        var pairing = await authenticator.PairAsync(new PairDeviceRequest("terminal-1", "Caixa 01", "654321"));

        Assert.True(pairing.IsSuccess);
        Assert.NotNull(pairing.Token);
        Assert.True(await authenticator.IsAuthorizedAsync(pairing.Token));
        Assert.False(await authenticator.IsAuthorizedAsync("wrong-token"));
    }

    [Fact]
    public async Task EncryptsTheDatabaseAndFailsClosedWithoutAKey()
    {
        var unconfigured = new HubStore(
            Options.Create(new HubOptions { DataDirectory = _directory }),
            NullLogger<HubStore>.Instance);
        await Assert.ThrowsAsync<InvalidOperationException>(() => unconfigured.InitializeAsync());

        var store = CreateStore();
        await store.InitializeAsync();
        await store.AcceptCommandAsync(ValidCommand());
        SqliteConnection.ClearAllPools();
        var bytes = await File.ReadAllBytesAsync(Path.Combine(_directory, "giromesa-edge.db"));
        var raw = System.Text.Encoding.UTF8.GetString(bytes);
        Assert.DoesNotContain("SQLite format 3", raw);
        Assert.DoesNotContain("order.created", raw);
    }

    [Fact]
    public async Task PersistsCloudCommandsBeforeAcknowledgementAcrossReplayAndRestart()
    {
        var command = new CloudCommand(
            Guid.NewGuid().ToString(),
            "place_order",
            JsonDocument.Parse("{\"orderId\":\"order-1\"}").RootElement.Clone(),
            DateTimeOffset.UtcNow,
            DateTimeOffset.UtcNow.AddMinutes(5));
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveCloudCommandsAsync([command]);
        await store.SaveCloudCommandsAsync([command]);
        Assert.Equal([command.Id], await store.GetPendingCloudAcknowledgementsAsync(10));

        SqliteConnection.ClearAllPools();
        var restarted = CreateStore();
        await restarted.InitializeAsync();
        Assert.True(await restarted.HasCloudCommandAsync(command.Id));
        Assert.Equal([command.Id], await restarted.GetPendingCloudAcknowledgementsAsync(10));
        await restarted.MarkCloudAcknowledgementsAsync([command.Id]);
        Assert.Empty(await restarted.GetPendingCloudAcknowledgementsAsync(10));
    }

    [Fact]
    public async Task SurvivesAnEightHourOfflineTurnAndRestart()
    {
        var start = DateTimeOffset.UtcNow.AddHours(-8);
        var commands = Enumerable.Range(0, 97)
            .Select(index => ValidCommand(start.AddMinutes(index * 5)))
            .ToArray();
        var firstProcess = CreateStore();
        await firstProcess.InitializeAsync();
        foreach (var command in commands)
        {
            Assert.True((await firstProcess.AcceptCommandAsync(command)).Inserted);
        }

        SqliteConnection.ClearAllPools();
        var restartedProcess = CreateStore();
        await restartedProcess.InitializeAsync();
        var pending = await restartedProcess.GetPendingAsync(200);

        Assert.Equal(commands.Length, pending.Count);
        Assert.Equal(commands[0].Id, pending[0].Id);
        Assert.False((await restartedProcess.AcceptCommandAsync(commands[0])).Inserted);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        var fullRoot = Path.GetFullPath(_testRoot) + Path.DirectorySeparatorChar;
        var fullDirectory = Path.GetFullPath(_directory);
        if (fullDirectory.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase) && Directory.Exists(fullDirectory))
        {
            Directory.Delete(fullDirectory, recursive: true);
        }

        return Task.CompletedTask;
    }

    private const string TestKey = "test-database-key-32-characters-long";

    private HubStore CreateStore() => new(
        Options.Create(new HubOptions { DataDirectory = _directory, DatabaseKey = TestKey }),
        NullLogger<HubStore>.Instance);

    private static OperationalCommand ValidCommand(DateTimeOffset? occurredAt = null) => new(
        Guid.NewGuid().ToString(),
        Guid.NewGuid().ToString(),
        Guid.NewGuid().ToString(),
        Guid.NewGuid().ToString(),
        Guid.NewGuid().ToString(),
        "order.created",
        JsonDocument.Parse("{\"orderId\":\"order-1\"}").RootElement.Clone(),
        1,
        occurredAt ?? DateTimeOffset.UtcNow);
}
