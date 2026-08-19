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
    public async Task ProjectsTableCleaningBeforeMakingTheTableAvailable()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(Snapshot(firstTableStatus: "needs_cleaning"));

        var cleaning = Command(
            "77777777-7777-4777-8777-777777777701",
            "pos.table.turnover_requested",
            "table-turnover",
            new { tableId = TableId, status = "cleaning" });
        var cleaningResult = await store.AcceptCommandAsync(cleaning);
        Assert.Equal("cleaning", cleaningResult.Result!.Value.GetProperty("table").GetProperty("status").GetString());

        var available = Command(
            "77777777-7777-4777-8777-777777777702",
            "pos.table.turnover_requested",
            "table-turnover",
            new { tableId = TableId, status = "available" });
        await store.AcceptCommandAsync(available);

        var snapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.Equal("available", snapshot!.Floor.GetProperty("tables")[0].GetProperty("status").GetString());
    }

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
    public async Task ProjectsEverySupportedKdsActionIntoTheNestedReadModelAndRejectsTerminalBypass()
    {
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(Snapshot());

        var open = Command(
            "30000000-0000-4000-8000-000000000001",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 2 } });
        await store.AcceptCommandAsync(open);
        var create = Command(
            "30000000-0000-4000-8000-000000000002",
            "pos.order.create_requested",
            "create-order",
            new
            {
                tabId = open.Id,
                body = new
                {
                    items = new[]
                    {
                        new
                        {
                            productId = ProductId,
                            quantity = 2,
                            course = "starter",
                            notes = "  Sem sal\r\nMontar separado  ",
                            allergyNote = " Castanhas ",
                            modifierOptionIds = Array.Empty<string>(),
                        },
                    },
                },
            });
        var created = await store.AcceptCommandAsync(create);
        var itemId = created.Result!.Value.GetProperty("items")[0].GetProperty("id").GetString()!;
        var send = Command(
            "30000000-0000-4000-8000-000000000003",
            "pos.order.send_requested",
            "send-order",
            new { orderId = create.Id });
        var ticketId = (await store.AcceptCommandAsync(send)).Result!.Value
            .GetProperty("ticketIds")[0].GetString()!;

        var attentionSnapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(attentionSnapshot);
        var attention = attentionSnapshot!.Kds.GetProperty("items")[0].GetProperty("attention")
            .EnumerateArray().ToDictionary(note => note.GetProperty("id").GetString()!);
        Assert.Equal("Castanhas", attention["allergy"].GetProperty("text").GetString());
        Assert.Equal("Sem sal\nMontar separado", attention["notes"].GetProperty("text").GetString());
        Assert.Equal(
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("allergy\0Castanhas"))),
            attention["allergy"].GetProperty("revision").GetString());

        await store.AcceptCommandAsync(Command(
            "32000000-0000-4000-8000-000000000001",
            "pos.kds.item_block_requested",
            "block-kds-item",
            new { ticketId, itemId, code = "missing_ingredient", reason = "Sem castanhas seguras" }));
        var blockedTransition = await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.AcceptCommandAsync(Command(
                "32000000-0000-4000-8000-000000000002",
                "pos.kds.transition_requested",
                "transition-kds",
                new { ticketId, state = "preparing" })));
        Assert.Equal("KDS_ITEM_BLOCKED", blockedTransition.Code);
        await store.AcceptCommandAsync(Command(
            "32000000-0000-4000-8000-000000000003",
            "pos.kds.item_unblock_requested",
            "unblock-kds-item",
            new { ticketId, itemId, reason = "Insumo segregado e conferido" }));

        var staleAttention = await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.AcceptCommandAsync(Command(
                "32000000-0000-4000-8000-000000000004",
                "pos.kds.critical_note_acknowledged_requested",
                "acknowledge-kds-critical-note",
                new { ticketId, itemId, noteId = "allergy", revision = new string('0', 64) })));
        Assert.Equal("KDS_ATTENTION_REVISION_CHANGED", staleAttention.Code);

        var unblockedSnapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(unblockedSnapshot);
        var unblockedRow = unblockedSnapshot!.Kds.GetProperty("items")[0];
        Assert.False(unblockedRow.GetProperty("kds").GetProperty("blocked")
            .GetProperty("active").GetBoolean());
        Assert.Equal(1, unblockedRow.GetProperty("kds").GetProperty("blocked")
            .GetProperty("count").GetInt32());

        foreach (var terminalState in new[] { "done", "canceled" })
        {
            var invalid = Command(
                terminalState == "done"
                    ? "30000000-0000-4000-8000-000000000004"
                    : "30000000-0000-4000-8000-000000000005",
                "pos.kds.transition_requested",
                "transition-kds",
                new { ticketId, state = terminalState });
            var error = await Assert.ThrowsAsync<OperationalConflictException>(
                () => store.AcceptCommandAsync(invalid));
            Assert.Equal("INVALID_KDS_TRANSITION", error.Code);
        }

        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000006",
            "pos.kds.priority_requested",
            "set-kds-priority",
            new { ticketId, priority = 60, reason = "Prioridade da expedição" }));
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000007",
            "pos.kds.course_state_requested",
            "set-kds-course-state",
            new { ticketId, course = "starter", state = "held" }));
        var heldSnapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(heldSnapshot);
        Assert.True(heldSnapshot!.Kds.GetProperty("items")[0].GetProperty("kds")
            .GetProperty("held").GetBoolean());
        Assert.Equal(
            2,
            heldSnapshot.Kds.GetProperty("allDay")[0].GetProperty("heldQuantity").GetInt32());

        var noFiredItems = await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.AcceptCommandAsync(Command(
                "30000000-0000-4000-8000-000000000008",
                "pos.kds.transition_requested",
                "transition-kds",
                new { ticketId, state = "preparing" })));
        Assert.Equal("KDS_NO_FIRED_ITEMS", noFiredItems.Code);

        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000009",
            "pos.kds.course_state_requested",
            "set-kds-course-state",
            new { ticketId, course = "starter", state = "fired" }));
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000010",
            "pos.kds.transition_requested",
            "transition-kds",
            new { ticketId, state = "preparing" }));

        var acknowledgementRequired = await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.AcceptCommandAsync(Command(
                "32000000-0000-4000-8000-000000000005",
                "pos.kds.transition_requested",
                "transition-kds",
                new { ticketId, state = "ready" })));
        Assert.Equal("KDS_ATTENTION_ACK_REQUIRED", acknowledgementRequired.Code);
        foreach (var noteId in new[] { "allergy", "notes" })
        {
            await store.AcceptCommandAsync(Command(
                noteId == "allergy"
                    ? "32000000-0000-4000-8000-000000000006"
                    : "32000000-0000-4000-8000-000000000007",
                noteId == "allergy"
                    ? "pos.kds.critical_note_acknowledged_requested"
                    : "pos.kds.critical_note_acknowledgement_requested",
                "acknowledge-kds-critical-note",
                new
                {
                    ticketId,
                    itemId,
                    noteId,
                    revision = attention[noteId].GetProperty("revision").GetString(),
                }));
        }
        Assert.Equal(
            "pos.kds.critical_note_acknowledged_requested",
            (await store.GetPendingAsync(100))
                .Single(command => command.Id == "32000000-0000-4000-8000-000000000007").Type);
        var acknowledgedSnapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(acknowledgedSnapshot);
        Assert.All(
            acknowledgedSnapshot!.Kds.GetProperty("items")[0].GetProperty("attention").EnumerateArray(),
            note => Assert.True(note.GetProperty("acknowledged").GetBoolean()));

        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000011",
            "pos.kds.item_transition_requested",
            "transition-kds-item",
            new { ticketId, itemId, state = "ready", quantity = 1 }));

        var partiallyReady = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(partiallyReady);
        var partialProduction = partiallyReady!.Kds.GetProperty("items")[0].GetProperty("kds");
        Assert.Equal("preparing", partialProduction.GetProperty("status").GetString());
        Assert.Equal(1, partialProduction.GetProperty("readyQuantity").GetInt32());

        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000012",
            "pos.kds.item_transition_requested",
            "transition-kds-item",
            new { ticketId, itemId, state = "ready" }));
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000013",
            "pos.kds.recall_requested",
            "recall-kds",
            new { ticketId, reason = "Retorno da expedição" }));
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000014",
            "pos.kds.transition_requested",
            "transition-kds",
            new { ticketId, state = "ready" }));
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000015",
            "pos.kds.item_refire_requested",
            "refire-kds-item",
            new { ticketId, itemId, reason = "Reexecução autorizada" }));
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000016",
            "pos.kds.transition_requested",
            "transition-kds",
            new { ticketId, state = "ready" }));
        var expedition = Command(
            "30000000-0000-4000-8000-000000000017",
            "pos.kds.handoff_requested",
            "handoff-kds-order",
            new { orderId = create.Id, target = "expedition" });
        Assert.True((await store.AcceptCommandAsync(expedition)).Inserted);
        Assert.False((await store.AcceptCommandAsync(expedition)).Inserted);
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000018",
            "pos.kds.handoff_requested",
            "handoff-kds-order",
            new { orderId = create.Id, target = "served" }));
        var lifecycleCloudOnly = await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.AcceptCommandAsync(Command(
                "30000000-0000-4000-8000-000000000020",
                "pos.kds.product_availability_requested",
                "set-kds-product-availability",
                new
                {
                    productId = ProductId,
                    available = true,
                    reason = "Retorno manual",
                    resetAt = DateTimeOffset.UtcNow.AddHours(1).ToString("O"),
                })));
        Assert.Equal("OFFLINE_ACTION_CLOUD_ONLY", lifecycleCloudOnly.Code);
        await store.AcceptCommandAsync(Command(
            "30000000-0000-4000-8000-000000000019",
            "pos.kds.product_availability_requested",
            "set-kds-product-availability",
            new
            {
                productId = ProductId,
                available = false,
                reason = "Sem insumo",
            }));

        var snapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(snapshot);
        var ticket = snapshot!.Kds.GetProperty("tickets")[0];
        Assert.Equal("done", ticket.GetProperty("status").GetString());
        Assert.NotNull(ticket.GetProperty("servedAt").GetString());
        Assert.Equal(1, ticket.GetProperty("recallCount").GetInt32());
        Assert.Equal(1, ticket.GetProperty("refireCount").GetInt32());
        Assert.Equal(100, ticket.GetProperty("priority").GetInt32());
        var row = snapshot.Kds.GetProperty("items")[0];
        Assert.Equal("served", row.GetProperty("kds").GetProperty("status").GetString());
        Assert.Equal(2, row.GetProperty("kds").GetProperty("readyQuantity").GetInt32());
        Assert.Equal("served", row.GetProperty("item").GetProperty("status").GetString());
        Assert.Equal(
            "served",
            snapshot.TabDetails.GetProperty(open.Id).GetProperty("items")[0]
                .GetProperty("status").GetString());
        Assert.Equal(
            "served",
            snapshot.TabDetails.GetProperty(open.Id).GetProperty("orders")[0]
                .GetProperty("status").GetString());
        Assert.Equal(2, snapshot.Kds.GetProperty("allDay")[0].GetProperty("readyQuantity").GetInt32());
        Assert.False(snapshot.Catalog.GetProperty("availability")[0].GetProperty("available").GetBoolean());
        var productAvailability = Assert.Single(
            snapshot.Kds.GetProperty("productAvailability").EnumerateArray());
        Assert.Equal("unavailable", productAvailability.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, productAvailability.GetProperty("remainingQuantity").ValueKind);
        Assert.Equal("Sem insumo", productAvailability.GetProperty("reason").GetString());
        Assert.Equal(JsonValueKind.Null, productAvailability.GetProperty("resetAt").ValueKind);
    }

    [Fact]
    public async Task KeepsCanonicalOrderPriorityCloudOnlyAndProjectsTheLegacyAliasAcrossStations()
    {
        const string orderId = "33000000-0000-4000-8000-000000000001";
        const string tabId = "33000000-0000-4000-8000-000000000002";
        const string firstTicketId = "33000000-0000-4000-8000-000000000003";
        const string secondTicketId = "33000000-0000-4000-8000-000000000004";
        const string secondStationId = "33000000-0000-4000-8000-000000000005";
        const string firstItemId = "33000000-0000-4000-8000-000000000006";
        const string secondItemId = "33000000-0000-4000-8000-000000000007";
        var recommendation = new
        {
            state = "strained",
            suggestedDelayMinutes = 10,
            reasons = new[] { "queue_depth" },
        };
        var snapshot = Snapshot() with
        {
            TabDetails = Element(new Dictionary<string, object>
            {
                [tabId] = new
                {
                    tab = new { id = tabId },
                    orders = new[] { new { id = orderId, status = "sent" } },
                },
            }),
            Kds = Element(new
            {
                stations = new object[]
                {
                    new
                    {
                        id = StationId,
                        name = "Quente",
                        capacity = new
                        {
                            activeAssignments = 99,
                            blockedAssignments = 99,
                            queuedQuantity = 99,
                            preparingQuantity = 99,
                            recommendation,
                        },
                    },
                    new
                    {
                        id = secondStationId,
                        name = "Bar",
                        capacity = new
                        {
                            activeAssignments = 99,
                            blockedAssignments = 99,
                            queuedQuantity = 99,
                            preparingQuantity = 99,
                            recommendation,
                        },
                    },
                },
                tickets = new object[]
                {
                    new
                    {
                        id = firstTicketId,
                        orderId,
                        stationId = StationId,
                        status = "pending",
                        priority = 0,
                        rush = false,
                        servedAt = (string?)null,
                    },
                    new
                    {
                        id = secondTicketId,
                        orderId,
                        stationId = secondStationId,
                        status = "pending",
                        priority = 0,
                        rush = false,
                        servedAt = (string?)null,
                    },
                },
                items = new object[]
                {
                    new
                    {
                        ticketId = firstTicketId,
                        productId = ProductId,
                        item = new { id = firstItemId, productId = ProductId, productName = "Prato piloto" },
                        kds = new { status = "queued", quantity = 1, readyQuantity = 0, held = false },
                    },
                    new
                    {
                        ticketId = secondTicketId,
                        productId = ProductId,
                        item = new { id = secondItemId, productId = ProductId, productName = "Prato piloto" },
                        kds = new { status = "queued", quantity = 2, readyQuantity = 0, held = false },
                    },
                },
                metrics = new { },
                allDay = Array.Empty<object>(),
            }),
        };
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(snapshot);
        var orderPriority = Command(
            "33000000-0000-4000-8000-000000000008",
            "pos.kds.order_priority_requested",
            "set-kds-order-priority",
            new { orderId, priority = 80, reason = "Pedido inteiro urgente" });
        var canonicalCloudOnly = await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.AcceptCommandAsync(orderPriority));
        Assert.Equal("OFFLINE_ACTION_CLOUD_ONLY", canonicalCloudOnly.Code);
        var kdsOnlySnapshot = snapshot with
        {
            Approvals = Element(new
            {
                validUntil = DateTimeOffset.UtcNow.AddHours(1),
                actors = new[] { new { identityId = ActorId, roles = new[] { "kds" } } },
                managers = Array.Empty<object>(),
            }),
        };
        var legacyPriority = Command(
            "33000000-0000-4000-8000-000000000010",
            "pos.kds.priority_requested",
            "set-kds-priority",
            new { ticketId = firstTicketId, priority = 80, reason = "Pedido inteiro urgente" });
        await store.SaveOperationalSnapshotAsync(kdsOnlySnapshot);
        var terminalProfileRequired = await Assert.ThrowsAsync<OperationalConflictException>(() =>
            store.AcceptCommandAsync(legacyPriority));
        Assert.Equal("OFFLINE_ACTOR_AUTHORIZATION_DENIED", terminalProfileRequired.Code);
        await store.SaveOperationalSnapshotAsync(snapshot);

        Assert.True((await store.AcceptCommandAsync(legacyPriority)).Inserted);
        Assert.False((await store.AcceptCommandAsync(legacyPriority)).Inserted);
        var prioritized = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(prioritized);
        Assert.All(
            prioritized!.Kds.GetProperty("tickets").EnumerateArray(),
            ticket =>
            {
                Assert.Equal(80, ticket.GetProperty("priority").GetInt32());
                Assert.True(ticket.GetProperty("rush").GetBoolean());
            });
        Assert.Equal(
            80,
            prioritized.TabDetails.GetProperty(tabId).GetProperty("orders")[0]
                .GetProperty("kdsPriority").GetInt32());
        Assert.All(
            prioritized.Kds.GetProperty("stations").EnumerateArray(),
            station =>
            {
                var capacity = station.GetProperty("capacity");
                Assert.Equal(1, capacity.GetProperty("activeAssignments").GetInt32());
                Assert.Equal("strained", capacity.GetProperty("recommendation")
                    .GetProperty("state").GetString());
            });

        var legacy = await store.AcceptCommandAsync(Command(
            "33000000-0000-4000-8000-000000000009",
            "pos.kds.priority_requested",
            "set-kds-priority",
            new { ticketId = firstTicketId, priority = 0, reason = "Pedido normalizado" }));
        Assert.Equal(firstTicketId, legacy.Result!.Value.GetProperty("ticketId").GetString());
        var normalized = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(normalized);
        Assert.All(
            normalized!.Kds.GetProperty("tickets").EnumerateArray(),
            ticket => Assert.Equal(0, ticket.GetProperty("priority").GetInt32()));
    }

    [Fact]
    public async Task ReactivatesAnExpiredAvailabilityWindowBeforeAcceptingOfflineOrders()
    {
        var baseline = Snapshot();
        var expiredResetAt = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O");
        var catalog = JsonNode.Parse(baseline.Catalog.GetRawText())!.AsObject();
        var catalogAvailability = catalog["availability"]!.AsArray()[0]!.AsObject();
        catalogAvailability["available"] = false;
        catalogAvailability["operationalReason"] = "Pausa programada";
        catalogAvailability["operationalResetAt"] = expiredResetAt;
        var kds = JsonNode.Parse(baseline.Kds.GetRawText())!.AsObject();
        kds["productAvailability"] = new JsonArray
        {
            new JsonObject
            {
                ["productId"] = ProductId,
                ["productName"] = "Prato piloto",
                ["status"] = "unavailable",
                ["available"] = false,
                ["dailyStock"] = null,
                ["soldToday"] = 0,
                ["remainingQuantity"] = null,
                ["reason"] = "Pausa programada",
                ["resetAt"] = expiredResetAt,
            },
        };
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(baseline with
        {
            Catalog = Element(catalog),
            Kds = Element(kds),
        });
        var open = Command(
            "34000000-0000-4000-8000-000000000001",
            "pos.tab.open_requested",
            "open-tab",
            new { body = new { tableId = TableId, guestCount = 1 } });
        await store.AcceptCommandAsync(open);

        await store.AcceptCommandAsync(Command(
            "34000000-0000-4000-8000-000000000002",
            "pos.order.create_requested",
            "create-order",
            new
            {
                tabId = open.Id,
                body = new
                {
                    items = new[]
                    {
                        new
                        {
                            productId = ProductId,
                            quantity = 1,
                            course = "main",
                            modifierOptionIds = Array.Empty<string>(),
                        },
                    },
                },
            }));

        var snapshot = await store.GetOperationalSnapshotAsync(OrganizationId, UnitId);
        Assert.NotNull(snapshot);
        var projectedCatalogAvailability = snapshot!.Catalog.GetProperty("availability")[0];
        Assert.True(projectedCatalogAvailability.GetProperty("available").GetBoolean());
        Assert.Equal(JsonValueKind.Null, projectedCatalogAvailability.GetProperty("operationalResetAt").ValueKind);
        var projectedKdsAvailability = snapshot.Kds.GetProperty("productAvailability")[0];
        Assert.True(projectedKdsAvailability.GetProperty("available").GetBoolean());
        Assert.Equal("available", projectedKdsAvailability.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, projectedKdsAvailability.GetProperty("reason").ValueKind);
        Assert.Equal(JsonValueKind.Null, projectedKdsAvailability.GetProperty("resetAt").ValueKind);
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
    public void EnforcesTheTwelveHourOfflineAuthorizationLeaseBoundary()
    {
        var capturedAt = DateTimeOffset.UtcNow;
        var snapshot = Snapshot(leaseExpiresAt: capturedAt.AddHours(12));

        snapshot.RequireActorRole(ActorId, ["kds"], capturedAt.AddHours(11).AddMinutes(59));
        var expired = Assert.Throws<OperationalConflictException>(() =>
            snapshot.RequireActorRole(ActorId, ["kds"], capturedAt.AddHours(12).AddMinutes(1)));

        Assert.Equal("OFFLINE_ACTOR_AUTHORIZATION_EXPIRED", expired.Code);
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

        var cleaning = Command(
            "10000000-0000-4000-8000-000000000020",
            "pos.table.turnover_requested",
            "table-turnover",
            new { tableId = TableId, status = "cleaning" });
        await store.AcceptCommandAsync(cleaning);
        var available = Command(
            "10000000-0000-4000-8000-000000000021",
            "pos.table.turnover_requested",
            "table-turnover",
            new { tableId = TableId, status = "available" });
        await store.AcceptCommandAsync(available);

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
        Assert.Equal(12, (await store.GetPendingAsync(20)).Count);
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

    [Fact]
    public async Task ScopesBatchesAndNewMetricsToTheRequestedStation()
    {
        const string secondStationId = "77777777-7777-4777-8777-777777777779";
        const string firstTicketId = "81000000-0000-4000-8000-000000000001";
        const string secondTicketId = "81000000-0000-4000-8000-000000000002";
        const string firstBatchId = "81000000-0000-4000-8000-000000000003";
        const string secondBatchId = "81000000-0000-4000-8000-000000000004";
        var now = DateTimeOffset.UtcNow.ToString("O");
        var expiredResetAt = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O");
        var snapshot = Snapshot() with
        {
            Kds = Element(new
            {
                stations = new[]
                {
                    new
                    {
                        id = StationId,
                        name = "Quente",
                        capacity = new
                        {
                            activeAssignments = 1,
                            recommendation = new
                            {
                                state = "strained",
                                suggestedDelayMinutes = 8,
                                reasons = new[] { "queue_depth" },
                            },
                        },
                    },
                    new
                    {
                        id = secondStationId,
                        name = "Bar",
                        capacity = new
                        {
                            activeAssignments = 1,
                            recommendation = new
                            {
                                state = "normal",
                                suggestedDelayMinutes = 0,
                                reasons = Array.Empty<string>(),
                            },
                        },
                    },
                },
                tickets = new object[]
                {
                    new
                    {
                        id = firstTicketId,
                        stationId = StationId,
                        status = "done",
                        rush = true,
                        handedOffAt = now,
                        servedAt = (string?)null,
                        sla = new { isOverdue = false },
                    },
                    new
                    {
                        id = secondTicketId,
                        stationId = secondStationId,
                        status = "ready",
                        rush = false,
                        handedOffAt = (string?)null,
                        servedAt = (string?)null,
                        sla = new { isOverdue = true },
                    },
                },
                items = new object[]
                {
                    new
                    {
                        ticketId = firstTicketId,
                        kds = new { blocked = new { active = true } },
                    },
                    new
                    {
                        ticketId = secondTicketId,
                        kds = new { blocked = new { active = false } },
                    },
                },
                metrics = new
                {
                    total = 2,
                    pending = 0,
                    preparing = 0,
                    ready = 1,
                    expedition = 1,
                    overdue = 1,
                    rush = 1,
                    blockedItems = 1,
                },
                allDay = new[]
                {
                    new { stationId = StationId, productId = ProductId },
                    new { stationId = secondStationId, productId = ProductId },
                },
                batches = new[]
                {
                    new { batchId = firstBatchId, stationId = StationId },
                    new { batchId = secondBatchId, stationId = secondStationId },
                },
                productAvailability = new[]
                {
                    new
                    {
                        productId = ProductId,
                        productName = "Prato piloto",
                        status = "unavailable",
                        available = false,
                        dailyStock = 5,
                        soldToday = 2,
                        remainingQuantity = 3,
                        reason = "Pausa programada",
                        resetAt = expiredResetAt,
                    },
                },
            }),
        };
        var store = CreateStore();
        await store.InitializeAsync();
        await store.SaveOperationalSnapshotAsync(snapshot);

        var envelope = await store.GetKdsOperationalEnvelopeAsync(StationId);

        Assert.NotNull(envelope);
        Assert.Equal(firstTicketId, Assert.Single(envelope!.Data.GetProperty("tickets").EnumerateArray())
            .GetProperty("id").GetString());
        Assert.Single(envelope.Data.GetProperty("items").EnumerateArray());
        Assert.Single(envelope.Data.GetProperty("stations").EnumerateArray());
        Assert.Single(envelope.Data.GetProperty("allDay").EnumerateArray());
        Assert.Equal(firstBatchId, Assert.Single(envelope.Data.GetProperty("batches").EnumerateArray())
            .GetProperty("batchId").GetString());
        var capacity = Assert.Single(envelope.Data.GetProperty("stations").EnumerateArray())
            .GetProperty("capacity");
        Assert.Equal("strained", capacity.GetProperty("recommendation").GetProperty("state").GetString());
        var availability = Assert.Single(envelope.Data.GetProperty("productAvailability").EnumerateArray());
        Assert.True(availability.GetProperty("available").GetBoolean());
        Assert.Equal("limited", availability.GetProperty("status").GetString());
        Assert.Equal(3, availability.GetProperty("remainingQuantity").GetInt32());
        Assert.Equal(JsonValueKind.Null, availability.GetProperty("reason").ValueKind);
        Assert.Equal(JsonValueKind.Null, availability.GetProperty("resetAt").ValueKind);
        var metrics = envelope.Data.GetProperty("metrics");
        Assert.Equal(1, metrics.GetProperty("total").GetInt32());
        Assert.Equal(1, metrics.GetProperty("expedition").GetInt32());
        Assert.Equal(1, metrics.GetProperty("blockedItems").GetInt32());
        Assert.Equal("station", metrics.GetProperty("scope").GetString());
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

    private static OperationalSnapshot Snapshot(
        bool withApprovals = false,
        DateTimeOffset? leaseExpiresAt = null,
        string firstTableStatus = "available") => new(
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
                new { id = TableId, status = firstTableStatus, active = true },
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
            validUntil = leaseExpiresAt ?? DateTimeOffset.UtcNow.AddHours(1),
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
