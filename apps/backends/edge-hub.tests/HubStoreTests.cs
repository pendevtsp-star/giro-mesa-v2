using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
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
    public async Task PersistsPrintAttemptsAndRejectsAnIdempotencyConflict()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var payload = JsonDocument.Parse("{\"tab\":{}}").RootElement.Clone();
        var request = new PrintRequest("job-1:1", null, "counter", "partial_statement", payload);

        var first = await store.CreateOrGetPrintJobAsync(request, "hash-a");
        var replay = await store.CreateOrGetPrintJobAsync(request, "hash-a");

        Assert.True(first.Inserted);
        Assert.False(replay.Inserted);
        Assert.Equal("printing", replay.Job.Status);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.CreateOrGetPrintJobAsync(request, "hash-b"));
    }

    [Fact]
    public async Task PersistsAndDeduplicatesAProcessingFiscalResultWithoutProviderPayload()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var snapshot = SnapshotWithKdsOrder("order-1");
        var deviceId = Guid.NewGuid().ToString();
        var request = new FiscalRequest(
            "order-2026-0200",
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            2590,
            "{\"secret_provider_payload\":true}");
        var result = new FiscalResult(false, "processing", "order-2026-0200", "FOCUS_PROCESSING");
        var firstCommand = FiscalEventFactory.FromIssue(
            snapshot, deviceId, request, result, DateTimeOffset.UtcNow)!;
        var replayCommand = FiscalEventFactory.FromIssue(
            snapshot, deviceId, request, result, DateTimeOffset.UtcNow.AddMinutes(1))!;

        var first = await store.AcceptCommandAsync(firstCommand);
        var replay = await store.AcceptCommandAsync(replayCommand);
        var pending = await store.GetPendingAsync(10);

        Assert.Equal(firstCommand.Id, replayCommand.Id);
        Assert.Equal(firstCommand.IdempotencyKey, replayCommand.IdempotencyKey);
        Assert.True(first.Inserted);
        Assert.False(replay.Inserted);
        Assert.Single(pending);
        Assert.Equal("fiscal.document.issue_result", pending[0].Type);
        Assert.Contains("\"kind\":\"fiscal.document.issue_result\"", pending[0].Payload);
        Assert.Contains("\"status\":\"processing\"", pending[0].Payload);
        Assert.Contains("\"totalCents\":2590", pending[0].Payload);
        Assert.DoesNotContain("secret_provider_payload", pending[0].Payload);
        Assert.Null(FiscalEventFactory.FromIssue(
            snapshot,
            deviceId,
            request,
            new FiscalResult(false, "retryable", request.IdempotencyKey, "FOCUS_TIMEOUT"),
            DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task PersistsFiscalIntentAndRecoversAnExpiredLeaseAcrossRestart()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var now = DateTimeOffset.UtcNow;
        var organizationId = Guid.NewGuid().ToString();
        var unitId = Guid.NewGuid().ToString();
        var actorId = Guid.NewGuid().ToString();
        var request = new FiscalRequest(
            "order-2026-lease",
            actorId,
            Guid.NewGuid().ToString(),
            2590,
            "{\"sensitive\":true}");
        var payload = JsonSerializer.Serialize(request);

        var created = await store.CreateOrGetFiscalOperationAsync(
            organizationId, unitId, actorId, Guid.NewGuid().ToString(),
            "issue", request.IdempotencyKey, payload, now);
        var replay = await store.CreateOrGetFiscalOperationAsync(
            organizationId, unitId, actorId, Guid.NewGuid().ToString(),
            "issue", request.IdempotencyKey, payload, now);

        Assert.True(created.Inserted);
        Assert.False(replay.Inserted);
        Assert.Equal(created.Operation.Id, replay.Operation.Id);
        var claimed = Assert.IsType<StoredFiscalOperation>(
            await store.ClaimFiscalOperationAsync(created.Operation.Id, now, TimeSpan.FromSeconds(30), 5));
        Assert.Null(await store.ClaimFiscalOperationAsync(
            created.Operation.Id, now, TimeSpan.FromSeconds(30), 5));
        Assert.Equal(1, claimed.AttemptCount);

        await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.CreateOrGetFiscalOperationAsync(
                organizationId, unitId, actorId, Guid.NewGuid().ToString(),
                "issue", request.IdempotencyKey,
                JsonSerializer.Serialize(request with { TotalInCents = 9999 }), now));

        SqliteConnection.ClearAllPools();
        var restarted = CreateStore();
        await restarted.InitializeAsync();
        var reclaimed = Assert.IsType<StoredFiscalOperation>(
            await restarted.ClaimFiscalOperationAsync(
                created.Operation.Id, now.AddSeconds(31), TimeSpan.FromSeconds(30), 5));
        Assert.Equal(2, reclaimed.AttemptCount);
        Assert.NotEqual(claimed.LeaseToken, reclaimed.LeaseToken);
    }

    [Fact]
    public void BuildsACanonicalTerminalFiscalReconciliationEvent()
    {
        var snapshot = SnapshotWithKdsOrder("order-1");
        var deviceId = Guid.NewGuid().ToString();
        var request = new FiscalConsultRequest(Guid.NewGuid().ToString(), "order-2026-0201");

        var command = FiscalEventFactory.FromConsult(
            snapshot,
            deviceId,
            request,
            new FiscalResult(true, "authorized", "35260812345678000199650010000002011000002019", null),
            DateTimeOffset.UtcNow)!;

        Assert.Empty(command.Validate());
        Assert.Equal(snapshot.OrganizationId, command.OrganizationId);
        Assert.Equal(snapshot.UnitId, command.UnitId);
        Assert.Equal(deviceId, command.DeviceId);
        Assert.Equal("fiscal.document.reconciled", command.Type);
        Assert.Equal("fiscal.document.reconciled", command.Payload.GetProperty("kind").GetString());
        Assert.Equal("authorized", command.Payload.GetProperty("status").GetString());
        Assert.Equal(
            "35260812345678000199650010000002011000002019",
            command.Payload.GetProperty("providerReference").GetString());
    }

    [Fact]
    public async Task StoresOnlyHashedPairingTokenAndAuthorizesIt()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        var authenticator = new DeviceAuthenticator(
            Options.Create(new HubOptions { DataDirectory = _directory, DatabaseKey = TestKey, EnrollmentCode = "654321" }),
            store);

        var deviceId = Guid.NewGuid().ToString();
        var pairing = await authenticator.PairAsync(new PairDeviceRequest(deviceId, "Caixa 01", "654321"));

        Assert.True(pairing.IsSuccess);
        Assert.NotNull(pairing.Token);
        Assert.True(await authenticator.IsAuthorizedAsync(pairing.Token));
        Assert.False(await authenticator.IsAuthorizedAsync("wrong-token"));
        Assert.Equal(deviceId, (await authenticator.AuthenticateAsync(pairing.Token))?.DeviceId);
        Assert.True(DeviceAuthenticator.MatchesDeviceScope(deviceId, deviceId.ToUpperInvariant()));
        Assert.False(DeviceAuthenticator.MatchesDeviceScope(deviceId, Guid.NewGuid().ToString()));
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
        Assert.Empty(await store.GetPendingCloudAcknowledgementsAsync(10));
        await store.SaveOperationalSnapshotAsync(SnapshotWithKdsOrder("order-1"));
        Assert.Equal(1, await store.ProcessPendingCloudCommandsAsync());
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

    private static OperationalSnapshot SnapshotWithKdsOrder(string orderId) => new(
        Guid.NewGuid().ToString(),
        Guid.NewGuid().ToString(),
        DateTimeOffset.UtcNow,
        Element(new { products = Array.Empty<object>() }),
        Element(new { rooms = Array.Empty<object>(), tables = Array.Empty<object>(), openTabs = Array.Empty<object>() }),
        Element(Array.Empty<object>()),
        Element(new { }),
        Element(new
        {
            tickets = new[] { new { id = Guid.NewGuid().ToString(), orderId, status = "pending" } },
            items = Array.Empty<object>(),
        }));

    private static JsonElement Element(object value) =>
        JsonSerializer.SerializeToElement(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
}
