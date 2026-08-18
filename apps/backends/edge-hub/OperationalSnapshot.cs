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
    private const string CanonicalAttentionEventType = "pos.kds.critical_note_acknowledged_requested";
    private const string AttentionEventTypeAlias = "pos.kds.critical_note_acknowledgement_requested";
    private static readonly IReadOnlyDictionary<string, string> EventTypeByAction =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["open-tab"] = "pos.tab.open_requested",
            ["table-turnover"] = "pos.table.turnover_requested",
            ["create-order"] = "pos.order.create_requested",
            ["send-order"] = "pos.order.send_requested",
            ["transition-kds"] = "pos.kds.transition_requested",
            ["transition-kds-item"] = "pos.kds.item_transition_requested",
            ["refire-kds-item"] = "pos.kds.item_refire_requested",
            ["recall-kds"] = "pos.kds.recall_requested",
            ["set-kds-priority"] = "pos.kds.priority_requested",
            ["set-kds-order-priority"] = "pos.kds.order_priority_requested",
            ["set-kds-course-state"] = "pos.kds.course_state_requested",
            ["handoff-kds-order"] = "pos.kds.handoff_requested",
            ["set-kds-product-availability"] = "pos.kds.product_availability_requested",
            ["block-kds-item"] = "pos.kds.item_block_requested",
            ["unblock-kds-item"] = "pos.kds.item_unblock_requested",
            ["acknowledge-kds-critical-note"] = CanonicalAttentionEventType,
            // Kept as an input-only compatibility alias. The persisted event type stays canonical.
            ["acknowledge-kds-attention"] = CanonicalAttentionEventType,
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
            ["table-turnover"] = ["owner", "manager", "waiter", "cashier", "busser"],
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
            ["transition-kds-item"] = ["owner", "manager", "kds"],
            ["refire-kds-item"] = ["owner", "manager"],
            ["recall-kds"] = ["owner", "manager", "kds"],
            // The cloud can additionally authorize a KDS operator through a persisted pass-terminal
            // profile. The Edge does not cache that cloud profile, so offline priority is manager-only.
            ["set-kds-priority"] = ["owner", "manager"],
            ["set-kds-order-priority"] = ["owner", "manager"],
            ["set-kds-course-state"] = ["owner", "manager", "kds"],
            ["handoff-kds-order"] = ["owner", "manager", "waiter", "kds"],
            ["set-kds-product-availability"] = ["owner", "manager", "kds"],
            ["block-kds-item"] = ["owner", "manager", "kds"],
            ["unblock-kds-item"] = ["owner", "manager", "kds"],
            ["acknowledge-kds-critical-note"] = ["owner", "manager", "kds"],
            ["acknowledge-kds-attention"] = ["owner", "manager", "kds"],
        };

    public static bool IsPilotMutation(JsonElement payload) =>
        payload.ValueKind == JsonValueKind.Object &&
        payload.TryGetProperty("kind", out var kind) &&
        kind.ValueKind == JsonValueKind.String &&
        kind.GetString() == "pilot.mutation";

    public static OperationalCommand Canonicalize(OperationalCommand command)
    {
        if (command.Type != AttentionEventTypeAlias || !IsPilotMutation(command.Payload) ||
            !command.Payload.TryGetProperty("action", out var action) ||
            action.ValueKind != JsonValueKind.String ||
            action.GetString() is not ("acknowledge-kds-critical-note" or "acknowledge-kds-attention"))
        {
            return command;
        }
        return command with { Type = CanonicalAttentionEventType };
    }

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
        var data = RequireObject(envelope, "data");
        if (ReadOptionalString(envelope, "delivery") == "cloud-only" ||
            action == "set-kds-order-priority" ||
            (action == "set-kds-product-availability" &&
                (data.ContainsKey("resetAt") || data.ContainsKey("dailyStock"))))
        {
            throw Conflict("OFFLINE_ACTION_CLOUD_ONLY");
        }
        snapshot.RequireActorRole(command.ActorId, RolesByAction[action], acceptedAt);
        var now = acceptedAt.ToString("O");
        RefreshExpiredKdsAvailability(root, acceptedAt);

        var result = action switch
        {
            "open-tab" => OpenTab(root, command, data, now),
            "table-turnover" => TableTurnover(root, data, now),
            "create-order" => CreateOrder(root, command, data, now),
            "send-order" => SendOrder(root, command, data, now),
            "transition-kds" => TransitionKds(root, data, now),
            "transition-kds-item" => TransitionKdsItem(root, data, now),
            "refire-kds-item" => RefireKdsItem(root, data, now),
            "recall-kds" => RecallKds(root, data, now),
            "set-kds-priority" => SetKdsOrderPriority(root, command, data, now, legacyTicketAlias: true),
            "set-kds-order-priority" => SetKdsOrderPriority(root, command, data, now),
            "set-kds-course-state" => SetKdsCourseState(root, data, now),
            "handoff-kds-order" => HandoffKdsOrder(root, data, now),
            "set-kds-product-availability" => SetKdsProductAvailability(root, command, data, acceptedAt, now),
            "block-kds-item" => BlockKdsItem(root, command, data, now),
            "unblock-kds-item" => UnblockKdsItem(root, command, data, now),
            "acknowledge-kds-critical-note" or "acknowledge-kds-attention" =>
                AcknowledgeKdsCriticalNote(root, command, data, now),
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
            ["serviceNotes"] = ReadOptionalString(body, "serviceNotes"),
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

    private static JsonObject TableTurnover(JsonObject root, JsonObject data, string now)
    {
        var tableId = ReadString(data, "tableId");
        var nextStatus = ReadString(data, "status");
        var floor = RequireObject(root, "floor");
        var table = FindById(RequireArray(floor, "tables"), tableId)
            ?? throw Conflict("TABLE_NOT_FOUND");
        var currentStatus = ReadString(table, "status");
        if (currentStatus == nextStatus)
            return new JsonObject { ["table"] = table.DeepClone() };
        var allowed =
            (currentStatus == "needs_cleaning" && nextStatus == "cleaning") ||
            ((currentStatus == "needs_cleaning" || currentStatus == "cleaning") && nextStatus == "available");
        if (!allowed) throw Conflict("INVALID_TABLE_TURNOVER_TRANSITION");
        if (RequireArray(floor, "openTabs").Any(node =>
                node is JsonObject tab && ReadOptionalString(tab, "tableId") == tableId))
            throw Conflict("TABLE_HAS_OPEN_TAB");
        table["status"] = nextStatus;
        table["updatedAt"] = now;
        return new JsonObject { ["table"] = table.DeepClone() };
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
            var course = ReadOptionalString(requested, "course") ?? "main";
            if (course is not ("anytime" or "starter" or "main" or "dessert"))
                throw Conflict("INVALID_ORDER_ITEMS");
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
                ["seatNumber"] = ReadOptionalInt(requested, "seatNumber", 1, 500),
                ["course"] = course,
                ["allergyNote"] = ReadOptionalString(requested, "allergyNote"),
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
        var serviceMode = ReadOptionalString(kds, "operationServiceMode") ??
            ReadOptionalString(kds, "serviceMode") ??
            "quick_service";
        var tab = RequireObject(detail, "tab");
        var tableId = ReadOptionalString(tab, "tableId");
        var table = tableId is null
            ? null
            : FindById(RequireArray(RequireObject(root, "floor"), "tables"), tableId);
        var catalog = RequireObject(root, "catalog");
        var stations = RequireArray(catalog, "stations");
        var modifiers = RequireArray(detail, "modifiers");
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
                ["priority"] = 0,
                ["rush"] = false,
                ["recallCount"] = 0,
                ["refireCount"] = 0,
                ["startedAt"] = null,
                ["readyAt"] = null,
                ["handedOffAt"] = null,
                ["servedAt"] = null,
                ["completedAt"] = null,
                ["dueAt"] = ReadOptionalString(tab, "promisedAt"),
                ["promisedAt"] = ReadOptionalString(tab, "promisedAt"),
                ["station"] = FindById(stations, stationId)?.DeepClone(),
                ["order"] = order.DeepClone(),
                ["tab"] = tab.DeepClone(),
                ["table"] = table?.DeepClone(),
                ["createdAt"] = now,
                ["updatedAt"] = now,
            };
            tickets.Add(ticket);
            ticketIds.Add(ticketId);
            foreach (var item in items.Where(item => ReadString(item, "stationId") == stationId))
            {
                var itemId = ReadString(item, "id");
                var course = ReadOptionalString(item, "course") ?? "main";
                var held = (serviceMode is "full_service" or "hybrid") &&
                    (course is "main" or "dessert");
                var itemModifiers = new JsonArray();
                foreach (var modifier in modifiers.OfType<JsonObject>()
                    .Where(candidate => ReadOptionalString(candidate, "orderItemId") == itemId))
                {
                    itemModifiers.Add(modifier.DeepClone());
                }
                kdsItems.Add(new JsonObject
                {
                    ["ticketId"] = ticketId,
                    ["productId"] = ReadString(item, "productId"),
                    ["item"] = item.DeepClone(),
                    ["kds"] = new JsonObject
                    {
                        ["quantity"] = ReadInt(item, "quantity", 1, 500),
                        ["readyQuantity"] = 0,
                        ["status"] = "queued",
                        ["held"] = held,
                        ["heldAt"] = held ? now : null,
                        ["firedAt"] = held ? null : now,
                        ["startedAt"] = null,
                        ["readyAt"] = null,
                        ["completedAt"] = null,
                        ["blocked"] = EmptyKdsBlock(),
                    },
                    ["attention"] = BuildKdsAttention(item),
                    ["modifiers"] = itemModifiers,
                });
            }
        }
        RefreshKdsMetrics(kds);
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
            SetTableStatus(tables, previousTableId, "needs_cleaning", now);
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
                SetTableStatus(tables, sourceTableId, "needs_cleaning", now);
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
        JsonObject data,
        string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var targetState = ReadString(data, "state");
        var allowedStates = new HashSet<string>(["preparing", "ready"]);
        if (!allowedStates.Contains(targetState)) throw Conflict("INVALID_KDS_TRANSITION");
        var kds = RequireObject(root, "kds");
        var tickets = RequireArray(kds, "tickets");
        var ticket = FindById(tickets, ticketId) ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        var currentState = ReadString(ticket, "status");
        var transitions = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["pending"] = ["preparing"],
            ["preparing"] = ["ready"],
            ["ready"] = [],
            ["done"] = [],
            ["canceled"] = [],
        };
        if (!transitions.TryGetValue(currentState, out var allowed) || !allowed.Contains(targetState))
        {
            throw Conflict("INVALID_KDS_TRANSITION");
        }
        var activeRows = RequireArray(kds, "items").OfType<JsonObject>()
            .Where(row => ReadOptionalString(row, "ticketId") == ticketId)
            .Where(row => ReadString(EnsureKdsProduction(row), "status") != "canceled")
            .ToArray();
        if (activeRows.Length == 0) throw Conflict("KDS_TICKET_EMPTY");
        if (activeRows.Any(IsKdsItemBlocked)) throw Conflict("KDS_ITEM_BLOCKED");
        if (targetState == "ready" && activeRows.Any(HasUnacknowledgedKdsAttention))
            throw Conflict("KDS_ATTENTION_ACK_REQUIRED");

        JsonObject[] selectedRows;
        if (targetState == "preparing")
        {
            selectedRows = activeRows.Where(row =>
            {
                var production = EnsureKdsProduction(row);
                return ReadString(production, "status") == "queued" &&
                    ReadOptionalBoolean(production, "held") != true;
            }).ToArray();
            if (selectedRows.Length == 0) throw Conflict("KDS_NO_FIRED_ITEMS");
        }
        else
        {
            if (activeRows.Any(row =>
            {
                var production = EnsureKdsProduction(row);
                return ReadOptionalBoolean(production, "held") == true ||
                    ReadString(production, "status") is not ("preparing" or "ready");
            })) throw Conflict("KDS_ITEMS_NOT_READY");
            selectedRows = activeRows;
        }

        foreach (var row in selectedRows)
        {
            var production = EnsureKdsProduction(row);
            production["status"] = targetState;
            if (targetState == "preparing")
            {
                production["startedAt"] = now;
            }
            else
            {
                production["readyQuantity"] = ReadInt(production, "quantity", 1, 500);
                production["readyAt"] = now;
            }
            UpdateOrderItemFromKds(root, row, targetState, now);
        }

        ticket["status"] = targetState;
        if (targetState == "preparing" && ticket["startedAt"] is null) ticket["startedAt"] = now;
        if (targetState == "ready") ticket["readyAt"] = now;
        ticket["updatedAt"] = now;

        var orderId = ReadString(ticket, "orderId");
        var orderStatus = SyncKdsOrderState(root, orderId, now);
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["state"] = targetState,
            ["orderId"] = orderId,
            ["orderStatus"] = orderStatus,
        };
    }

    private static JsonObject TransitionKdsItem(JsonObject root, JsonObject data, string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var itemId = ReadString(data, "itemId");
        var targetState = ReadString(data, "state");
        if (targetState is not ("preparing" or "ready"))
            throw Conflict("INVALID_KDS_ITEM_TRANSITION");
        var kds = RequireObject(root, "kds");
        var ticket = FindById(RequireArray(kds, "tickets"), ticketId)
            ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        if (ReadString(ticket, "status") is "done" or "canceled")
            throw Conflict("INVALID_KDS_ITEM_TRANSITION");
        var row = FindKdsItem(kds, ticketId, itemId) ?? throw Conflict("KDS_ITEM_NOT_FOUND");
        var production = EnsureKdsProduction(row);
        var currentState = ReadString(production, "status");
        if (currentState == "canceled") throw Conflict("KDS_ITEM_CANCELED");
        if (IsKdsItemBlocked(row)) throw Conflict("KDS_ITEM_BLOCKED");
        var quantity = ReadInt(production, "quantity", 1, 500);
        var readyQuantity = ReadOptionalInt(production, "readyQuantity", 0, quantity) ?? 0;
        string itemState;
        if (targetState == "preparing")
        {
            if (currentState != "queued" || ReadOptionalBoolean(production, "held") == true)
                throw Conflict("INVALID_KDS_ITEM_TRANSITION");
            itemState = "preparing";
            production["startedAt"] = now;
        }
        else
        {
            if (currentState != "preparing") throw Conflict("INVALID_KDS_ITEM_TRANSITION");
            if (HasUnacknowledgedKdsAttention(row)) throw Conflict("KDS_ATTENTION_ACK_REQUIRED");
            var remaining = quantity - readyQuantity;
            if (remaining <= 0) throw Conflict("INVALID_KDS_READY_QUANTITY");
            var increment = ReadOptionalInt(data, "quantity", 1, remaining) ?? remaining;
            readyQuantity += increment;
            itemState = readyQuantity == quantity ? "ready" : "preparing";
            if (itemState == "ready") production["readyAt"] = now;
        }
        production["status"] = itemState;
        production["readyQuantity"] = readyQuantity;
        UpdateOrderItemFromKds(root, row, itemState, now);
        var ticketState = RefreshKdsTicketState(kds, ticket, now);
        var orderId = ReadString(ticket, "orderId");
        var orderStatus = SyncKdsOrderState(root, orderId, now);
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["orderItemId"] = itemId,
            ["state"] = ticketState,
            ["itemState"] = itemState,
            ["readyQuantity"] = readyQuantity,
            ["orderStatus"] = orderStatus,
        };
    }

    private static JsonObject RefireKdsItem(JsonObject root, JsonObject data, string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var itemId = ReadString(data, "itemId");
        _ = ReadString(data, "reason");
        var kds = RequireObject(root, "kds");
        var ticket = FindById(RequireArray(kds, "tickets"), ticketId)
            ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        var row = FindKdsItem(kds, ticketId, itemId) ?? throw Conflict("KDS_ITEM_NOT_FOUND");
        var production = EnsureKdsProduction(row);
        if (IsKdsItemBlocked(row)) throw Conflict("KDS_ITEM_BLOCKED");
        if (ReadString(production, "status") is not ("ready" or "served"))
            throw Conflict("KDS_ITEM_NOT_REFIREABLE");
        production["status"] = "preparing";
        production["readyQuantity"] = 0;
        production["held"] = false;
        production["heldAt"] = null;
        production["startedAt"] = now;
        production["readyAt"] = null;
        production["completedAt"] = null;
        UpdateOrderItemFromKds(root, row, "preparing", now);
        ticket["status"] = "preparing";
        ticket["readyAt"] = null;
        ticket["handedOffAt"] = null;
        ticket["servedAt"] = null;
        ticket["completedAt"] = null;
        ticket["refireCount"] = (ReadOptionalLong(ticket, "refireCount", 0) ?? 0) + 1;
        ticket["priority"] = 100;
        ticket["rush"] = true;
        ticket["updatedAt"] = now;
        var orderId = ReadString(ticket, "orderId");
        var orderStatus = SyncKdsOrderState(root, orderId, now);
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["orderItemId"] = itemId,
            ["state"] = "preparing",
            ["orderStatus"] = orderStatus,
        };
    }

    private static JsonObject RecallKds(JsonObject root, JsonObject data, string now)
    {
        var ticketId = ReadString(data, "ticketId");
        _ = ReadString(data, "reason");
        var kds = RequireObject(root, "kds");
        var ticket = FindById(RequireArray(kds, "tickets"), ticketId)
            ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        var status = ReadString(ticket, "status");
        if (status != "ready" && !(status == "done" && ReadOptionalString(ticket, "servedAt") is null))
            throw Conflict("KDS_TICKET_NOT_RECALLABLE");
        var rows = RequireArray(kds, "items").OfType<JsonObject>()
            .Where(row => ReadOptionalString(row, "ticketId") == ticketId)
            .Where(row => ReadString(EnsureKdsProduction(row), "status") != "canceled")
            .ToArray();
        if (rows.Length == 0) throw Conflict("KDS_TICKET_EMPTY");
        if (rows.Any(IsKdsItemBlocked)) throw Conflict("KDS_ITEM_BLOCKED");
        foreach (var row in rows)
        {
            var production = EnsureKdsProduction(row);
            production["status"] = "preparing";
            production["readyQuantity"] = 0;
            production["held"] = false;
            production["heldAt"] = null;
            production["startedAt"] = now;
            production["readyAt"] = null;
            production["completedAt"] = null;
            UpdateOrderItemFromKds(root, row, "preparing", now);
        }
        ticket["status"] = "preparing";
        ticket["readyAt"] = null;
        ticket["handedOffAt"] = null;
        ticket["completedAt"] = null;
        ticket["recallCount"] = (ReadOptionalLong(ticket, "recallCount", 0) ?? 0) + 1;
        ticket["priority"] = Math.Max(ReadOptionalLong(ticket, "priority", 0) ?? 0, 50);
        ticket["rush"] = true;
        ticket["updatedAt"] = now;
        var orderId = ReadString(ticket, "orderId");
        var orderStatus = SyncKdsOrderState(root, orderId, now);
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["state"] = "preparing",
            ["orderStatus"] = orderStatus,
        };
    }

    private static JsonObject SetKdsOrderPriority(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now,
        bool legacyTicketAlias = false)
    {
        var priority = ReadInt(data, "priority", 0, 100);
        var reason = ReadString(data, "reason").Trim();
        if (reason.Length is < 3 or > 500) throw Conflict("INVALID_OFFLINE_PAYLOAD");
        if (data["installationId"] is not null &&
            !Guid.TryParse(ReadString(data, "installationId"), out _))
        {
            throw Conflict("INVALID_OFFLINE_PAYLOAD");
        }
        var kds = RequireObject(root, "kds");
        var tickets = RequireArray(kds, "tickets").OfType<JsonObject>().ToArray();
        string? legacyTicketId = null;
        string? legacyTicketState = null;
        string orderId;
        if (legacyTicketAlias)
        {
            legacyTicketId = ReadString(data, "ticketId");
            var source = tickets.FirstOrDefault(ticket => ReadOptionalString(ticket, "id") == legacyTicketId)
                ?? throw Conflict("KDS_TICKET_NOT_FOUND");
            orderId = ReadString(source, "orderId");
            legacyTicketState = ReadString(source, "status");
        }
        else
        {
            orderId = ReadString(data, "orderId");
        }

        var matching = tickets
            .Where(ticket => ReadOptionalString(ticket, "orderId") == orderId)
            .Where(ticket => ReadString(ticket, "status") != "canceled" &&
                ReadOptionalString(ticket, "servedAt") is null)
            .ToArray();
        var orderReference = FindOrderOrNull(root, orderId);
        var orderStatus = orderReference is null
            ? tickets
                .Where(ticket => ReadOptionalString(ticket, "orderId") == orderId)
                .Select(ticket => ticket["order"] as JsonObject)
                .Where(order => order is not null)
                .Select(order => ReadOptionalString(order!, "status"))
                .FirstOrDefault(status => status is not null)
            : ReadOptionalString(orderReference.Value.Order, "status");
        if (orderStatus is "draft" or "served" or "canceled")
            throw Conflict("KDS_ORDER_NOT_ACTIONABLE");
        if (matching.Length == 0) throw Conflict("KDS_ORDER_EMPTY");

        foreach (var ticket in matching)
        {
            ticket["priority"] = priority;
            ticket["rush"] = priority >= 50;
            ticket["updatedAt"] = now;
            if (ticket["order"] is JsonObject orderSummary)
            {
                orderSummary["kdsPriority"] = priority;
                orderSummary["kdsPriorityReason"] = reason;
                orderSummary["kdsPriorityUpdatedAt"] = now;
                orderSummary["kdsPriorityUpdatedByIdentityId"] = command.ActorId;
            }
        }
        if (orderReference is not null)
        {
            var order = orderReference.Value.Order;
            order["kdsPriority"] = priority;
            order["kdsPriorityReason"] = reason;
            order["kdsPriorityUpdatedAt"] = now;
            order["kdsPriorityUpdatedByIdentityId"] = command.ActorId;
            order["updatedAt"] = now;
        }
        RefreshKdsMetrics(kds);
        var ticketIds = new JsonArray();
        foreach (var ticket in matching.OrderBy(ticket => ReadString(ticket, "id"), StringComparer.Ordinal))
        {
            ticketIds.Add(ReadString(ticket, "id"));
        }
        var result = new JsonObject
        {
            ["orderId"] = orderId,
            ["ticketIds"] = ticketIds,
            ["priority"] = priority,
            ["reason"] = reason,
            ["updatedAt"] = now,
            ["updatedByIdentityId"] = command.ActorId,
        };
        if (legacyTicketId is not null)
        {
            result["ticketId"] = legacyTicketId;
            result["state"] = legacyTicketState;
        }
        return result;
    }

    private static JsonObject SetKdsCourseState(JsonObject root, JsonObject data, string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var course = ReadString(data, "course");
        var state = ReadString(data, "state");
        if (course is not ("anytime" or "starter" or "main" or "dessert") ||
            state is not ("held" or "fired"))
            throw Conflict("KDS_COURSE_NOT_ACTIONABLE");
        var kds = RequireObject(root, "kds");
        if (FindById(RequireArray(kds, "tickets"), ticketId) is null)
            throw Conflict("KDS_TICKET_NOT_FOUND");
        var matching = RequireArray(kds, "items").OfType<JsonObject>()
            .Where(row => ReadOptionalString(row, "ticketId") == ticketId)
            .Where(row => ReadOptionalString(RequireObject(row, "item"), "course") == course)
            .Where(row =>
            {
                var production = EnsureKdsProduction(row);
                return ReadString(production, "status") == "queued" &&
                    (ReadOptionalBoolean(production, "held") ?? false) == (state == "fired");
            })
            .ToArray();
        if (matching.Length == 0) throw Conflict("KDS_COURSE_NOT_ACTIONABLE");
        foreach (var row in matching)
        {
            var production = EnsureKdsProduction(row);
            production["held"] = state == "held";
            production["heldAt"] = state == "held" ? now : null;
            production["firedAt"] = state == "fired" ? now : null;
        }
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["state"] = state,
            ["course"] = course,
        };
    }

    private static JsonObject HandoffKdsOrder(JsonObject root, JsonObject data, string now)
    {
        var orderId = ReadString(data, "orderId");
        var target = ReadString(data, "target");
        if (target is not ("expedition" or "served")) throw Conflict("INVALID_KDS_HANDOFF");
        var kds = RequireObject(root, "kds");
        var tickets = RequireArray(kds, "tickets").OfType<JsonObject>()
            .Where(ticket => ReadOptionalString(ticket, "orderId") == orderId)
            .Where(ticket => ReadString(ticket, "status") != "canceled")
            .ToArray();
        if (tickets.Length == 0) throw Conflict("KDS_ORDER_EMPTY");
        var ticketIds = tickets.Select(ticket => ReadString(ticket, "id")).ToHashSet(StringComparer.Ordinal);
        var rows = RequireArray(kds, "items").OfType<JsonObject>()
            .Where(row => ticketIds.Contains(ReadOptionalString(row, "ticketId") ?? ""))
            .Where(row => ReadString(EnsureKdsProduction(row), "status") != "canceled")
            .ToArray();
        if (rows.Length == 0) throw Conflict("KDS_ORDER_EMPTY");
        if (rows.Any(IsKdsItemBlocked)) throw Conflict("KDS_ITEM_BLOCKED");
        if (rows.Any(HasUnacknowledgedKdsAttention))
            throw Conflict("KDS_ATTENTION_ACK_REQUIRED");
        if (rows.Any(row =>
        {
            var production = EnsureKdsProduction(row);
            var quantity = ReadInt(production, "quantity", 1, 500);
            return ReadString(production, "status") is not ("ready" or "served") ||
                (ReadOptionalInt(production, "readyQuantity", 0, quantity) ?? 0) != quantity;
        })) throw Conflict("KDS_ORDER_NOT_READY");

        if (target == "expedition")
        {
            if (tickets.Any(ticket => ReadString(ticket, "status") != "ready"))
                throw Conflict("KDS_ORDER_NOT_READY");
            foreach (var ticket in tickets)
            {
                ticket["status"] = "done";
                ticket["handedOffAt"] ??= now;
                ticket["completedAt"] ??= now;
                ticket["updatedAt"] = now;
            }
            foreach (var row in rows) EnsureKdsProduction(row)["completedAt"] ??= now;
        }
        else
        {
            if (tickets.Any(ticket => ReadString(ticket, "status") != "done" ||
                ReadOptionalString(ticket, "handedOffAt") is null ||
                ReadOptionalString(ticket, "servedAt") is not null))
                throw Conflict("KDS_ORDER_NOT_AT_EXPEDITION");
            foreach (var row in rows)
            {
                var production = EnsureKdsProduction(row);
                production["status"] = "served";
                production["readyQuantity"] = ReadInt(production, "quantity", 1, 500);
                production["completedAt"] ??= now;
                UpdateOrderItemFromKds(root, row, "served", now);
            }
            foreach (var ticket in tickets)
            {
                ticket["servedAt"] ??= now;
                ticket["completedAt"] ??= now;
                ticket["updatedAt"] = now;
            }
        }
        var orderStatus = SyncKdsOrderState(root, orderId, now);
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["orderId"] = orderId,
            ["target"] = target,
            ["state"] = orderStatus,
        };
    }

    private static JsonObject SetKdsProductAvailability(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        DateTimeOffset acceptedAt,
        string now)
    {
        var productId = ReadString(data, "productId");
        var available = ReadOptionalBoolean(data, "available")
            ?? throw Conflict("INVALID_OFFLINE_PAYLOAD");
        var reason = ReadString(data, "reason").Trim();
        if (reason.Length is < 3 or > 500) throw Conflict("INVALID_OFFLINE_PAYLOAD");
        DateTimeOffset? resetAt = null;
        if (data["resetAt"] is not null)
        {
            if (!DateTimeOffset.TryParse(ReadString(data, "resetAt"), out var parsedResetAt) ||
                available || parsedResetAt <= acceptedAt)
            {
                throw Conflict("INVALID_KDS_AVAILABILITY_RESET");
            }
            resetAt = parsedResetAt.ToUniversalTime();
        }
        var hasDailyStock = data.ContainsKey("dailyStock");
        var requestedDailyStock = hasDailyStock
            ? ReadOptionalInt(data, "dailyStock", 0, 1_000_000)
            : null;
        var catalog = RequireObject(root, "catalog");
        var product = RequireArray(catalog, "products").OfType<JsonObject>()
            .FirstOrDefault(candidate => ReadOptionalString(candidate, "id") == productId);
        if (product is null || ReadOptionalBoolean(product, "active") == false)
            throw Conflict("PRODUCT_NOT_FOUND");
        var availability = RequireArray(catalog, "availability").OfType<JsonObject>()
            .FirstOrDefault(candidate => ReadOptionalString(candidate, "productId") == productId);
        if (availability is null) throw Conflict("PRODUCT_NOT_CONFIGURED_FOR_UNIT");
        if (hasDailyStock) availability["dailyStock"] = requestedDailyStock;
        availability["available"] = available;
        availability["reason"] = reason;
        availability["operationalReason"] = reason;
        availability["resetAt"] = resetAt?.ToString("O");
        availability["operationalResetAt"] = resetAt?.ToString("O");
        availability["updatedByIdentityId"] = command.ActorId;
        availability["operationalUpdatedByIdentityId"] = command.ActorId;
        availability["updatedAt"] = now;

        var dailyStock = hasDailyStock
            ? requestedDailyStock
            : ReadOptionalInt(availability, "dailyStock", 0, 1_000_000);
        var soldToday = ReadOptionalInt(availability, "soldToday", 0, 1_000_000) ?? 0;
        var kds = RequireObject(root, "kds");
        var productAvailability = kds["productAvailability"] as JsonArray ?? new JsonArray();
        kds["productAvailability"] = productAvailability;
        var readRow = FindBy(productAvailability, "productId", productId) ?? new JsonObject();
        if (ReadOptionalString(readRow, "productId") is null) productAvailability.Add(readRow);
        readRow["productId"] = productId;
        readRow["productName"] = ReadString(product, "name");
        readRow["available"] = available;
        readRow["dailyStock"] = dailyStock;
        readRow["soldToday"] = soldToday;
        readRow["autoDeductStock"] = ReadOptionalBoolean(availability, "autoDeductStock");
        readRow["reason"] = reason;
        readRow["updatedByIdentityId"] = command.ActorId;
        readRow["updatedAt"] = now;
        readRow["resetAt"] = resetAt?.ToString("O");
        RefreshKdsAvailabilityStatus(readRow);
        return new JsonObject
        {
            ["productId"] = productId,
            ["productName"] = ReadString(product, "name"),
            ["available"] = readRow["available"]?.DeepClone(),
            ["status"] = readRow["status"]?.DeepClone(),
            ["dailyStock"] = dailyStock,
            ["soldToday"] = soldToday,
            ["remainingQuantity"] = readRow["remainingQuantity"]?.DeepClone(),
            ["autoDeductStock"] = readRow["autoDeductStock"]?.DeepClone(),
            ["reason"] = reason,
            ["resetAt"] = resetAt?.ToString("O"),
            ["updatedAt"] = now,
            ["updatedByIdentityId"] = command.ActorId,
        };
    }

    private static void RefreshExpiredKdsAvailability(JsonObject root, DateTimeOffset now)
    {
        var catalog = RequireObject(root, "catalog");
        if (catalog["availability"] is JsonArray catalogAvailability)
        {
            foreach (var availability in catalogAvailability.OfType<JsonObject>())
            {
                if (!TryReadExpiredReset(availability, now)) continue;
                availability["available"] = true;
                availability["reason"] = null;
                availability["operationalReason"] = null;
                availability["resetAt"] = null;
                availability["operationalResetAt"] = null;
            }
        }
        var kds = RequireObject(root, "kds");
        if (kds["productAvailability"] is not JsonArray productAvailability) return;
        foreach (var row in productAvailability.OfType<JsonObject>())
        {
            if (TryReadExpiredReset(row, now))
            {
                row["available"] = true;
                row["reason"] = null;
                row["resetAt"] = null;
            }
            RefreshKdsAvailabilityStatus(row);
        }
    }

    private static bool TryReadExpiredReset(JsonObject row, DateTimeOffset now) =>
        (ReadOptionalString(row, "resetAt") ?? ReadOptionalString(row, "operationalResetAt")) is { } resetAt &&
        DateTimeOffset.TryParse(resetAt, out var parsed) &&
        parsed <= now;

    private static void RefreshKdsAvailabilityStatus(JsonObject row)
    {
        var manuallyAvailable = ReadOptionalBoolean(row, "available") ?? false;
        var dailyStock = ReadOptionalInt(row, "dailyStock", 0, 1_000_000);
        var soldToday = ReadOptionalInt(row, "soldToday", 0, 1_000_000) ?? 0;
        int? remaining = dailyStock is null ? null : Math.Max(0, dailyStock.Value - soldToday);
        var available = manuallyAvailable && (remaining is null || remaining > 0);
        row["available"] = available;
        row["remainingQuantity"] = remaining;
        row["status"] = !available
            ? "unavailable"
            : dailyStock is null ? "available" : "limited";
    }

    private static JsonObject BlockKdsItem(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var itemId = ReadString(data, "itemId");
        var code = ReadString(data, "code");
        var reason = ReadString(data, "reason");
        if (code.Length > 80 || reason.Length > 500) throw Conflict("INVALID_OFFLINE_PAYLOAD");

        var kds = RequireObject(root, "kds");
        var ticket = FindById(RequireArray(kds, "tickets"), ticketId)
            ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        var row = FindKdsItem(kds, ticketId, itemId) ?? throw Conflict("KDS_ITEM_NOT_FOUND");
        var production = EnsureKdsProduction(row);
        if (ReadString(production, "status") is "served" or "canceled" ||
            ReadString(ticket, "status") is "done" or "canceled")
        {
            throw Conflict("KDS_ITEM_NOT_ACTIONABLE");
        }
        if (IsKdsItemBlocked(row)) throw Conflict("KDS_ITEM_ALREADY_BLOCKED");

        var previous = production["blocked"] as JsonObject;
        var count = previous is null
            ? 0
            : (ReadOptionalLong(previous, "count", 0) ??
               ReadOptionalLong(previous, "blockCount", 0) ?? 0);
        var blocked = new JsonObject
        {
            ["active"] = true,
            ["code"] = code,
            ["reason"] = reason,
            ["blockedAt"] = now,
            ["blockedByIdentityId"] = command.ActorId,
            ["unblockedAt"] = null,
            ["unblockedByIdentityId"] = null,
            ["count"] = count + 1,
        };
        production["blocked"] = blocked;
        ticket["updatedAt"] = now;
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["orderItemId"] = itemId,
            ["blocked"] = blocked.DeepClone(),
        };
    }

    private static JsonObject UnblockKdsItem(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var itemId = ReadString(data, "itemId");
        var reason = ReadString(data, "reason");
        if (reason.Length > 500) throw Conflict("INVALID_OFFLINE_PAYLOAD");

        var kds = RequireObject(root, "kds");
        var ticket = FindById(RequireArray(kds, "tickets"), ticketId)
            ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        var row = FindKdsItem(kds, ticketId, itemId) ?? throw Conflict("KDS_ITEM_NOT_FOUND");
        var production = EnsureKdsProduction(row);
        var blocked = production["blocked"] as JsonObject;
        if (blocked is null || ReadOptionalBoolean(blocked, "active") != true)
            throw Conflict("KDS_ITEM_NOT_BLOCKED");

        blocked["active"] = false;
        blocked["unblockedAt"] = now;
        blocked["unblockedByIdentityId"] = command.ActorId;
        ticket["updatedAt"] = now;
        RefreshKdsMetrics(kds);
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["orderItemId"] = itemId,
            ["reason"] = reason,
            ["blocked"] = blocked.DeepClone(),
        };
    }

    private static JsonObject AcknowledgeKdsCriticalNote(
        JsonObject root,
        OperationalCommand command,
        JsonObject data,
        string now)
    {
        var ticketId = ReadString(data, "ticketId");
        var itemId = ReadString(data, "itemId");
        var noteId = ReadOptionalString(data, "noteId") ?? ReadString(data, "attentionId");
        var revision = ReadString(data, "revision");
        if (noteId is not ("allergy" or "notes")) throw Conflict("KDS_ATTENTION_NOT_FOUND");

        var kds = RequireObject(root, "kds");
        var ticket = FindById(RequireArray(kds, "tickets"), ticketId)
            ?? throw Conflict("KDS_TICKET_NOT_FOUND");
        var row = FindKdsItem(kds, ticketId, itemId) ?? throw Conflict("KDS_ITEM_NOT_FOUND");
        var attention = row["attention"] as JsonArray;
        var note = attention?.OfType<JsonObject>().FirstOrDefault(candidate =>
            (ReadOptionalString(candidate, "id") ?? ReadOptionalString(candidate, "noteId")) == noteId);
        if (note is null) throw Conflict("KDS_ATTENTION_NOT_FOUND");
        if (!string.Equals(ReadString(note, "revision"), revision, StringComparison.Ordinal))
            throw Conflict("KDS_ATTENTION_REVISION_CHANGED");

        if (ReadOptionalBoolean(note, "acknowledged") != true)
        {
            note["acknowledged"] = true;
            note["acknowledgedAt"] ??= now;
            note["acknowledgedByIdentityId"] ??= command.ActorId;
            ticket["updatedAt"] = now;
        }
        return new JsonObject
        {
            ["ticketId"] = ticketId,
            ["orderItemId"] = itemId,
            ["noteId"] = noteId,
            ["revision"] = revision,
            ["acknowledgedAt"] = note["acknowledgedAt"]?.DeepClone(),
            ["acknowledgedByIdentityId"] = note["acknowledgedByIdentityId"]?.DeepClone(),
        };
    }

    private static JsonArray BuildKdsAttention(JsonObject item)
    {
        var attention = new JsonArray();
        AddKdsAttention(attention, "allergy", "allergy", ReadOptionalString(item, "allergyNote"));
        AddKdsAttention(attention, "notes", "note", ReadOptionalString(item, "notes"));
        return attention;
    }

    private static JsonObject EmptyKdsBlock() => new()
    {
        ["active"] = false,
        ["code"] = null,
        ["reason"] = null,
        ["blockedAt"] = null,
        ["blockedByIdentityId"] = null,
        ["unblockedAt"] = null,
        ["unblockedByIdentityId"] = null,
        ["count"] = 0,
    };

    private static void AddKdsAttention(
        JsonArray attention,
        string noteId,
        string kind,
        string? text)
    {
        if (text is null) return;
        var normalized = text.Trim().Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        if (normalized.Length == 0) return;
        var revision = Convert.ToHexStringLower(
            SHA256.HashData(Encoding.UTF8.GetBytes($"{noteId}\0{normalized}")));
        attention.Add(new JsonObject
        {
            ["id"] = noteId,
            ["kind"] = kind,
            ["text"] = normalized,
            ["revision"] = revision,
            ["acknowledged"] = false,
            ["acknowledgedAt"] = null,
            ["acknowledgedByIdentityId"] = null,
        });
    }

    private static bool IsKdsItemBlocked(JsonObject row)
    {
        var production = EnsureKdsProduction(row);
        if (production["blocked"] is JsonObject blocked)
            return ReadOptionalBoolean(blocked, "active") == true;
        return production["blocked"] is JsonValue value &&
            value.TryGetValue<bool>(out var active) && active;
    }

    private static bool HasUnacknowledgedKdsAttention(JsonObject row)
    {
        if (row["attention"] is not JsonArray attention) return false;
        return attention.OfType<JsonObject>().Any(note =>
            ReadOptionalBoolean(note, "required") != false &&
            ReadOptionalBoolean(note, "acknowledged") != true);
    }

    private static JsonObject? FindKdsItem(JsonObject kds, string ticketId, string itemId) =>
        RequireArray(kds, "items").OfType<JsonObject>().FirstOrDefault(row =>
            ReadOptionalString(row, "ticketId") == ticketId &&
            ReadOptionalString(RequireObject(row, "item"), "id") == itemId);

    private static JsonObject EnsureKdsProduction(JsonObject row)
    {
        if (row["kds"] is JsonObject production) return production;
        var item = RequireObject(row, "item");
        var quantity = ReadInt(item, "quantity", 1, 500);
        var itemStatus = ReadString(item, "status");
        var status = itemStatus switch
        {
            "pending" or "sent" => "queued",
            "queued" or "preparing" or "ready" or "served" or "canceled" => itemStatus,
            _ => throw Conflict("INVALID_OPERATIONAL_SNAPSHOT"),
        };
        production = new JsonObject
        {
            ["quantity"] = quantity,
            ["readyQuantity"] = status is "ready" or "served" ? quantity : 0,
            ["status"] = status,
            ["held"] = false,
            ["heldAt"] = null,
            ["firedAt"] = null,
            ["startedAt"] = null,
            ["readyAt"] = null,
            ["completedAt"] = null,
            ["blocked"] = EmptyKdsBlock(),
        };
        row["kds"] = production;
        return production;
    }

    private static void UpdateOrderItemFromKds(
        JsonObject root,
        JsonObject kdsRow,
        string state,
        string now)
    {
        var projectedItem = RequireObject(kdsRow, "item");
        var itemId = ReadString(projectedItem, "id");
        if (ReadString(projectedItem, "status") != "canceled") projectedItem["status"] = state;
        projectedItem["updatedAt"] = now;
        var source = FindItemOrNull(root, itemId);
        if (source is null || ReadString(source.Value.Item, "status") == "canceled") return;
        var sourceItem = source.Value.Item;
        sourceItem["status"] = state;
        sourceItem["updatedAt"] = now;
    }

    private static string RefreshKdsTicketState(JsonObject kds, JsonObject ticket, string now)
    {
        var ticketId = ReadString(ticket, "id");
        var states = RequireArray(kds, "items").OfType<JsonObject>()
            .Where(row => ReadOptionalString(row, "ticketId") == ticketId)
            .Select(row => ReadString(EnsureKdsProduction(row), "status"))
            .Where(state => state != "canceled")
            .ToArray();
        if (states.Length == 0) throw Conflict("KDS_TICKET_EMPTY");
        var state = states.All(value => value is "ready" or "served")
            ? "ready"
            : states.Any(value => value is "preparing" or "ready" or "served")
                ? "preparing"
                : "pending";
        ticket["status"] = state;
        if (state == "preparing" && ticket["startedAt"] is null) ticket["startedAt"] = now;
        if (state == "ready") ticket["readyAt"] = now;
        else ticket["readyAt"] = null;
        ticket["updatedAt"] = now;
        return state;
    }

    private static string SyncKdsOrderState(JsonObject root, string orderId, string now)
    {
        var tickets = RequireArray(RequireObject(root, "kds"), "tickets").OfType<JsonObject>()
            .Where(ticket => ReadOptionalString(ticket, "orderId") == orderId)
            .ToArray();
        if (tickets.Length == 0) throw Conflict("KDS_TICKET_NOT_FOUND");
        var active = tickets.Where(ticket => ReadString(ticket, "status") != "canceled").ToArray();
        var orderStatus = active.Length == 0
            ? "canceled"
            : active.All(ticket => ReadOptionalString(ticket, "servedAt") is not null)
                ? "served"
                : active.All(ticket => ReadString(ticket, "status") is "ready" or "done")
                    ? "ready"
                    : active.Any(ticket => ReadString(ticket, "status") is "preparing" or "ready" or "done")
                        ? "preparing"
                        : "sent";
        foreach (var ticket in tickets)
        {
            if (ticket["order"] is JsonObject orderSummary) orderSummary["status"] = orderStatus;
        }
        var orderReference = FindOrderOrNull(root, orderId);
        if (orderReference is not null)
        {
            var order = orderReference.Value.Order;
            order["status"] = orderStatus;
            order["updatedAt"] = now;
        }
        return orderStatus;
    }

    private static void RefreshKdsMetrics(JsonObject kds)
    {
        var tickets = RequireArray(kds, "tickets").OfType<JsonObject>().ToArray();
        var metrics = kds["metrics"] as JsonObject ?? new JsonObject();
        metrics["total"] = tickets.Count(ticket => ReadString(ticket, "status") != "canceled");
        metrics["pending"] = tickets.Count(ticket => ReadString(ticket, "status") == "pending");
        metrics["preparing"] = tickets.Count(ticket => ReadString(ticket, "status") == "preparing");
        metrics["ready"] = tickets.Count(ticket => ReadString(ticket, "status") == "ready");
        metrics["expedition"] = tickets.Count(ticket =>
            ReadString(ticket, "status") == "done" &&
            ReadOptionalString(ticket, "handedOffAt") is not null &&
            ReadOptionalString(ticket, "servedAt") is null);
        metrics["rush"] = tickets.Count(ticket => ReadOptionalBoolean(ticket, "rush") == true);
        kds["metrics"] = metrics;

        var stationByTicket = tickets
            .Where(ticket => ReadString(ticket, "status") != "canceled")
            .ToDictionary(
                ticket => ReadString(ticket, "id"),
                ticket => ReadString(ticket, "stationId"),
                StringComparer.Ordinal);
        var allDayByProduct = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var row in RequireArray(kds, "items").OfType<JsonObject>())
        {
            var ticketId = ReadOptionalString(row, "ticketId");
            if (ticketId is null || !stationByTicket.TryGetValue(ticketId, out var stationId)) continue;
            var production = EnsureKdsProduction(row);
            var status = ReadString(production, "status");
            if (status == "canceled") continue;
            var item = RequireObject(row, "item");
            var productId = ReadOptionalString(row, "productId") ?? ReadString(item, "productId");
            var key = $"{stationId}:{productId}";
            if (!allDayByProduct.TryGetValue(key, out var entry))
            {
                entry = new JsonObject
                {
                    ["stationId"] = stationId,
                    ["productId"] = productId,
                    ["productName"] = ReadString(item, "productName"),
                    ["totalQuantity"] = 0,
                    ["queuedQuantity"] = 0,
                    ["preparingQuantity"] = 0,
                    ["readyQuantity"] = 0,
                    ["heldQuantity"] = 0,
                };
                allDayByProduct.Add(key, entry);
            }
            var quantity = ReadInt(production, "quantity", 1, 500);
            entry["totalQuantity"] = ReadLong(entry, "totalQuantity", 0) + quantity;
            if (ReadOptionalBoolean(production, "held") == true)
            {
                entry["heldQuantity"] = ReadLong(entry, "heldQuantity", 0) + quantity;
            }
            else if (status == "queued")
            {
                entry["queuedQuantity"] = ReadLong(entry, "queuedQuantity", 0) + quantity;
            }
            else if (status == "preparing")
            {
                var readyQuantity = ReadOptionalInt(production, "readyQuantity", 0, quantity) ?? 0;
                entry["readyQuantity"] = ReadLong(entry, "readyQuantity", 0) + readyQuantity;
                entry["preparingQuantity"] = ReadLong(entry, "preparingQuantity", 0) +
                    quantity - readyQuantity;
            }
            else if (status is "ready" or "served")
            {
                entry["readyQuantity"] = ReadLong(entry, "readyQuantity", 0) + quantity;
            }
        }
        var allDay = new JsonArray();
        foreach (var entry in allDayByProduct.Values
            .OrderBy(value => ReadString(value, "stationId"), StringComparer.Ordinal)
            .ThenByDescending(value => ReadLong(value, "totalQuantity", 0))
            .ThenBy(value => ReadString(value, "productName"), StringComparer.Ordinal))
        {
            allDay.Add(entry);
        }
        kds["allDay"] = allDay;
        RefreshKdsCapacity(kds, tickets);
    }

    private static void RefreshKdsCapacity(JsonObject kds, IReadOnlyCollection<JsonObject> tickets)
    {
        if (kds["stations"] is not JsonArray stations) return;
        var stationByTicket = tickets
            .Where(ticket => ReadString(ticket, "status") != "canceled" &&
                ReadOptionalString(ticket, "servedAt") is null)
            .ToDictionary(
                ticket => ReadString(ticket, "id"),
                ticket => ReadString(ticket, "stationId"),
                StringComparer.Ordinal);
        var activeRows = RequireArray(kds, "items").OfType<JsonObject>()
            .Where(row => ReadOptionalString(row, "ticketId") is { } ticketId &&
                stationByTicket.ContainsKey(ticketId))
            .Select(row => new
            {
                Row = row,
                StationId = stationByTicket[ReadString(row, "ticketId")],
                Production = EnsureKdsProduction(row),
            })
            .Where(entry => ReadString(entry.Production, "status") is "queued" or "preparing")
            .ToArray();
        foreach (var station in stations.OfType<JsonObject>())
        {
            if (station["capacity"] is not JsonObject capacity) continue;
            var stationId = ReadString(station, "id");
            var assignments = activeRows.Where(entry => entry.StationId == stationId).ToArray();
            capacity["activeAssignments"] = assignments.Length;
            capacity["blockedAssignments"] = assignments.Count(entry => IsKdsItemBlocked(entry.Row));
            capacity["queuedQuantity"] = assignments
                .Where(entry => ReadString(entry.Production, "status") == "queued" &&
                    ReadOptionalBoolean(entry.Production, "held") != true)
                .Sum(entry => ReadInt(entry.Production, "quantity", 1, 500));
            capacity["preparingQuantity"] = assignments
                .Where(entry => ReadString(entry.Production, "status") == "preparing")
                .Sum(entry =>
                {
                    var quantity = ReadInt(entry.Production, "quantity", 1, 500);
                    return quantity - (ReadOptionalInt(entry.Production, "readyQuantity", 0, quantity) ?? 0);
                });
        }
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

    private static int? ReadOptionalInt(JsonObject source, string property, int minimum, int maximum)
    {
        if (source[property] is null) return null;
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

    private static long? ReadOptionalLong(JsonObject source, string property, long minimum)
    {
        if (source[property] is null) return null;
        return ReadLong(source, property, minimum);
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
