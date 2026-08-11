using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;
using GiroMesa.EdgeHub.Sync;
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

    [Fact]
    public async Task ConsumesCloudDispatchExactlyOnceAndOnlyAcknowledgesAfterPrinterAndKdsDelivery()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var organizationId = Guid.NewGuid().ToString();
        var unitId = Guid.NewGuid().ToString();
        var printerEffectId = Guid.NewGuid().ToString();
        var kdsEffectId = Guid.NewGuid().ToString();
        var now = DateTimeOffset.UtcNow;
        await store.SaveCloudCommandsAsync([
            DispatchCommand(
                Guid.NewGuid().ToString(), printerEffectId, organizationId, unitId,
                "printer", "printer:cozinha", "dispatch-printer-1", now),
            DispatchCommand(
                Guid.NewGuid().ToString(), kdsEffectId, organizationId, unitId,
                "kds", "kds:cozinha", "dispatch-kds-1", now),
        ]);
        var printer = new RecordingPrinterGateway();
        var processor = new DispatchProcessor(
            store,
            printer,
            new LocalKitchenDispatchGateway(store),
            NullLogger<DispatchProcessor>.Instance);

        Assert.Empty(await store.GetPendingCloudAcknowledgementsAsync(10));
        await processor.ProcessPendingCommandsAsync();
        await processor.ProcessPendingCommandsAsync();

        Assert.Single(printer.Requests);
        Assert.Equal("dispatch-printer-1", printer.Requests[0].IdempotencyKey);
        var kds = await store.GetPendingKitchenDispatchAsync(10);
        Assert.Single(kds);
        Assert.Equal(kdsEffectId, kds[0].EffectId);
        Assert.Equal(2, (await store.GetPendingCloudAcknowledgementsAsync(10)).Count);
        Assert.True(await store.AcknowledgeDispatchAsync(kdsEffectId, "kds-screen-ack"));
        Assert.Empty(await store.GetPendingKitchenDispatchAsync(10));
        Assert.Contains(
            await store.GetPendingDispatchOutcomesAsync(20),
            outcome => outcome.EffectId == kdsEffectId && outcome.State == "acked");
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

    private static CloudCommand DispatchCommand(
        string commandId,
        string effectId,
        string organizationId,
        string unitId,
        string destination,
        string targetRef,
        string deliveryKey,
        DateTimeOffset now) =>
        new(
            commandId,
            "dispatch.effect.execute",
            JsonSerializer.SerializeToElement(new
            {
                effectId,
                organizationId,
                unitId,
                effectKey = $"effect:{effectId}",
                destination,
                targetRef,
                operation = "dispatch",
                deliveryKey,
                attemptNumber = 1,
                payload = new { orderId = Guid.NewGuid(), stationId = Guid.NewGuid(), content = "Pedido 42" },
            }),
            now,
            now.AddMinutes(5));

    private sealed class RecordingPrinterGateway : IPrinterGateway
    {
        public CapabilityState Capability { get; } = new(true, "test-printer", "ready");
        public List<PrintRequest> Requests { get; } = [];

        public Task<PrintResult> PrintAsync(
            PrintRequest request,
            CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            return Task.FromResult(new PrintResult(true, "accepted", null));
        }
    }
}
