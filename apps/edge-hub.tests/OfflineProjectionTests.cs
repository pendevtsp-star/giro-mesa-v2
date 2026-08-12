using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class OfflineProjectionTests : IAsyncLifetime
{
    private const string OrganizationId = "11111111-1111-4111-8111-111111111111";
    private const string UnitId = "22222222-2222-4222-8222-222222222222";
    private const string ActorId = "33333333-3333-4333-8333-333333333333";
    private const string DeviceId = "44444444-4444-4444-8444-444444444444";
    private const string TableId = "55555555-5555-4555-8555-555555555555";
    private const string TableTwoId = "55555555-5555-4555-8555-555555555556";
    private const string TableThreeId = "55555555-5555-4555-8555-555555555557";
    private const string ProductId = "66666666-6666-4666-8666-666666666666";
    private const string StationId = "77777777-7777-4777-8777-777777777777";
    private const string ManagerMembershipId = "77777777-7777-4777-8777-777777777778";
    private const string ManagerPinHash = "$argon2id$v=19$m=65536,t=3,p=4$3E/r2+R/fTbiF1G7o82ZQg$BOB12RuJPLwC232UQ5wxEPYUj/pvfY2HJ/pBecluWWA";
    private const string TestKey = "test-database-key-32-characters-long";
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(),
        "giromesa-edgehub-offline-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task ProjectsPilotFlowAtomicallyAndSurvivesReplayConflictRejectionAndRestart()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(Snapshot());

        var open = Command(
            "88888888-8888-4888-8888-888888888888",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 2 } });
        var opened = await store.AcceptCommandAsync(open);
        Assert.Equal(open.Id, opened.Result!.Value.GetProperty("tab").GetProperty("id").GetString());

        var occupied = Command(
            "99999999-9999-4999-8999-999999999999",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 1 } });
        var occupiedError = await Assert.ThrowsAsync<OperationalConflictException>(
            () => store.AcceptCommandAsync(occupied));
        Assert.Equal("TABLE_OCCUPIED", occupiedError.Code);
        Assert.Single(await store.GetPendingAsync(20));

        var create = Command(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "pos.order.create_requested",
            "create-order",
            new
            {
                tabId = open.Id,
                body = new
                {
                    items = new[]
                    {
                        new { productId = ProductId, quantity = 2, modifierOptionIds = Array.Empty<string>() },
                    },
                },
            });
        var created = await store.AcceptCommandAsync(create);
        var itemId = created.Result!.Value.GetProperty("items")[0].GetProperty("id").GetString();
        Assert.Equal(StableId(create.Id, "order-item", "0"), itemId);
        Assert.Equal(2_500, created.Result.Value.GetProperty("totals").GetProperty("totalCents").GetInt64());

        var send = Command(
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "pos.order.send_requested",
            "send-order",
            new { orderId = create.Id });
        var sent = await store.AcceptCommandAsync(send);
        var ticketId = sent.Result!.Value.GetProperty("ticketIds")[0].GetString();
        Assert.Equal(StableId(send.Id, "kds-ticket", StationId), ticketId);

        var transition = Command(
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "pos.kds.transition_requested",
            "transition-kds",
            new { ticketId, state = "preparing" },
            "transition-key-0001");
        var transitioned = await store.AcceptCommandAsync(transition);
        var replay = await store.AcceptCommandAsync(transition);
        Assert.True(transitioned.Inserted);
        Assert.False(replay.Inserted);
        Assert.Equal("preparing", replay.Result!.Value.GetProperty("state").GetString());
        Assert.Equal(4, (await store.GetPendingAsync(20)).Count);

        var conflict = Command(
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "pos.kds.transition_requested",
            "transition-kds",
            new { ticketId, state = "ready" },
            "transition-key-0001");
        var conflictError = await Assert.ThrowsAsync<OperationalConflictException>(
            () => store.AcceptCommandAsync(conflict));
        Assert.Equal("IDEMPOTENCY_CONFLICT", conflictError.Code);
        Assert.Equal(4, (await store.GetPendingAsync(20)).Count);

        Assert.True(await store.RejectEventAsync(transition.Id, "INVALID_KDS_TRANSITION"));
        var reconciliation = await store.GetReconciliationAsync(10);
        Assert.Single(reconciliation);
        Assert.Equal(transition.Id, reconciliation[0].Id);
        Assert.Equal("INVALID_KDS_TRANSITION", reconciliation[0].Reason);

        SqliteConnection.ClearAllPools();
        var restarted = CreateStore();
        await restarted.InitializeAsync();
        var snapshot = await restarted.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(snapshot);
        Assert.Single(snapshot!.Tabs.EnumerateArray());
        Assert.Equal(
            "occupied",
            snapshot.Floor.GetProperty("tables")[0].GetProperty("status").GetString());
        var detail = snapshot.TabDetails.GetProperty(open.Id);
        Assert.Equal("preparing", detail.GetProperty("orders")[0].GetProperty("status").GetString());
        Assert.Equal("preparing", snapshot.Kds.GetProperty("tickets")[0].GetProperty("status").GetString());
        Assert.Equal("preparing", detail.GetProperty("items")[0].GetProperty("status").GetString());
        Assert.Equal(3, (await restarted.GetPendingAsync(20)).Count);
    }

    [Fact]
    public async Task PersistsDerivedV2ResourcesSequenceAndCapturedPriceReference()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(V2Snapshot());
        var open = Command(
            "30000000-0000-4000-8000-000000000001",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 2 } });
        await store.AcceptCommandAsync(open);
        var tip = Command(
            "30000000-0000-4000-8000-000000000002",
            "pos.tab.tip_requested",
            "tip",
            new { tabId = open.Id, tipCents = 100 });
        await store.AcceptCommandAsync(tip);
        var transfer = Command(
            "30000000-0000-4000-8000-000000000003",
            "pos.tab.transfer_requested",
            "transfer-tab",
            new { tabId = open.Id, body = new { tableId = TableTwoId, reason = "Mudança segura" } });
        await store.AcceptCommandAsync(transfer);
        var create = Command(
            "30000000-0000-4000-8000-000000000004",
            "pos.order.create_requested",
            "create-order",
            new
            {
                tabId = open.Id,
                body = new
                {
                    items = new[]
                    {
                        new { productId = ProductId, quantity = 1, modifierOptionIds = Array.Empty<string>() },
                    },
                },
            });
        await store.AcceptCommandAsync(create);

        var pending = await store.GetPendingAsync(20, includeSecrets: true);
        Assert.All(pending, command => Assert.Equal(2, command.ProtocolVersion));
        Assert.Equal<int?>([1, 2, 3, 4], pending.Select(command => command.AggregateSequence));
        Assert.Equal(2, pending[0].ResourcePreconditions!.Count);
        Assert.Equal(3, pending[2].ResourcePreconditions!.Count);
        Assert.Single(pending[3].PriceReferences!);
        Assert.Equal("server-issued-price-reference-0001", pending[3].PriceReferences![0].Token);
        Assert.Equal("2026-08-10T12:00:00.000Z", pending[3].PriceReferences![0].PriceRevision);
        Assert.Equal(3, pending[3].ResourcePreconditions!.Single().ResourceVersion);
    }

    [Fact]
    public void ReusesTheScopedActorCacheForFiscalAuthorization()
    {
        var snapshot = Snapshot();
        snapshot.RequireActorRole(ActorId, ["owner", "manager", "cashier"], DateTimeOffset.UtcNow);

        var denied = Assert.Throws<OperationalConflictException>(() =>
            snapshot.RequireActorRole(
                "99999999-9999-4999-8999-999999999999",
                ["owner", "manager", "cashier"],
                DateTimeOffset.UtcNow));
        Assert.Equal("OFFLINE_ACTOR_AUTHORIZATION_DENIED", denied.Code);
    }

    [Fact]
    public async Task ReappliesStillPendingEventsOverACloudSnapshot()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(Snapshot());
        var open = Command(
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 3 } });
        await store.AcceptCommandAsync(open);

        await store.SaveOperationalSnapshotAsync(Snapshot());

        var rebased = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(rebased);
        Assert.Equal(open.Id, rebased!.Tabs[0].GetProperty("id").GetString());
        Assert.Equal("occupied", rebased.Floor.GetProperty("tables")[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task ProjectsExtendedOfflineFlowWithVerifiedManagerApprovalAndStableSplitIds()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(Snapshot(withApprovals: true));
        var target = Command(
            "10000000-0000-4000-8000-000000000001",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 2 } });
        await store.AcceptCommandAsync(target);
        var transfer = Command(
            "10000000-0000-4000-8000-000000000002",
            "pos.tab.transfer_requested",
            "transfer-tab",
            new { tabId = target.Id, body = new { tableId = TableTwoId, reason = "Mudança operacional" } });
        Assert.Equal(TableTwoId, (await store.AcceptCommandAsync(transfer)).Result!.Value.GetProperty("tableId").GetString());

        var source = Command(
            "10000000-0000-4000-8000-000000000003",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 1 } });
        await store.AcceptCommandAsync(source);
        var create = Command(
            "10000000-0000-4000-8000-000000000004",
            "pos.order.create_requested",
            "create-order",
            new
            {
                tabId = source.Id,
                body = new
                {
                    items = new[]
                    {
                        new { productId = ProductId, quantity = 4, modifierOptionIds = Array.Empty<string>() },
                    },
                },
            });
        var created = await store.AcceptCommandAsync(create);
        var itemId = created.Result!.Value.GetProperty("items")[0].GetProperty("id").GetString()!;
        var merge = Command(
            "10000000-0000-4000-8000-000000000005",
            "pos.tabs.merge_requested",
            "merge-tabs",
            new { body = new { targetTabId = target.Id, sourceTabIds = new[] { source.Id } } });
        Assert.Equal(5_000, (await store.AcceptCommandAsync(merge)).Result!.Value
            .GetProperty("totals").GetProperty("totalCents").GetInt64());

        var service = Command(
            "10000000-0000-4000-8000-000000000006",
            "pos.tab.service_charge_requested",
            "service-charge",
            new { tabId = target.Id, basisPoints = 1_000 });
        Assert.Equal(5_500, (await store.AcceptCommandAsync(service)).Result!.Value
            .GetProperty("totals").GetProperty("totalCents").GetInt64());
        var tip = Command(
            "10000000-0000-4000-8000-000000000007",
            "pos.tab.tip_requested",
            "tip",
            new { tabId = target.Id, tipCents = 200 });
        Assert.Equal(5_700, (await store.AcceptCommandAsync(tip)).Result!.Value
            .GetProperty("totals").GetProperty("totalCents").GetInt64());

        var approval = new
        {
            approverMembershipId = ManagerMembershipId,
            pin = "1234",
            reason = "Ajuste autorizado",
        };
        var discount = Command(
            "10000000-0000-4000-8000-000000000008",
            "pos.item.discount_requested",
            "discount-item",
            new { itemId, body = new { discountCents = 1_000, approval } });
        var discounted = await store.AcceptCommandAsync(discount);
        Assert.Equal(StableId(discount.Id, "approval", ""),
            discounted.Result!.Value.GetProperty("approvalId").GetString());
        Assert.Equal(4_600, discounted.Result.Value.GetProperty("totals").GetProperty("totalCents").GetInt64());

        var split = Command(
            "10000000-0000-4000-8000-000000000009",
            "pos.tab.split_requested",
            "split-tab",
            new
            {
                tabId = target.Id,
                body = new
                {
                    tableId = TableThreeId,
                    label = "Conta separada",
                    items = new[] { new { orderItemId = itemId, quantity = 2 } },
                },
            });
        var splitResult = await store.AcceptCommandAsync(split);
        var movedItemId = StableId(split.Id, "split-item", itemId);
        Assert.Equal(split.Id, splitResult.Result!.Value.GetProperty("targetTabId").GetString());
        Assert.Equal(movedItemId, splitResult.Result.Value.GetProperty("movedItemIds")[0].GetString());
        Assert.Equal(2_400, splitResult.Result.Value.GetProperty("sourceTotals").GetProperty("totalCents").GetInt64());
        Assert.Equal(2_200, splitResult.Result.Value.GetProperty("targetTotals").GetProperty("totalCents").GetInt64());

        var cancel = Command(
            "10000000-0000-4000-8000-000000000010",
            "pos.item.cancel_requested",
            "cancel-item",
            new { itemId = movedItemId, approval });
        var canceled = await store.AcceptCommandAsync(cancel);
        Assert.Equal(StableId(cancel.Id, "approval", ""),
            canceled.Result!.Value.GetProperty("approvalId").GetString());
        Assert.Equal(0, canceled.Result.Value.GetProperty("totals").GetProperty("totalCents").GetInt64());
        Assert.False((await store.AcceptCommandAsync(cancel)).Inserted);

        var invalidApproval = Command(
            "10000000-0000-4000-8000-000000000011",
            "pos.item.discount_requested",
            "discount-item",
            new
            {
                itemId,
                body = new
                {
                    discountCents = 100,
                    approval = new
                    {
                        approverMembershipId = ManagerMembershipId,
                        pin = "9999",
                        reason = "Tentativa inválida",
                    },
                },
            });
        var denied = await Assert.ThrowsAsync<OperationalConflictException>(
            () => store.AcceptCommandAsync(invalidApproval));
        Assert.Equal("OFFLINE_MANAGER_APPROVAL_DENIED", denied.Code);

        var unauthorized = Command(
            "10000000-0000-4000-8000-000000000012",
            "pos.tab.tip_requested",
            "tip",
            new { tabId = target.Id, tipCents = 1 }) with
        {
            ActorId = "90000000-0000-4000-8000-000000000001",
        };
        var actorDenied = await Assert.ThrowsAsync<OperationalConflictException>(
            () => store.AcceptCommandAsync(unauthorized));
        Assert.Equal("OFFLINE_ACTOR_AUTHORIZATION_DENIED", actorDenied.Code);
        Assert.Equal(10, (await store.GetPendingAsync(20)).Count);
        Assert.DoesNotContain("1234", (await store.GetPendingAsync(20)).Single(row => row.Id == cancel.Id).Payload);
        Assert.Contains("1234", (await store.GetPendingAsync(20, includeSecrets: true)).Single(row => row.Id == cancel.Id).Payload);
        Assert.True(await store.RejectEventAsync(cancel.Id, "CLOUD_APPROVAL_REJECTED"));
        Assert.DoesNotContain(
            "1234",
            (await store.GetReconciliationAsync(20)).Single(row => row.Id == cancel.Id).Payload.GetRawText());

        SqliteConnection.ClearAllPools();
        var restarted = CreateStore();
        await restarted.InitializeAsync();
        var snapshot = await restarted.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(snapshot);
        Assert.Equal("merged", snapshot!.TabDetails.GetProperty(source.Id).GetProperty("tab").GetProperty("status").GetString());
        Assert.Equal("canceled", snapshot.TabDetails.GetProperty(split.Id).GetProperty("items")[0].GetProperty("status").GetString());
        Assert.Equal(StableId(split.Id, "split-order", ""),
            snapshot.TabDetails.GetProperty(split.Id).GetProperty("orders")[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task PartialSplitUsesStableModifierIdFromCloudSnapshot()
    {
        const string sourceTabId = "20000000-0000-4000-8000-000000000001";
        const string sourceOrderId = "20000000-0000-4000-8000-000000000002";
        const string sourceItemId = "20000000-0000-4000-8000-000000000003";
        const string sourceModifierId = "20000000-0000-4000-8000-000000000004";
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(
            SnapshotWithModifier(sourceTabId, sourceOrderId, sourceItemId, sourceModifierId));
        var split = Command(
            "20000000-0000-4000-8000-000000000005",
            "pos.tab.split_requested",
            "split-tab",
            new
            {
                tabId = sourceTabId,
                body = new
                {
                    tableId = TableTwoId,
                    items = new[] { new { orderItemId = sourceItemId, quantity = 1 } },
                },
            });

        await store.AcceptCommandAsync(split);

        var snapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(snapshot);
        var expected = StableId(split.Id, "split-modifier", $"{sourceItemId}:{sourceModifierId}");
        Assert.Equal(
            expected,
            snapshot!.TabDetails.GetProperty(split.Id).GetProperty("modifiers")[0].GetProperty("id").GetString());
        Assert.Equal(
            sourceModifierId,
            snapshot.TabDetails.GetProperty(sourceTabId).GetProperty("modifiers")[0].GetProperty("id").GetString());
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        return Task.CompletedTask;
    }

    private HubStore CreateStore() => new(
        Options.Create(new HubOptions { DataDirectory = _directory, DatabaseKey = TestKey }),
        NullLogger<HubStore>.Instance);

    private static OperationalSnapshot Snapshot(bool withApprovals = false) => new(
        OrganizationId,
        UnitId,
        DateTimeOffset.UtcNow,
        Element(new
        {
            categories = Array.Empty<object>(),
            allergens = Array.Empty<object>(),
            modifierGroups = Array.Empty<object>(),
            modifierOptions = Array.Empty<object>(),
            products = new[] { new { id = ProductId, name = "Prato piloto", active = true } },
            recipes = Array.Empty<object>(),
            productAllergens = Array.Empty<object>(),
            productModifierGroups = Array.Empty<object>(),
            prices = new[] { new { organizationId = OrganizationId, unitId = UnitId, productId = ProductId, priceCents = 1_250 } },
            availability = new[] { new { organizationId = OrganizationId, unitId = UnitId, productId = ProductId, available = true } },
            stations = new[] { new { id = StationId, organizationId = OrganizationId, unitId = UnitId, active = true } },
            productStations = new[] { new { organizationId = OrganizationId, unitId = UnitId, productId = ProductId, stationId = StationId } },
        }),
        Element(new
        {
            rooms = Array.Empty<object>(),
            tables = new[]
            {
                new { id = TableId, status = "available", active = true },
                new { id = TableTwoId, status = "available", active = true },
                new { id = TableThreeId, status = "available", active = true },
            },
            openTabs = Array.Empty<object>(),
        }),
        Element(Array.Empty<object>()),
        Element(new Dictionary<string, object>()),
        Element(new { tickets = Array.Empty<object>(), items = Array.Empty<object>() }),
        Element(new
        {
            validUntil = DateTimeOffset.UtcNow.AddHours(1),
            actors = new[]
            {
                new
                {
                    identityId = ActorId,
                    roles = new[] { "owner", "manager", "waiter", "cashier", "kds" },
                },
            },
            managers = withApprovals
                ? new object[] { new { membershipId = ManagerMembershipId, pinHash = ManagerPinHash } }
                : Array.Empty<object>(),
        }));

    private static OperationalSnapshot V2Snapshot()
    {
        var snapshot = Snapshot(withApprovals: true);
        var root = JsonNode.Parse(JsonSerializer.Serialize(
            snapshot,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)))!.AsObject();
        foreach (var table in root["floor"]!["tables"]!.AsArray().OfType<JsonObject>())
        {
            table["occupancyEpoch"] = StableId(table["id"]!.GetValue<string>(), "table-epoch", "");
            table["resourceVersion"] = 0;
        }
        root["catalog"]!["prices"]![0]!["priceReference"] =
            "server-issued-price-reference-0001";
        root["catalog"]!["prices"]![0]!["priceRevision"] = "2026-08-10T12:00:00.000Z";
        return JsonSerializer.Deserialize<OperationalSnapshot>(
            root.ToJsonString(),
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    private static OperationalSnapshot SnapshotWithModifier(
        string tabId,
        string orderId,
        string itemId,
        string modifierId)
    {
        var now = DateTimeOffset.UtcNow;
        var tab = new
        {
            id = tabId,
            organizationId = OrganizationId,
            unitId = UnitId,
            tableId = TableId,
            openedByIdentityId = ActorId,
            label = "Mesa com modificador",
            guestCount = 2,
            status = "open",
            mergedIntoTabId = (string?)null,
            serviceChargeBasisPoints = 0,
            tipCents = 0,
            subtotalCents = 3_000,
            discountCents = 0,
            serviceChargeCents = 0,
            totalCents = 3_000,
            closedAt = (DateTimeOffset?)null,
            createdAt = now,
            updatedAt = now,
        };
        var order = new
        {
            id = orderId,
            organizationId = OrganizationId,
            unitId = UnitId,
            tabId,
            createdByIdentityId = ActorId,
            status = "draft",
            sentAt = (DateTimeOffset?)null,
            createdAt = now,
            updatedAt = now,
        };
        var item = new
        {
            id = itemId,
            organizationId = OrganizationId,
            unitId = UnitId,
            orderId,
            productId = ProductId,
            stationId = StationId,
            productName = "Prato com adicional",
            quantity = 2,
            unitPriceCents = 1_250,
            modifiersCents = 500,
            grossCents = 3_000,
            discountCents = 0,
            netCents = 3_000,
            status = "draft",
            notes = (string?)null,
            createdAt = now,
            updatedAt = now,
        };
        var modifier = new
        {
            id = modifierId,
            organizationId = OrganizationId,
            unitId = UnitId,
            orderItemId = itemId,
            optionId = "20000000-0000-4000-8000-000000000006",
            name = "Adicional",
            quantity = 1,
            unitDeltaCents = 250,
            totalDeltaCents = 500,
        };
        return new OperationalSnapshot(
            OrganizationId,
            UnitId,
            now,
            Element(new { }),
            Element(new
            {
                rooms = Array.Empty<object>(),
                tables = new[]
                {
                    new { id = TableId, status = "occupied", active = true },
                    new { id = TableTwoId, status = "available", active = true },
                },
                openTabs = new[] { tab },
            }),
            Element(new[] { tab }),
            Element(new Dictionary<string, object>
            {
                [tabId] = new
                {
                    tab,
                    orders = new[] { order },
                    items = new[] { item },
                    modifiers = new[] { modifier },
                },
            }),
            Element(new { tickets = Array.Empty<object>(), items = Array.Empty<object>() }),
            Element(new
            {
                validUntil = DateTimeOffset.UtcNow.AddHours(1),
                actors = new[]
                {
                    new
                    {
                        identityId = ActorId,
                        roles = new[] { "owner", "manager", "waiter", "cashier", "kds" },
                    },
                },
                managers = Array.Empty<object>(),
            }));
    }

    private static OperationalCommand Command(
        string id,
        string type,
        string action,
        object data,
        string? idempotencyKey = null) => new(
        id,
        OrganizationId,
        UnitId,
        ActorId,
        DeviceId,
        type,
        Element(new { kind = "pilot.mutation", action, data }),
        1,
        DateTimeOffset.UtcNow,
        idempotencyKey);

    private static JsonElement Element(object value) =>
        JsonSerializer.SerializeToElement(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    private static string StableId(string commandId, string kind, string suffix)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{commandId}|{kind}|{suffix}"))[..16];
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        var hex = Convert.ToHexStringLower(bytes);
        return $"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..]}";
    }
}
