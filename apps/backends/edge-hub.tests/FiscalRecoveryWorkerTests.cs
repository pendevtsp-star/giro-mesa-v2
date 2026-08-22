using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class FiscalRecoveryWorkerTests : IAsyncLifetime
{
    private const string DatabaseKey = "test-database-key-32-characters-long";
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(), "giromesa-edgehub-fiscal-recovery-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task RetriesThenReconcilesAProcessingIssueWithoutLeakingTheProviderPayload()
    {
        var options = TestOptions(maxAttempts: 5);
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var snapshot = Snapshot();
        await store.SaveOperationalSnapshotAsync(snapshot);
        var request = new FiscalRequest(
            "order-2026-recovery",
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            2590,
            "{\"provider_secret\":true}");
        var created = await store.CreateOrGetFiscalOperationAsync(
            snapshot.OrganizationId,
            snapshot.UnitId,
            request.ActorIdentityId,
            Guid.NewGuid().ToString(),
            "issue",
            request.IdempotencyKey,
            JsonSerializer.Serialize(request),
            DateTimeOffset.UtcNow);
        var gateway = new SequenceFiscalGateway(
            [
                new(false, "retryable", request.IdempotencyKey, "FOCUS_TIMEOUT"),
                new(false, "processing", request.IdempotencyKey, "FOCUS_PROCESSING"),
            ],
            [new(true, "authorized", "35260812345678000199650010000002011000002019", null)]);
        var worker = new FiscalRecoveryWorker(
            gateway, store, options, NullLogger<FiscalRecoveryWorker>.Instance);
        var start = created.Operation.CreatedAt;

        Assert.Equal("retryable", (await worker.TryProcessAsync(created.Operation.Id, start))?.Status);
        Assert.Empty(await store.GetPendingAsync(10));
        Assert.Equal("processing", (await worker.TryProcessAsync(
            created.Operation.Id, start.AddSeconds(1)))?.Status);
        Assert.Single(await store.GetPendingAsync(10));
        Assert.Equal("authorized", (await worker.TryProcessAsync(
            created.Operation.Id, start.AddSeconds(3)))?.Status);

        var pending = await store.GetPendingAsync(10);
        Assert.Equal(2, pending.Count);
        Assert.Contains(pending, item => item.Type == "fiscal.document.issue_result");
        Assert.Contains(pending, item => item.Type == "fiscal.document.reconciled");
        Assert.All(pending, item => Assert.DoesNotContain("provider_secret", item.Payload));
        Assert.Equal(2, gateway.IssueCalls);
        Assert.Equal(1, gateway.ConsultCalls);
        var completed = Assert.IsType<StoredFiscalOperation>(
            await store.GetFiscalOperationAsync(created.Operation.Id));
        Assert.Equal("completed", completed.Status);
        Assert.Equal("authorized", completed.LastResult?.Status);
    }

    [Fact]
    public async Task DeadLettersAfterTheConfiguredAttemptLimit()
    {
        var options = TestOptions(maxAttempts: 2);
        var store = new HubStore(options, NullLogger<HubStore>.Instance);
        await store.InitializeAsync();
        var snapshot = Snapshot();
        await store.SaveOperationalSnapshotAsync(snapshot);
        var request = new FiscalRequest(
            "order-2026-dead-letter",
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            100,
            "{}");
        var created = await store.CreateOrGetFiscalOperationAsync(
            snapshot.OrganizationId,
            snapshot.UnitId,
            request.ActorIdentityId,
            Guid.NewGuid().ToString(),
            "issue",
            request.IdempotencyKey,
            JsonSerializer.Serialize(request),
            DateTimeOffset.UtcNow);
        var gateway = new SequenceFiscalGateway(
            [
                new(false, "retryable", request.IdempotencyKey, "FOCUS_TIMEOUT"),
                new(false, "retryable", request.IdempotencyKey, "FOCUS_TIMEOUT"),
            ],
            []);
        var worker = new FiscalRecoveryWorker(
            gateway, store, options, NullLogger<FiscalRecoveryWorker>.Instance);
        var start = created.Operation.CreatedAt;

        await worker.TryProcessAsync(created.Operation.Id, start);
        await worker.TryProcessAsync(created.Operation.Id, start.AddSeconds(1));

        var exhausted = Assert.IsType<StoredFiscalOperation>(
            await store.GetFiscalOperationAsync(created.Operation.Id));
        Assert.Equal("dead_letter", exhausted.Status);
        Assert.Equal(2, exhausted.AttemptCount);
        Assert.Equal("FOCUS_TIMEOUT", exhausted.LastErrorCode);
        Assert.Empty(await store.GetPendingAsync(10));
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    private IOptions<HubOptions> TestOptions(int maxAttempts) => Options.Create(new HubOptions
    {
        DataDirectory = _directory,
        DatabaseKey = DatabaseKey,
        Focus = new FocusOptions
        {
            RetryBaseSeconds = 1,
            RetryMaxSeconds = 10,
            RetryMaxAttempts = maxAttempts,
            RetryLeaseSeconds = 30,
        },
    });

    private static OperationalSnapshot Snapshot() => new(
        Guid.NewGuid().ToString(),
        Guid.NewGuid().ToString(),
        DateTimeOffset.UtcNow,
        Element(new { products = Array.Empty<object>() }),
        Element(new { rooms = Array.Empty<object>(), tables = Array.Empty<object>(), openTabs = Array.Empty<object>() }),
        Element(Array.Empty<object>()),
        Element(new { }),
        Element(new { tickets = Array.Empty<object>(), items = Array.Empty<object>() }));

    private static JsonElement Element(object value) =>
        JsonSerializer.SerializeToElement(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    private sealed class SequenceFiscalGateway(
        IEnumerable<FiscalResult> issueResults,
        IEnumerable<FiscalResult> consultResults) : IFiscalGateway
    {
        private readonly Queue<FiscalResult> _issueResults = new(issueResults);
        private readonly Queue<FiscalResult> _consultResults = new(consultResults);
        public int IssueCalls { get; private set; }
        public int ConsultCalls { get; private set; }
        public CapabilityState Capability => new(true, "test", "configured");

        public Task<FiscalResult> IssueAsync(
            FiscalRequest request,
            CancellationToken cancellationToken = default)
        {
            IssueCalls += 1;
            return Task.FromResult(_issueResults.Dequeue());
        }

        public Task<FiscalResult> ConsultAsync(
            FiscalConsultRequest request,
            CancellationToken cancellationToken = default)
        {
            ConsultCalls += 1;
            return Task.FromResult(_consultResults.Dequeue());
        }

        public Task<FiscalResult> CancelAsync(
            string documentReference,
            FiscalCancellationRequest request,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<FiscalResult> InvalidateNumbersAsync(
            FiscalNumberInvalidationRequest request,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
