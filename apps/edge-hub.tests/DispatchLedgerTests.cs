using GiroMesa.EdgeHub.Storage;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class DispatchLedgerTests : IAsyncLifetime
{
    private readonly string _testRoot = Path.Combine(Path.GetTempPath(), "giromesa-edgehub-dispatch-tests");
    private readonly string _directory;

    public DispatchLedgerTests() => _directory = Path.Combine(_testRoot, Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task PersistsDispatchBeforeDeliveryAndDeduplicatesAttemptsAndAcknowledgements()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var effect = new LocalDispatchEffect(
            Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString(),
            "order:station:kds:dispatch", "kds", "kds:cozinha", "dispatch", "{\"ticket\":\"42\"}",
            DateTimeOffset.UtcNow);

        Assert.True((await store.ScheduleDispatchAsync(effect)).Inserted);
        Assert.False((await store.ScheduleDispatchAsync(effect)).Inserted);
        Assert.Single(await store.GetPendingDispatchAsync(10));
        Assert.True(await store.RecordDispatchAttemptAsync(effect.Id, "delivery-1", true));
        Assert.False(await store.RecordDispatchAttemptAsync(effect.Id, "delivery-1", true));
        Assert.True(await store.AcknowledgeDispatchAsync(effect.Id, "ack-1"));
        Assert.False(await store.AcknowledgeDispatchAsync(effect.Id, "ack-1"));
        Assert.Empty(await store.GetPendingDispatchAsync(10));
    }

    [Fact]
    public async Task KeepsTerminalFailureInDeadLetterAcrossRestart()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var effect = new LocalDispatchEffect(
            Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString(),
            "order:station:printer:dispatch", "printer", "printer:bar", "dispatch", "{}",
            DateTimeOffset.UtcNow);
        await store.ScheduleDispatchAsync(effect);
        await store.MoveDispatchToDeadLetterAsync(effect.Id, "paper jam");

        SqliteConnection.ClearAllPools();
        var restarted = CreateStore();
        await restarted.InitializeAsync();
        Assert.Empty(await restarted.GetPendingDispatchAsync(10));
        var deadLetters = await restarted.GetDeadLettersAsync(10);
        Assert.Single(deadLetters);
        Assert.Equal("paper jam", deadLetters[0].Reason);
        Assert.True(await restarted.RequeueDeadLetterAsync(effect.Id));
        Assert.Single(await restarted.GetPendingDispatchAsync(10));
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        var root = Path.GetFullPath(_testRoot) + Path.DirectorySeparatorChar;
        var directory = Path.GetFullPath(_directory);
        if (directory.StartsWith(root, StringComparison.OrdinalIgnoreCase) && Directory.Exists(directory))
            Directory.Delete(directory, recursive: true);
        return Task.CompletedTask;
    }

    private HubStore CreateStore() => new(
        Options.Create(new HubOptions { DataDirectory = _directory, DatabaseKey = "test-database-key-32-characters-long" }),
        NullLogger<HubStore>.Instance);
}
