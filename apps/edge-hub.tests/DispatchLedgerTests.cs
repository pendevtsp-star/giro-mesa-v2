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
        Assert.True(await store.AcknowledgeDispatchAsync(effect.Id, "ack-1"));
        Assert.Empty(await store.GetPendingDispatchAsync(10));
        Assert.Single(
            await store.GetPendingDispatchOutcomesAsync(10),
            outcome => outcome.EffectId == effect.Id && outcome.State == "acked");
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

    [Fact]
    public async Task RecoversInterruptedClaimToDlqWithoutRepeatingTheGatewaySideEffect()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var organizationId = Guid.NewGuid().ToString();
        var unitId = Guid.NewGuid().ToString();
        var effectId = Guid.NewGuid().ToString();
        var commandId = Guid.NewGuid().ToString();
        var deliveryKey = "dispatch-crash-claim-1";
        var now = DateTimeOffset.UtcNow.AddMinutes(-5);
        var command = DispatchCommand(
            commandId,
            effectId,
            organizationId,
            unitId,
            "printer",
            "printer:cozinha",
            deliveryKey,
            now);
        await store.SaveCloudCommandsAsync([command]);
        await store.ScheduleDispatchAsync(new LocalDispatchEffect(
            effectId,
            organizationId,
            unitId,
            $"effect:{effectId}",
            "printer",
            "printer:cozinha",
            "dispatch",
            command.Payload.GetProperty("payload").GetRawText(),
            now));
        Assert.Equal("claimed", await store.ClaimDispatchAttemptAsync(effectId, deliveryKey, commandId));
        await store.MarkCloudCommandFailedAsync(commandId, "DISPATCH_COMMAND_PROCESSING_FAILED");

        Assert.Equal(1, await store.RecoverInterruptedDispatchesAsync(TimeSpan.Zero));
        Assert.Equal(0, await store.RecoverInterruptedDispatchesAsync(TimeSpan.Zero));
        Assert.Single(await store.GetPendingCloudAcknowledgementsAsync(10));
        Assert.Single(await store.GetDeadLettersAsync(10));
        var outcomes = await store.GetPendingDispatchOutcomesAsync(10);
        Assert.Single(outcomes, outcome =>
            outcome.EffectId == effectId &&
            outcome.DeliveryKey == deliveryKey &&
            outcome.State == "dlq" &&
            outcome.Error == "DISPATCH_OUTCOME_UNCERTAIN");

        var printer = new RecordingPrinterGateway();
        var processor = new DispatchProcessor(
            store,
            printer,
            new LocalKitchenDispatchGateway(store),
            NullLogger<DispatchProcessor>.Instance);
        await processor.ProcessPendingCommandsAsync();
        Assert.Empty(printer.Requests);
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

    [Fact]
    public async Task RawPrinterGatewayFailsClosedOutsideWindows()
    {
        if (OperatingSystem.IsWindows()) return;
        var printer = new WindowsSpoolPrinterGateway();
        Assert.False(printer.Capability.Configured);
        var result = await printer.PrintAsync(new PrintRequest("delivery-1", "printer-1", "kitchen", "Order"));
        Assert.False(result.Success);
        Assert.Equal("PRINTER_PLATFORM_UNAVAILABLE", result.ErrorCode);
    }

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
