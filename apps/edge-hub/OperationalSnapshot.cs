using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Isopoh.Cryptography.Argon2;

namespace GiroMesa.EdgeHub;

public sealed record OperationalSnapshot(
    string OrganizationId,
    string UnitId,
    DateTimeOffset CapturedAt,
    JsonElement Catalog,
    JsonElement Floor,
    JsonElement Tabs,
    JsonElement TabDetails,
    JsonElement Kds,
    JsonElement? Approvals = null)
{
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public void Validate()
    {
        if (!Guid.TryParse(OrganizationId, out _) || !Guid.TryParse(UnitId, out _) || CapturedAt == default ||
            Catalog.ValueKind != JsonValueKind.Object || Floor.ValueKind != JsonValueKind.Object ||
            Tabs.ValueKind != JsonValueKind.Array || TabDetails.ValueKind != JsonValueKind.Object ||
            Kds.ValueKind != JsonValueKind.Object ||
            (Approvals is not null && Approvals.Value.ValueKind != JsonValueKind.Object))
        {
            throw new InvalidOperationException("INVALID_OPERATIONAL_SNAPSHOT");
        }
    }

    public void RequireActorRole(
        string actorId,
        IReadOnlyCollection<string> allowedRoles,
        DateTimeOffset authorizationAt)
    {
        Validate();
        if (!Guid.TryParse(actorId, out _) || allowedRoles.Count == 0 || Approvals is null)
            throw new OperationalConflictException("OFFLINE_ACTOR_AUTHORIZATION_UNAVAILABLE");
        var approvals = Approvals.Value;
        if (!approvals.TryGetProperty("validUntil", out var validUntilValue) ||
            validUntilValue.ValueKind != JsonValueKind.String ||
            !DateTimeOffset.TryParse(validUntilValue.GetString(), out var validUntil))
            throw new OperationalConflictException("OFFLINE_ACTOR_AUTHORIZATION_UNAVAILABLE");
        if (validUntil <= authorizationAt)
            throw new OperationalConflictException("OFFLINE_ACTOR_AUTHORIZATION_EXPIRED");
        if (!approvals.TryGetProperty("actors", out var actors) || actors.ValueKind != JsonValueKind.Array)
            throw new OperationalConflictException("OFFLINE_ACTOR_AUTHORIZATION_UNAVAILABLE");
        foreach (var actor in actors.EnumerateArray())
        {
            if (actor.ValueKind != JsonValueKind.Object ||
                !actor.TryGetProperty("identityId", out var identity) ||
                identity.GetString() != actorId ||
                !actor.TryGetProperty("roles", out var roles) ||
                roles.ValueKind != JsonValueKind.Array)
                continue;
            if (roles.EnumerateArray().Any(role =>
                    role.ValueKind == JsonValueKind.String &&
                    allowedRoles.Contains(role.GetString() ?? string.Empty, StringComparer.Ordinal)))
                return;
            throw new OperationalConflictException("OFFLINE_ACTOR_AUTHORIZATION_DENIED");
        }
        throw new OperationalConflictException("OFFLINE_ACTOR_AUTHORIZATION_DENIED");
    }

    internal string Serialize()
    {
        Validate();
        return JsonSerializer.Serialize(this, JsonOptions);
    }

    internal static OperationalSnapshot Deserialize(string json)
    {
        var snapshot = JsonSerializer.Deserialize<OperationalSnapshot>(json, JsonOptions)
            ?? throw new InvalidOperationException("INVALID_OPERATIONAL_SNAPSHOT");
        snapshot.Validate();
        return snapshot;
    }
}

public sealed class OperationalConflictException(string code) : InvalidOperationException(code)
{
    public string Code { get; } = code;
}

internal sealed record OperationalProjectionResult(OperationalSnapshot Snapshot, JsonElement Result);

internal static class OperationalProjection
{
    private static readonly IReadOnlyDictionary<string, string> EventTypeByAction =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["open-tab"] = "pos.tab.open_requested",
            ["create-order"] = "pos.order.create_requested",
            ["send-order"] = "pos.order.send_requested",
            ["transition-kds"] = "pos.kds.transition_requested",
            ["transfer-tab"] = "pos.tab.transfer_requested",
            ["merge-tabs"] = "pos.tabs.merge_requested",
            ["split-tab"] = "pos.tab.split_requested",
            ["service-charge"] = "pos.tab.service_charge_requested",
            ["tip"] = "pos.tab.tip_requested",
            ["discount-item"] = "pos.item.discount_requested",
            ["cancel-item"] = "pos.item.cancel_requested",
        };
    private static readonly IReadOnlyDictionary<string, string[]> RolesByAction =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["open-tab"] = ["owner", "manager", "waiter", "cashier"],
            ["create-order"] = ["owner", "manager", "waiter", "cashier"],
            ["send-order"] = ["owner", "manager", "waiter", "cashier"],
            ["transfer-tab"] = ["owner", "manager", "waiter", "cashier"],
            ["merge-tabs"] = ["owner", "manager", "cashier"],
            ["split-tab"] = ["owner", "manager", "cashier"],
            ["service-charge"] = ["owner", "manager", "cashier"],
            ["tip"] = ["owner", "manager", "cashier"],
            ["discount-item"] = ["owner", "manager", "waiter", "cashier"],
            ["cancel-item"] = ["owner", "manager", "waiter", "cashier"],
            ["transition-kds"] = ["owner", "manager", "kds"],
        };

    public static bool IsPilotMutation(JsonElement payload) =>
        payload.ValueKind == JsonValueKind.Object &&
        payload.TryGetProperty("kind", out var kind) &&
        kind.ValueKind == JsonValueKind.String &&
        kind.GetString() == "pilot.mutation";

    public static OperationalProjectionResult Apply(
        OperationalSnapshot snapshot,
        OperationalCommand command,
        DateTimeOffset acceptedAt)
    {
        snapshot.Validate();
        if (snapshot.OrganizationId != command.OrganizationId || snapshot.UnitId != command.UnitId)
        {
            throw Conflict("SCOPE_MISMATCH");
        }

        var root = JsonNode.Parse(snapshot.Serialize())?.AsObject()
            ?? throw Conflict("INVALID_OPERATIONAL_SNAPSHOT");
        var envelope = ParseObject(command.Payload.GetRawText(), "INVALID_OFFLINE_PAYLOAD");
        if (ReadString(envelope, "kind") != "pilot.mutation")
        {
            throw Conflict("INVALID_OFFLINE_PAYLOAD");
        }
        var action = ReadString(envelope, "action");
        if (!EventTypeByAction.TryGetValue(action, out var expectedType))
        {
            throw Conflict("OFFLINE_ACTION_UNSUPPORTED");
        }
        if (command.Type != expectedType) throw Conflict("EVENT_TYPE_MISMATCH");
        snapshot.RequireActorRole(command.ActorId, RolesByAction[action], acceptedAt);
        var data = RequireObject(envelope, "data");
        var now = acceptedAt.ToString("O");

        var result = action switch
        {
            "open-tab" => OpenTab(root, command, data, now),
            "create-order" => CreateOrder(root, command, data, now),
            "send-order" => SendOrder(root, command, data, now),
            "transition-kds" => TransitionKds(root, command, data, now),
            "transfer-tab" => TransferTab(root, data, now),
            "merge-tabs" => MergeTabs(root, data, now),
            "split-tab" => SplitTab(root, command, data, now),
            "service-charge" => SetServiceCharge(root, data, now),
            "tip" => SetTip(root, data, now),
            "discount-item" => DiscountItem(root, command, data, acceptedAt, now),
            "cancel-item" => CancelItem(root, command, data, acceptedAt, now),
            _ => throw Conflict("OFFLINE_ACTION_UNSUPPORTED"),
        };

        root["capturedAt"] = acceptedAt > snapshot.CapturedAt ? acceptedAt : snapshot.CapturedAt;
        var projected = OperationalSnapshot.Deserialize(root.ToJsonString(OperationalSnapshot.JsonOptions));
        return new(projected, ParseElement(result));
    }

    public static string StableId(string commandId, string kind, string suffix)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{commandId}|{kind}|{suffix}"))[..16];
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        var hex = Convert.ToHexStringLower(bytes);
        return $"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..]}";
    }

    private static JsonObject OpenTab(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var body = RequireObject(data, "body");
        var tableId = ReadOptionalString(body, "tableId");
        var label = ReadOptionalString(body, "label");
        var guestCount = ReadInt(body, "guestCount", 1, 500);
        var floor = RequireObject(root, "floor");
        var tables = RequireArray(floor, "tables");
        var openTabs = RequireArray(floor, "openTabs");
        if (tableId is not null)
        {
            var table = FindById(tables, tableId) ?? throw Conflict("TABLE_NOT_FOUND");
            if (ReadOptionalBoolean(table, "active") == false) throw Conflict("TABLE_NOT_FOUND");
            if (ReadString(table, "status") != "available" ||
                openTabs.Any(node => node is JsonObject tab && ReadOptionalString(tab, "tableId") == tableId))
            {
                throw Conflict("TABLE_OCCUPIED");
            }
            table["status"] = "occupied";
            table["updatedAt"] = now;
        }

        var tab = new JsonObject
        {
            ["id"] = command.Id,
            ["organizationId"] = command.OrganizationId,
            ["unitId"] = command.UnitId,
            ["tableId"] = tableId,
            ["openedByIdentityId"] = command.ActorId,
            ["label"] = label,
            ["guestCount"] = guestCount,
            ["status"] = "open",
            ["mergedIntoTabId"] = null,
            ["serviceChargeBasisPoints"] = 0,
            ["tipCents"] = 0,
            ["subtotalCents"] = 0,
            ["discountCents"] = 0,
            ["serviceChargeCents"] = 0,
            ["totalCents"] = 0,
            ["closedAt"] = null,
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };
        RequireArray(root, "tabs").Add(tab.DeepClone());
        openTabs.Add(tab.DeepClone());
        RequireObject(root, "tabDetails")[command.Id] = new JsonObject
        {
            ["tab"] = tab.DeepClone(),
            ["orders"] = new JsonArray(),
            ["items"] = new JsonArray(),
            ["modifiers"] = new JsonArray(),
        };
        return new JsonObject { ["tab"] = tab.DeepClone() };
    }

    private static JsonObject CreateOrder(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var tabId = ReadString(data, "tabId");
        var detail = GetTabDetail(root, tabId);
        var tab = RequireObject(detail, "tab");
        if (ReadString(tab, "status") != "open") throw Conflict("TAB_NOT_OPEN");
        var body = RequireObject(data, "body");
        var requestedItems = RequireArray(body, "items");
        if (requestedItems.Count is < 1 or > 500) throw Conflict("INVALID_ORDER_ITEMS");

        var catalog = RequireObject(root, "catalog");
        var products = RequireArray(catalog, "products");
        var prices = RequireArray(catalog, "prices");
        var availability = RequireArray(catalog, "availability");
        var productStations = RequireArray(catalog, "productStations");
        var productGroups = RequireArray(catalog, "productModifierGroups");
        var groups = RequireArray(catalog, "modifierGroups");
        var options = RequireArray(catalog, "modifierOptions");
        var createdItems = new JsonArray();
        var createdModifiers = new JsonArray();

        for (var index = 0; index < requestedItems.Count; index++)
        {
            var requested = requestedItems[index] as JsonObject ?? throw Conflict("INVALID_ORDER_ITEMS");
            var productId = ReadString(requested, "productId");
            var quantity = ReadInt(requested, "quantity", 1, 500);
            var product = FindById(products, productId) ?? throw Conflict("PRODUCT_UNAVAILABLE");
            if (ReadOptionalBoolean(product, "active") == false) throw Conflict("PRODUCT_UNAVAILABLE");
            var availabilityRow = FindBy(availability, "productId", productId);
            if (availabilityRow is null || ReadOptionalBoolean(availabilityRow, "available") != true)
            {
                throw Conflict("PRODUCT_UNAVAILABLE");
            }
            var price = FindBy(prices, "productId", productId)
                ?? throw Conflict("PRODUCT_PRICE_NOT_CONFIGURED");
            var unitPriceCents = ReadLong(price, "priceCents", 0);
            var station = FindBy(productStations, "productId", productId)
                ?? throw Conflict("PRODUCT_WITHOUT_STATION");
            var stationId = ReadString(station, "stationId");
            var optionIds = ReadStringArray(requested, "modifierOptionIds");
            if (optionIds.Count != optionIds.Distinct(StringComparer.Ordinal).Count())
            {
                throw Conflict("INVALID_MODIFIER_SELECTION");
            }

            var linkedGroupIds = productGroups
                .OfType<JsonObject>()
                .Where(link => ReadOptionalString(link, "productId") == productId)
                .Select(link => ReadString(link, "groupId"))
                .ToHashSet(StringComparer.Ordinal);
            var selectedOptions = optionIds.Select(optionId =>
            {
                var option = FindById(options, optionId) ?? throw Conflict("INVALID_MODIFIER_SELECTION");
                if (ReadOptionalBoolean(option, "active") == false ||
                    !linkedGroupIds.Contains(ReadString(option, "groupId")))
                {
                    throw Conflict("INVALID_MODIFIER_SELECTION");
                }
                return option;
            }).ToArray();
            foreach (var groupId in linkedGroupIds)
            {
                var group = FindById(groups, groupId) ?? throw Conflict("INVALID_MODIFIER_SELECTION");
                if (ReadOptionalBoolean(group, "active") == false) continue;
                var count = selectedOptions.Count(option => ReadString(option, "groupId") == groupId);
                var minimum = ReadInt(group, "minimumSelections", 0, 50);
                var maximum = ReadInt(group, "maximumSelections", 1, 50);
                if (count < minimum || count > maximum) throw Conflict("MODIFIER_SELECTION_RANGE");
            }

            var modifierPerUnitCents = selectedOptions.Sum(option => ReadLong(option, "priceDeltaCents", 0));
            long grossCents;
            try
            {
                grossCents = checked(quantity * checked(unitPriceCents + modifierPerUnitCents));
            }
            catch (OverflowException)
            {
                throw Conflict("MONEY_OVERFLOW");
            }
            var itemId = StableId(command.Id, "order-item", index.ToString());
            var item = new JsonObject
            {
                ["id"] = itemId,
                ["organizationId"] = command.OrganizationId,
                ["unitId"] = command.UnitId,
                ["orderId"] = command.Id,
                ["productId"] = productId,
                ["stationId"] = stationId,
                ["productName"] = ReadString(product, "name"),
                ["quantity"] = quantity,
                ["unitPriceCents"] = unitPriceCents,
                ["modifiersCents"] = modifierPerUnitCents * quantity,
                ["grossCents"] = grossCents,
                ["discountCents"] = 0,
                ["netCents"] = grossCents,
                ["status"] = "draft",
                ["notes"] = ReadOptionalString(requested, "notes"),
                ["canceledAt"] = null,
                ["canceledReason"] = null,
                ["createdAt"] = now,
                ["updatedAt"] = now,
            };
            createdItems.Add(item);
            foreach (var option in selectedOptions)
            {
                var delta = ReadLong(option, "priceDeltaCents", 0);
                createdModifiers.Add(new JsonObject
                {
                    ["id"] = StableId(command.Id, "order-modifier", $"{itemId}:{ReadString(option, "id")}"),
                    ["organizationId"] = command.OrganizationId,
                    ["unitId"] = command.UnitId,
                    ["orderItemId"] = itemId,
                    ["optionId"] = ReadString(option, "id"),
                    ["name"] = ReadString(option, "name"),
                    ["quantity"] = 1,
                    ["unitDeltaCents"] = delta,
                    ["totalDeltaCents"] = delta * quantity,
                });
            }
        }

        var order = new JsonObject
        {
            ["id"] = command.Id,
            ["organizationId"] = command.OrganizationId,
            ["unitId"] = command.UnitId,
            ["tabId"] = tabId,
            ["createdByIdentityId"] = command.ActorId,
            ["status"] = "draft",
            ["sentAt"] = null,
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };
        RequireArray(detail, "orders").Add(order.DeepClone());
        var detailItems = RequireArray(detail, "items");
        foreach (var item in createdItems) detailItems.Add(item?.DeepClone());
        var detailModifiers = RequireArray(detail, "modifiers");
        foreach (var modifier in createdModifiers) detailModifiers.Add(modifier?.DeepClone());
        var totals = RecalculateTab(root, tabId, now);
        return new JsonObject
        {
            ["order"] = order,
            ["items"] = createdItems,
            ["totals"] = totals,
        };
    }

    private static JsonObject SendOrder(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var orderId = ReadString(data, "orderId");
        var (detail, order) = FindOrder(root, orderId);
        if (ReadString(order, "status") != "draft") throw Conflict("ORDER_NOT_DRAFT");
        var items = RequireArray(detail, "items")
            .OfType<JsonObject>()
            .Where(item => ReadOptionalString(item, "orderId") == orderId && ReadString(item, "status") == "draft")
            .ToArray();
        if (items.Length == 0) throw Conflict("ORDER_EMPTY");
        if (items.Any(item => string.IsNullOrWhiteSpace(ReadOptionalString(item, "stationId"))))
        {
            throw Conflict("PRODUCT_WITHOUT_STATION");
        }

        order["status"] = "sent";
        order["sentAt"] = now;
        order["updatedAt"] = now;
        foreach (var item in items)
        {
            item["status"] = "queued";
            item["updatedAt"] = now;
        }
        var kds = RequireObject(root, "kds");
        var tickets = RequireArray(kds, "tickets");
        var kdsItems = RequireArray(kds, "items");
        var ticketIds = new JsonArray();
        foreach (var stationId in items.Select(item => ReadString(item, "stationId")).Distinct(StringComparer.Ordinal))
        {
            var ticketId = StableId(command.Id, "kds-ticket", stationId);
            if (FindById(tickets, ticketId) is not null) throw Conflict("KDS_TICKET_CONFLICT");
            var ticket = new JsonObject
            {
                ["id"] = ticketId,
                ["organizationId"] = command.OrganizationId,
                ["unitId"] = command.UnitId,
                ["orderId"] = orderId,
                ["stationId"] = stationId,
                ["status"] = "pending",
                ["startedAt"] = null,
                ["readyAt"] = null,
                ["completedAt"] = null,
                ["createdAt"] = now,
                ["updatedAt"] = now,
            };
            tickets.Add(ticket);
            ticketIds.Add(ticketId);
            foreach (var item in items.Where(item => ReadString(item, "stationId") == stationId))
            {
                kdsItems.Add(new JsonObject
                {
                    ["ticketId"] = ticketId,
                    ["item"] = item.DeepClone(),
                });
            }
        }
        return new JsonObject
        {
            ["orderId"] = orderId,
            ["status"] = "sent",
            ["ticketIds"] = ticketIds,
        };
    }

    private static JsonObject TransferTab(JsonObject root, JsonObject data, string now)
    {
        var tabId = ReadString(data, "tabId");
        var body = RequireObject(data, "body");
        var destinationId = ReadString(body, "tableId");
        var reason = ReadString(body, "reason");
        if (reason.Length is < 3 or > 500) throw Conflict("INVALID_TRANSFER_REASON");
        var detail = GetTabDetail(root, tabId);
        var tab = RequireObject(detail, "tab");
        if (ReadString(tab, "status") != "open") throw Conflict("TAB_NOT_OPEN");
        var previousTableId = ReadOptionalString(tab, "tableId");
        var tables = RequireArray(RequireObject(root, "floor"), "tables");
        var destination = FindById(tables, destinationId) ?? throw Conflict("TABLE_NOT_FOUND");
        if (ReadOptionalBoolean(destination, "active") == false) throw Conflict("TABLE_NOT_FOUND");
        var occupied = RequireArray(RequireObject(root, "floor"), "openTabs")
            .OfType<JsonObject>()
            .FirstOrDefault(candidate =>
                ReadOptionalString(candidate, "tableId") == destinationId &&
                ReadOptionalString(candidate, "id") != tabId);
        if (occupied is not null) throw Conflict("TABLE_OCCUPIED");

        if (previousTableId is not null && previousTableId != destinationId)
        {
            SetTableStatus(tables, previousTableId, "available", now);
        }
        SetTableStatus(tables, destinationId, "occupied", now);
        tab["tableId"] = destinationId;
        tab["updatedAt"] = now;
        SyncTab(root, tabId);
        return new JsonObject { ["tabId"] = tabId, ["tableId"] = destinationId };
    }

    private static JsonObject MergeTabs(JsonObject root, JsonObject data, string now)
    {
        var body = RequireObject(data, "body");
        var targetTabId = ReadString(body, "targetTabId");
        var sourceTabIds = ReadStringArray(body, "sourceTabIds").Distinct(StringComparer.Ordinal).ToArray();
        if (sourceTabIds.Length is < 1 or > 50) throw Conflict("SOURCE_TAB_NOT_FOUND");
        if (sourceTabIds.Contains(targetTabId, StringComparer.Ordinal))
        {
            throw Conflict("MERGE_TARGET_IS_SOURCE");
        }
        var target = GetTabDetail(root, targetTabId);
        if (ReadString(RequireObject(target, "tab"), "status") != "open") throw Conflict("TAB_NOT_OPEN");
        var targetOrders = RequireArray(target, "orders");
        var targetItems = RequireArray(target, "items");
        var targetModifiers = RequireArray(target, "modifiers");
        var targetTableId = ReadOptionalString(RequireObject(target, "tab"), "tableId");
        var tables = RequireArray(RequireObject(root, "floor"), "tables");

        foreach (var sourceTabId in sourceTabIds)
        {
            var source = GetTabDetailOrNull(root, sourceTabId)
                ?? throw Conflict("SOURCE_TAB_NOT_FOUND");
            var sourceTab = RequireObject(source, "tab");
            if (ReadString(sourceTab, "status") != "open") throw Conflict("SOURCE_TAB_NOT_FOUND");
            foreach (var order in RequireArray(source, "orders").OfType<JsonObject>())
            {
                order["tabId"] = targetTabId;
                order["updatedAt"] = now;
                targetOrders.Add(order.DeepClone());
            }
            foreach (var item in RequireArray(source, "items")) targetItems.Add(item?.DeepClone());
            foreach (var modifier in RequireArray(source, "modifiers")) targetModifiers.Add(modifier?.DeepClone());
            RequireArray(source, "orders").Clear();
            RequireArray(source, "items").Clear();
            RequireArray(source, "modifiers").Clear();
            sourceTab["status"] = "merged";
            sourceTab["mergedIntoTabId"] = targetTabId;
            sourceTab["updatedAt"] = now;
            ReplaceById(RequireArray(root, "tabs"), sourceTabId, sourceTab);
            RemoveById(RequireArray(RequireObject(root, "floor"), "openTabs"), sourceTabId);
            var sourceTableId = ReadOptionalString(sourceTab, "tableId");
            if (sourceTableId is not null && sourceTableId != targetTableId)
            {
                SetTableStatus(tables, sourceTableId, "available", now);
            }
        }
        var totals = RecalculateTab(root, targetTabId, now);
        return new JsonObject
        {
            ["targetTabId"] = targetTabId,
            ["sourceTabIds"] = JsonSerializer.SerializeToNode(sourceTabIds),
            ["totals"] = totals,
        };
    }

    private static JsonObject SplitTab(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var sourceTabId = ReadString(data, "tabId");
        var body = RequireObject(data, "body");
        var requestedItems = RequireArray(body, "items");
        if (requestedItems.Count is < 1 or > 500) throw Conflict("INVALID_SPLIT_QUANTITY");
        var requestedIds = requestedItems.OfType<JsonObject>()
            .Select(item => ReadString(item, "orderItemId"))
            .ToArray();
        if (requestedIds.Length != requestedItems.Count) throw Conflict("INVALID_SPLIT_QUANTITY");
        if (requestedIds.Distinct(StringComparer.Ordinal).Count() != requestedIds.Length)
        {
            throw Conflict("DUPLICATE_SPLIT_ITEM");
        }
        var source = GetTabDetail(root, sourceTabId);
        var sourceTab = RequireObject(source, "tab");
        if (ReadString(sourceTab, "status") != "open") throw Conflict("TAB_NOT_OPEN");
        if (GetTabDetailOrNull(root, command.Id) is not null) throw Conflict("ENTITY_ID_CONFLICT");
        var tableId = ReadOptionalString(body, "tableId");
        var tables = RequireArray(RequireObject(root, "floor"), "tables");
        if (tableId is not null)
        {
            var table = FindById(tables, tableId) ?? throw Conflict("TABLE_NOT_FOUND");
            if (ReadOptionalBoolean(table, "active") == false) throw Conflict("TABLE_NOT_FOUND");
            if (RequireArray(RequireObject(root, "floor"), "openTabs").OfType<JsonObject>()
                .Any(tab => ReadOptionalString(tab, "tableId") == tableId))
            {
                throw Conflict("TABLE_OCCUPIED");
            }
        }
        var sourceItems = RequireArray(source, "items");
        var selected = requestedItems.OfType<JsonObject>().Select(requested =>
        {
            var itemId = ReadString(requested, "orderItemId");
            var item = FindById(sourceItems, itemId) ?? throw Conflict("SPLIT_ITEM_NOT_FOUND");
            if (ReadString(item, "status") == "canceled") throw Conflict("CANCELED_ITEM_CANNOT_SPLIT");
            var quantity = ReadInt(requested, "quantity", 1, 500);
            if (quantity > ReadInt(item, "quantity", 1, 500)) throw Conflict("INVALID_SPLIT_QUANTITY");
            var order = FindById(RequireArray(source, "orders"), ReadString(item, "orderId"))
                ?? throw Conflict("ORDER_NOT_FOUND");
            return (Item: item, Quantity: quantity, OrderStatus: ReadString(order, "status"));
        }).ToArray();
        var targetOrderId = StableId(command.Id, "split-order", "");
        if (FindOrderOrNull(root, targetOrderId) is not null) throw Conflict("ENTITY_ID_CONFLICT");
        var productionHistory = selected.Any(row => row.OrderStatus != "draft");
        var targetTab = new JsonObject
        {
            ["id"] = command.Id,
            ["organizationId"] = command.OrganizationId,
            ["unitId"] = command.UnitId,
            ["tableId"] = tableId,
            ["openedByIdentityId"] = command.ActorId,
            ["label"] = ReadOptionalString(body, "label"),
            ["guestCount"] = 1,
            ["status"] = "open",
            ["mergedIntoTabId"] = null,
            ["serviceChargeBasisPoints"] = ReadLong(sourceTab, "serviceChargeBasisPoints", 0),
            ["tipCents"] = 0,
            ["subtotalCents"] = 0,
            ["discountCents"] = 0,
            ["serviceChargeCents"] = 0,
            ["totalCents"] = 0,
            ["closedAt"] = null,
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };
        var targetOrder = new JsonObject
        {
            ["id"] = targetOrderId,
            ["organizationId"] = command.OrganizationId,
            ["unitId"] = command.UnitId,
            ["tabId"] = command.Id,
            ["createdByIdentityId"] = command.ActorId,
            ["status"] = productionHistory ? "sent" : "draft",
            ["sentAt"] = productionHistory ? now : null,
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };
        var targetItems = new JsonArray();
        var targetModifiers = new JsonArray();
        var sourceModifiers = RequireArray(source, "modifiers");
        var movedItemIds = new JsonArray();
        foreach (var (sourceItem, quantity, _) in selected)
        {
            var sourceItemId = ReadString(sourceItem, "id");
            var sourceQuantity = ReadInt(sourceItem, "quantity", 1, 500);
            JsonObject moved;
            JsonObject kdsProjectionItem;
            if (quantity == sourceQuantity)
            {
                moved = sourceItem.DeepClone().AsObject();
                moved["orderId"] = targetOrderId;
                moved["updatedAt"] = now;
                RemoveById(sourceItems, sourceItemId);
                MoveModifiers(
                    sourceModifiers,
                    targetModifiers,
                    command.Id,
                    sourceItemId,
                    sourceItemId,
                    quantity,
                    sourceQuantity,
                    false);
                kdsProjectionItem = moved;
            }
            else
            {
                var movedGross = Proportional(ReadLong(sourceItem, "grossCents", 0), quantity, sourceQuantity);
                var movedDiscount = Proportional(ReadLong(sourceItem, "discountCents", 0), quantity, sourceQuantity);
                var movedModifier = Proportional(ReadLong(sourceItem, "modifiersCents", 0), quantity, sourceQuantity);
                var movedItemId = StableId(command.Id, "split-item", sourceItemId);
                if (FindItemOrNull(root, movedItemId) is not null) throw Conflict("ENTITY_ID_CONFLICT");
                moved = sourceItem.DeepClone().AsObject();
                moved["id"] = movedItemId;
                moved["orderId"] = targetOrderId;
                moved["quantity"] = quantity;
                moved["grossCents"] = movedGross;
                moved["modifiersCents"] = movedModifier;
                moved["discountCents"] = movedDiscount;
                moved["netCents"] = movedGross - movedDiscount;
                moved["createdAt"] = now;
                moved["updatedAt"] = now;
                sourceItem["quantity"] = sourceQuantity - quantity;
                sourceItem["grossCents"] = ReadLong(sourceItem, "grossCents", 0) - movedGross;
                sourceItem["modifiersCents"] = ReadLong(sourceItem, "modifiersCents", 0) - movedModifier;
                sourceItem["discountCents"] = ReadLong(sourceItem, "discountCents", 0) - movedDiscount;
                sourceItem["netCents"] = ReadLong(sourceItem, "grossCents", 0) - ReadLong(sourceItem, "discountCents", 0);
                sourceItem["updatedAt"] = now;
                MoveModifiers(
                    sourceModifiers,
                    targetModifiers,
                    command.Id,
                    sourceItemId,
                    ReadString(moved, "id"),
                    quantity,
                    sourceQuantity,
                    true);
                kdsProjectionItem = sourceItem;
            }
            targetItems.Add(moved);
            movedItemIds.Add(ReadString(moved, "id"));
            UpdateKdsItem(root, kdsProjectionItem);
        }
        var targetDetail = new JsonObject
        {
            ["tab"] = targetTab.DeepClone(),
            ["orders"] = new JsonArray(targetOrder),
            ["items"] = targetItems,
            ["modifiers"] = targetModifiers,
        };
        RequireObject(root, "tabDetails")[command.Id] = targetDetail;
        RequireArray(root, "tabs").Add(targetTab.DeepClone());
        RequireArray(RequireObject(root, "floor"), "openTabs").Add(targetTab.DeepClone());
        if (tableId is not null) SetTableStatus(tables, tableId, "occupied", now);
        var sourceTotals = RecalculateTab(root, sourceTabId, now);
        var targetTotals = RecalculateTab(root, command.Id, now);
        return new JsonObject
        {
            ["sourceTabId"] = sourceTabId,
            ["targetTabId"] = command.Id,
            ["movedItemIds"] = movedItemIds,
            ["sourceTotals"] = sourceTotals,
            ["targetTotals"] = targetTotals,
        };
    }

    private static JsonObject SetServiceCharge(JsonObject root, JsonObject data, string now)
    {
        var tabId = ReadString(data, "tabId");
        var basisPoints = ReadLong(data, "basisPoints", 0, 10_000, "INVALID_SERVICE_CHARGE");
        var tab = RequireObject(GetTabDetail(root, tabId), "tab");
        if (ReadString(tab, "status") != "open") throw Conflict("TAB_NOT_OPEN");
        tab["serviceChargeBasisPoints"] = basisPoints;
        tab["updatedAt"] = now;
        return new JsonObject { ["tabId"] = tabId, ["totals"] = RecalculateTab(root, tabId, now) };
    }

    private static JsonObject SetTip(JsonObject root, JsonObject data, string now)
    {
        var tabId = ReadString(data, "tabId");
        var tipCents = ReadLong(data, "tipCents", 0, long.MaxValue, "INVALID_TIP");
        var tab = RequireObject(GetTabDetail(root, tabId), "tab");
        if (ReadString(tab, "status") != "open") throw Conflict("TAB_NOT_OPEN");
        tab["tipCents"] = tipCents;
        tab["updatedAt"] = now;
        return new JsonObject { ["tabId"] = tabId, ["totals"] = RecalculateTab(root, tabId, now) };
    }

    private static JsonObject DiscountItem(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        DateTimeOffset approvalAt,
        string now)
    {
        var itemId = ReadString(data, "itemId");
        var body = RequireObject(data, "body");
        var discountCents = ReadLong(body, "discountCents", 0, long.MaxValue, "INVALID_DISCOUNT");
        var approval = RequireObject(body, "approval");
        var (detail, item) = FindItem(root, itemId);
        if (ReadString(item, "status") == "canceled") throw Conflict("ITEM_CANCELED");
        if (discountCents > ReadLong(item, "grossCents", 0)) throw Conflict("DISCOUNT_EXCEEDS_ITEM");
        ValidateManagerApproval(root, approval, approvalAt);
        item["discountCents"] = discountCents;
        item["netCents"] = ReadLong(item, "grossCents", 0) - discountCents;
        item["updatedAt"] = now;
        UpdateKdsItem(root, item);
        var tabId = ReadString(RequireObject(detail, "tab"), "id");
        var totals = RecalculateTab(root, tabId, now);
        var approvalId = StableId(command.Id, "approval", "");
        return new JsonObject
        {
            ["itemId"] = itemId,
            ["discountCents"] = discountCents,
            ["approvalId"] = approvalId,
            ["totals"] = totals,
        };
    }

    private static JsonObject CancelItem(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        DateTimeOffset approvalAt,
        string now)
    {
        var itemId = ReadString(data, "itemId");
        var approval = RequireObject(data, "approval");
        var (detail, item) = FindItem(root, itemId);
        if (ReadString(item, "status") == "canceled") throw Conflict("ITEM_ALREADY_CANCELED");
        ValidateManagerApproval(root, approval, approvalAt);
        item["status"] = "canceled";
        item["discountCents"] = 0;
        item["netCents"] = 0;
        item["canceledAt"] = now;
        item["canceledReason"] = ReadString(approval, "reason");
        item["updatedAt"] = now;
        UpdateKdsItem(root, item);

        var kds = RequireObject(root, "kds");
        var kdsItems = RequireArray(kds, "items");
        var linkedTicketIds = kdsItems.OfType<JsonObject>()
            .Where(row => ReadString(RequireObject(row, "item"), "id") == itemId)
            .Select(row => ReadString(row, "ticketId"))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var tickets = RequireArray(kds, "tickets");
        foreach (var ticketId in linkedTicketIds)
        {
            var ticket = FindById(tickets, ticketId);
            if (ticket is null) continue;
            if (ReadString(ticket, "status") is "done" or "canceled") continue;
            var hasActiveItem = kdsItems.OfType<JsonObject>().Any(row =>
                ReadOptionalString(row, "ticketId") == ticketId &&
                ReadString(RequireObject(row, "item"), "status") != "canceled");
            if (hasActiveItem) continue;
            ticket["status"] = "canceled";
            ticket["completedAt"] = now;
            ticket["updatedAt"] = now;
        }
        var tabId = ReadString(RequireObject(detail, "tab"), "id");
        var totals = RecalculateTab(root, tabId, now);
        var approvalId = StableId(command.Id, "approval", "");
        return new JsonObject
        {
            ["itemId"] = itemId,
            ["status"] = "canceled",
            ["approvalId"] = approvalId,
            ["totals"] = totals,
        };
    }

    private static void ValidateManagerApproval(
        JsonObject root,
        JsonObject approval,
        DateTimeOffset approvalAt)
    {
        var membershipId = ReadString(approval, "approverMembershipId");
        var pin = ReadString(approval, "pin");
        var reason = ReadString(approval, "reason");
        if (!Guid.TryParse(membershipId, out _) || pin.Length is < 4 or > 8 || !pin.All(char.IsDigit) ||
            reason.Length is < 3 or > 500)
        {
            throw Conflict("INVALID_OFFLINE_PAYLOAD");
        }
        var approvals = root["approvals"] as JsonObject
            ?? throw Conflict("OFFLINE_MANAGER_APPROVAL_UNAVAILABLE");
        var validUntilText = ReadOptionalString(approvals, "validUntil");
        if (!DateTimeOffset.TryParse(validUntilText, out var validUntil))
        {
            throw Conflict("OFFLINE_MANAGER_APPROVAL_UNAVAILABLE");
        }
        if (validUntil <= approvalAt) throw Conflict("OFFLINE_MANAGER_APPROVAL_EXPIRED");
        var managers = RequireArray(approvals, "managers");
        var manager = managers.OfType<JsonObject>()
            .FirstOrDefault(candidate => ReadOptionalString(candidate, "membershipId") == membershipId);
        if (manager is null) throw Conflict("OFFLINE_MANAGER_APPROVAL_DENIED");
        var encoded = ReadString(manager, "pinHash");
        try
        {
            if (!Argon2.Verify(encoded, pin)) throw Conflict("OFFLINE_MANAGER_APPROVAL_DENIED");
        }
        catch (OperationalConflictException)
        {
            throw;
        }
        catch
        {
            throw Conflict("OFFLINE_MANAGER_APPROVAL_DENIED");
        }
    }

    private static JsonObject TransitionKds(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var targetState = ReadString(data, "state");
        var allowedStates = new HashSet<string>(["preparing", "ready", "done", "canceled"]);
        if (!allowedStates.Contains(targetState)) throw Conflict("INVALID_KDS_TRANSITION");
        var kds = RequireObject(root, "kds");
        var tickets = RequireArray(kds, "tickets");
        var ticket = FindById(tickets, ticketId) ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        var currentState = ReadString(ticket, "status");
        var transitions = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["pending"] = ["preparing", "canceled"],
            ["preparing"] = ["ready", "canceled"],
            ["ready"] = ["done", "canceled"],
            ["done"] = [],
            ["canceled"] = [],
        };
        if (!transitions.TryGetValue(currentState, out var allowed) || !allowed.Contains(targetState))
        {
            throw Conflict("INVALID_KDS_TRANSITION");
        }
        ticket["status"] = targetState;
        if (targetState == "preparing") ticket["startedAt"] = now;
        if (targetState == "ready") ticket["readyAt"] = now;
        if (targetState is "done" or "canceled") ticket["completedAt"] = now;
        ticket["updatedAt"] = now;

        var itemState = targetState switch
        {
            "preparing" => "preparing",
            "ready" => "ready",
            "done" => "served",
            _ => "canceled",
        };
        var itemIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in RequireArray(kds, "items").OfType<JsonObject>())
        {
            if (ReadOptionalString(row, "ticketId") != ticketId) continue;
            var item = RequireObject(row, "item");
            if (ReadString(item, "status") != "canceled") item["status"] = itemState;
            item["updatedAt"] = now;
            itemIds.Add(ReadString(item, "id"));
        }
        foreach (var detailNode in RequireObject(root, "tabDetails"))
        {
            if (detailNode.Value is not JsonObject detail) continue;
            foreach (var item in RequireArray(detail, "items").OfType<JsonObject>())
            {
                if (!itemIds.Contains(ReadString(item, "id")) || ReadString(item, "status") == "canceled") continue;
                item["status"] = itemState;
                item["updatedAt"] = now;
            }
        }

        var orderId = ReadString(ticket, "orderId");
        var orderStates = tickets.OfType<JsonObject>()
            .Where(candidate => ReadOptionalString(candidate, "orderId") == orderId)
            .Select(candidate => ReadString(candidate, "status"))
            .ToArray();
        var orderStatus = orderStates.All(state => state == "canceled")
            ? "canceled"
            : orderStates.All(state => state is "done" or "canceled")
                ? "served"
                : orderStates.All(state => state is "ready" or "done" or "canceled")
                    ? "ready"
                    : orderStates.Any(state => state == "preparing") ? "preparing" : "sent";
        var (_, order) = FindOrder(root, orderId);
        order["status"] = orderStatus;
        order["updatedAt"] = now;
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["state"] = targetState,
            ["orderId"] = orderId,
            ["orderStatus"] = orderStatus,
        };
    }

    private static JsonObject RecalculateTab(JsonObject root, string tabId, string now)
    {
        var detail = GetTabDetail(root, tabId);
        var tab = RequireObject(detail, "tab");
        var activeItems = RequireArray(detail, "items").OfType<JsonObject>()
            .Where(item => ReadString(item, "status") != "canceled")
            .ToArray();
        var subtotal = activeItems.Sum(item => ReadLong(item, "grossCents", 0));
        var discount = activeItems.Sum(item => ReadLong(item, "discountCents", 0));
        var basisPoints = ReadLong(tab, "serviceChargeBasisPoints", 0);
        var tip = ReadLong(tab, "tipCents", 0);
        long serviceCharge;
        long total;
        try
        {
            serviceCharge = checked(checked((subtotal - discount) * basisPoints) / 10_000);
            total = checked(subtotal - discount + serviceCharge + tip);
        }
        catch (OverflowException)
        {
            throw Conflict("MONEY_OVERFLOW");
        }
        tab["subtotalCents"] = subtotal;
        tab["discountCents"] = discount;
        tab["serviceChargeCents"] = serviceCharge;
        tab["totalCents"] = total;
        tab["updatedAt"] = now;
        ReplaceById(RequireArray(root, "tabs"), tabId, tab);
        ReplaceById(RequireArray(RequireObject(root, "floor"), "openTabs"), tabId, tab);
        return new JsonObject
        {
            ["subtotalCents"] = subtotal,
            ["discountCents"] = discount,
            ["serviceChargeCents"] = serviceCharge,
            ["tipCents"] = tip,
            ["totalCents"] = total,
        };
    }

    private static JsonObject GetTabDetail(JsonObject root, string tabId)
    {
        var details = RequireObject(root, "tabDetails");
        return details[tabId] as JsonObject ?? throw Conflict("TAB_NOT_FOUND");
    }

    private static JsonObject? GetTabDetailOrNull(JsonObject root, string tabId) =>
        RequireObject(root, "tabDetails")[tabId] as JsonObject;

    private static (JsonObject Detail, JsonObject Item) FindItem(JsonObject root, string itemId)
    {
        foreach (var entry in RequireObject(root, "tabDetails"))
        {
            if (entry.Value is not JsonObject detail) continue;
            var item = FindById(RequireArray(detail, "items"), itemId);
            if (item is not null) return (detail, item);
        }
        throw Conflict("ORDER_ITEM_NOT_FOUND");
    }

    private static (JsonObject Detail, JsonObject Item)? FindItemOrNull(JsonObject root, string itemId)
    {
        foreach (var entry in RequireObject(root, "tabDetails"))
        {
            if (entry.Value is not JsonObject detail) continue;
            var item = FindById(RequireArray(detail, "items"), itemId);
            if (item is not null) return (detail, item);
        }
        return null;
    }

    private static (JsonObject Detail, JsonObject Order) FindOrder(JsonObject root, string orderId)
    {
        foreach (var entry in RequireObject(root, "tabDetails"))
        {
            if (entry.Value is not JsonObject detail) continue;
            var order = FindById(RequireArray(detail, "orders"), orderId);
            if (order is not null) return (detail, order);
        }
        throw Conflict("ORDER_NOT_FOUND");
    }

    private static (JsonObject Detail, JsonObject Order)? FindOrderOrNull(JsonObject root, string orderId)
    {
        foreach (var entry in RequireObject(root, "tabDetails"))
        {
            if (entry.Value is not JsonObject detail) continue;
            var order = FindById(RequireArray(detail, "orders"), orderId);
            if (order is not null) return (detail, order);
        }
        return null;
    }

    private static JsonObject? FindById(JsonArray array, string id) => FindBy(array, "id", id);

    private static JsonObject? FindBy(JsonArray array, string property, string value) =>
        array.OfType<JsonObject>().FirstOrDefault(node => ReadOptionalString(node, property) == value);

    private static void ReplaceById(JsonArray array, string id, JsonObject replacement)
    {
        for (var index = 0; index < array.Count; index++)
        {
            if (array[index] is JsonObject candidate && ReadOptionalString(candidate, "id") == id)
            {
                array[index] = replacement.DeepClone();
                return;
            }
        }
        throw Conflict("TAB_NOT_FOUND");
    }

    private static void RemoveById(JsonArray array, string id)
    {
        for (var index = 0; index < array.Count; index++)
        {
            if (array[index] is JsonObject candidate && ReadOptionalString(candidate, "id") == id)
            {
                array.RemoveAt(index);
                return;
            }
        }
    }

    private static void SyncTab(JsonObject root, string tabId)
    {
        var tab = RequireObject(GetTabDetail(root, tabId), "tab");
        ReplaceById(RequireArray(root, "tabs"), tabId, tab);
        ReplaceById(RequireArray(RequireObject(root, "floor"), "openTabs"), tabId, tab);
    }

    private static void SetTableStatus(JsonArray tables, string tableId, string status, string now)
    {
        var table = FindById(tables, tableId) ?? throw Conflict("TABLE_NOT_FOUND");
        table["status"] = status;
        table["updatedAt"] = now;
    }

    private static void MoveModifiers(
        JsonArray sourceModifiers,
        JsonArray targetModifiers,
        string commandId,
        string sourceItemId,
        string targetItemId,
        int movedQuantity,
        int sourceQuantity,
        bool partial)
    {
        for (var index = sourceModifiers.Count - 1; index >= 0; index--)
        {
            if (sourceModifiers[index] is not JsonObject modifier ||
                ReadOptionalString(modifier, "orderItemId") != sourceItemId)
            {
                continue;
            }
            var moved = modifier.DeepClone().AsObject();
            moved["orderItemId"] = targetItemId;
            if (partial)
            {
                var sourceModifierId = ReadString(modifier, "id");
                var total = ReadLong(modifier, "totalDeltaCents", 0);
                var movedDelta = Proportional(total, movedQuantity, sourceQuantity);
                modifier["totalDeltaCents"] = total - movedDelta;
                moved["id"] = StableId(
                    commandId,
                    "split-modifier",
                    $"{sourceItemId}:{sourceModifierId}");
                moved["totalDeltaCents"] = movedDelta;
            }
            else
            {
                sourceModifiers.RemoveAt(index);
            }
            targetModifiers.Add(moved);
        }
    }

    private static void UpdateKdsItem(JsonObject root, JsonObject item)
    {
        var itemId = ReadString(item, "id");
        foreach (var row in RequireArray(RequireObject(root, "kds"), "items").OfType<JsonObject>())
        {
            if (ReadString(RequireObject(row, "item"), "id") == itemId)
            {
                row["item"] = item.DeepClone();
            }
        }
    }

    private static long Proportional(long total, int movedQuantity, int sourceQuantity)
    {
        try
        {
            return checked(total * movedQuantity) / sourceQuantity;
        }
        catch (OverflowException)
        {
            throw Conflict("MONEY_OVERFLOW");
        }
    }

    private static JsonObject ParseObject(string json, string code)
    {
        try
        {
            return JsonNode.Parse(json)?.AsObject() ?? throw Conflict(code);
        }
        catch (JsonException)
        {
            throw Conflict(code);
        }
        catch (InvalidOperationException exception) when (exception is not OperationalConflictException)
        {
            throw Conflict(code);
        }
    }

    private static JsonElement ParseElement(JsonNode node)
    {
        using var document = JsonDocument.Parse(node.ToJsonString(OperationalSnapshot.JsonOptions));
        return document.RootElement.Clone();
    }

    private static JsonObject RequireObject(JsonObject parent, string property) =>
        parent[property] as JsonObject ?? throw Conflict("INVALID_OPERATIONAL_SNAPSHOT");

    private static JsonArray RequireArray(JsonObject parent, string property) =>
        parent[property] as JsonArray ?? throw Conflict("INVALID_OPERATIONAL_SNAPSHOT");

    private static string ReadString(JsonObject source, string property) =>
        ReadOptionalString(source, property) ?? throw Conflict("INVALID_OFFLINE_PAYLOAD");

    private static string? ReadOptionalString(JsonObject source, string property)
    {
        if (source[property] is null) return null;
        if (source[property] is JsonValue value && value.TryGetValue<string>(out var text) &&
            !string.IsNullOrWhiteSpace(text))
        {
            return text;
        }
        throw Conflict("INVALID_OFFLINE_PAYLOAD");
    }

    private static bool? ReadOptionalBoolean(JsonObject source, string property)
    {
        if (source[property] is null) return null;
        return source[property] is JsonValue value && value.TryGetValue<bool>(out var result)
            ? result
            : throw Conflict("INVALID_OPERATIONAL_SNAPSHOT");
    }

    private static int ReadInt(JsonObject source, string property, int minimum, int maximum)
    {
        if (source[property] is JsonValue value && value.TryGetValue<int>(out var result) &&
            result >= minimum && result <= maximum)
        {
            return result;
        }
        throw Conflict("INVALID_OFFLINE_PAYLOAD");
    }

    private static long ReadLong(JsonObject source, string property, long minimum)
    {
        if (source[property] is JsonValue value &&
            ((value.TryGetValue<long>(out var result) && result >= minimum) ||
             (value.TryGetValue<int>(out var intResult) && (result = intResult) >= minimum)))
        {
            return result;
        }
        throw Conflict("INVALID_OPERATIONAL_SNAPSHOT");
    }

    private static long ReadLong(
        JsonObject source,
        string property,
        long minimum,
        long maximum,
        string code)
    {
        try
        {
            var result = ReadLong(source, property, minimum);
            return result <= maximum ? result : throw Conflict(code);
        }
        catch (OperationalConflictException exception) when (exception.Code == "INVALID_OPERATIONAL_SNAPSHOT")
        {
            throw Conflict(code);
        }
    }

    private static IReadOnlyList<string> ReadStringArray(JsonObject source, string property)
    {
        if (source[property] is null) return [];
        var array = source[property] as JsonArray ?? throw Conflict("INVALID_OFFLINE_PAYLOAD");
        return array.Select(node =>
            node is JsonValue value && value.TryGetValue<string>(out var text) && !string.IsNullOrWhiteSpace(text)
                ? text
                : throw Conflict("INVALID_OFFLINE_PAYLOAD")).ToArray();
    }

    private static OperationalConflictException Conflict(string code) => new(code);
}
