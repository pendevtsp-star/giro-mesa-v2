using System.Net;
using System.Text;
using System.Text.Json;
using GiroMesa.EdgeHub.Storage;
using GiroMesa.EdgeHub.Sync;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class ConflictMatrixTests
{
    public static IEnumerable<object[]> Fixtures()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "conflict-matrix.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var fixture in document.RootElement.EnumerateArray())
        {
            yield return [fixture.Clone()];
        }
    }

    [Theory]
    [MemberData(nameof(Fixtures))]
    public void Mirrors_the_cloud_conflict_contract(JsonElement fixture)
    {
        var input = fixture.GetProperty("input");
        var expected = fixture.GetProperty("expected");

        var actual = EdgeConflictMatrix.Decide(new EdgeConflictInput(
            input.GetProperty("commandType").GetString()!,
            input.GetProperty("delivery").GetString()!,
            input.GetProperty("protocol").GetString()!,
            NullableString(input, "commandEpoch"),
            NullableString(input, "currentEpoch"),
            NullableInt(input, "commandVersion"),
            NullableInt(input, "currentVersion"),
            input.GetProperty("resourceState").GetString()!));

        Assert.Equal(expected.GetProperty("outcome").GetString(), actual.Outcome);
        Assert.Equal(expected.GetProperty("code").GetString(), actual.Code);
    }

    private static string? NullableString(JsonElement element, string property) =>
        element.GetProperty(property).ValueKind == JsonValueKind.Null
            ? null
            : element.GetProperty(property).GetString();

    private static int? NullableInt(JsonElement element, string property) =>
        element.GetProperty(property).ValueKind == JsonValueKind.Null
            ? null
            : element.GetProperty(property).GetInt32();

    [Fact]
    public async Task Surfaces_reconciliation_without_overwriting_cloud_authority()
    {
        var directory = Path.Combine(Path.GetTempPath(), "giromesa-conflict-tests", Guid.NewGuid().ToString("N"));
        var options = Options.Create(new HubOptions
        {
            DataDirectory = directory,
            DatabaseKey = "test-database-key-32-characters-long",
            CloudApiBaseUrl = "https://cloud.example",
            CloudSyncKey = "cloud-sync-secret",
        });
        try
        {
            var store = new HubStore(options, NullLogger<HubStore>.Instance);
            await store.InitializeAsync();
            var eventId = Guid.NewGuid().ToString();
            await store.AcceptCommandAsync(new OperationalCommand(
                eventId,
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222",
                Guid.NewGuid().ToString(),
                Guid.NewGuid().ToString(),
                "order.created",
                JsonDocument.Parse("""{"orderId":"order-1"}""").RootElement.Clone(),
                1,
                DateTimeOffset.UtcNow,
                "edge-conflict-0001"));
            var worker = new CloudSyncWorker(
                new HttpClient(new ReconciliationHandler(eventId)),
                store,
                options,
                NullLogger<CloudSyncWorker>.Instance);

            await worker.SyncOnceAsync();

            Assert.Equal("reconciling", worker.Status);
            Assert.Single(worker.AuthoritativeOutcomes);
            Assert.Equal("quarantined", worker.AuthoritativeOutcomes[0].Status);
            Assert.Single(await store.GetPendingAsync(10));
            Assert.Null(await store.GetOperationalSnapshotAsync());
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    private sealed class ReconciliationHandler(string eventId) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var response = new
            {
                acceptedEventIds = Array.Empty<string>(),
                rejectedEvents = new[] { new { id = eventId, code = "OCCUPANCY_EPOCH_MISMATCH" } },
                eventResults = new[]
                {
                    new
                    {
                        id = eventId,
                        replayed = false,
                        result = new { status = "quarantined", code = "OCCUPANCY_EPOCH_MISMATCH" },
                    },
                },
                commands = Array.Empty<object>(),
                serverTime = DateTimeOffset.UtcNow,
                snapshot = new
                {
                    organizationId = "11111111-1111-4111-8111-111111111111",
                    unitId = "22222222-2222-4222-8222-222222222222",
                    capturedAt = DateTimeOffset.UtcNow,
                    catalog = new { products = Array.Empty<object>() },
                    floor = new { rooms = Array.Empty<object>(), tables = Array.Empty<object>(), openTabs = Array.Empty<object>() },
                    tabs = Array.Empty<object>(),
                    tabDetails = new { },
                    kds = new { tickets = Array.Empty<object>(), items = Array.Empty<object>() },
                },
            };
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                    Encoding.UTF8,
                    "application/json"),
            });
        }
    }
}
