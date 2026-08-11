using System.Text.Json;
using System.Text.Json.Nodes;

namespace GiroMesa.EdgeHub;

internal sealed record PilotSyncMetadata(
    IReadOnlyList<ResourcePrecondition> Resources,
    IReadOnlyList<PriceReference> PriceReferences,
    string PrimaryResourceId)
{
    public ResourcePrecondition Primary => Resources.Single(resource =>
        resource.Type == "tab" && resource.Id == PrimaryResourceId);

    public static PilotSyncMetadata? TryDerive(OperationalSnapshot snapshot, OperationalCommand command)
    {
        if (!OperationalProjection.IsPilotMutation(command.Payload)) return null;
        var root = JsonNode.Parse(snapshot.Serialize())!.AsObject();
        var knownResources = (root["tabs"]?.AsArray().OfType<JsonObject>() ?? [])
            .Concat(root["floor"]?["tables"]?.AsArray().OfType<JsonObject>() ?? []);
        if (knownResources.Any(node =>
                OptionalString(node, "occupancyEpoch") is null ||
                OptionalInt(node, "resourceVersion") is null))
            return null;
        var envelope = JsonNode.Parse(command.Payload.GetRawText())!.AsObject();
        var action = envelope["action"]?.GetValue<string>()
            ?? throw new OperationalConflictException("INVALID_OFFLINE_PAYLOAD");
        var data = envelope["data"]?.AsObject()
            ?? throw new OperationalConflictException("INVALID_OFFLINE_PAYLOAD");
        var requested = new List<(string Type, string Id, bool CreatesResource)>();
        var priceReferences = new List<PriceReference>();

        switch (action)
        {
            case "open-tab":
                requested.Add(("tab", command.Id, true));
                AddOptionalTable(requested, data["body"]?.AsObject(), root);
                break;
            case "create-order":
                requested.Add(("tab", Required(data, "tabId"), false));
                CollectPriceReferences(root, data, priceReferences);
                break;
            case "send-order":
                requested.Add(("tab", TabForOrder(root, Required(data, "orderId")), false));
                break;
            case "transfer-tab":
            {
                var tabId = Required(data, "tabId");
                requested.Add(("tab", tabId, false));
                var currentTable = OptionalString(FindTab(root, tabId), "tableId");
                if (currentTable is not null) requested.Add(("table", currentTable, false));
                AddOptionalTable(requested, data["body"]?.AsObject(), root, required: true);
                break;
            }
            case "merge-tabs":
            {
                var body = data["body"]?.AsObject() ?? throw Conflict();
                var tabIds = new[] { Required(body, "targetTabId") }
                    .Concat(body["sourceTabIds"]?.AsArray().Select(node => node!.GetValue<string>()) ?? [])
                    .Distinct(StringComparer.Ordinal);
                foreach (var tabId in tabIds)
                {
                    requested.Add(("tab", tabId, false));
                    var tableId = OptionalString(FindTab(root, tabId), "tableId");
                    if (tableId is not null) requested.Add(("table", tableId, false));
                }
                break;
            }
            case "split-tab":
                requested.Add(("tab", Required(data, "tabId"), false));
                requested.Add(("tab", command.Id, true));
                AddOptionalTable(requested, data["body"]?.AsObject(), root);
                break;
            case "service-charge":
            case "tip":
                requested.Add(("tab", Required(data, "tabId"), false));
                break;
            case "discount-item":
            case "cancel-item":
                requested.Add(("tab", TabForItem(root, Required(data, "itemId")), false));
                break;
            case "transition-kds":
                requested.Add(("tab", TabForTicket(root, Required(data, "ticketId")), false));
                break;
            default:
                throw new OperationalConflictException("OFFLINE_ACTION_UNSUPPORTED");
        }

        var resources = new List<ResourcePrecondition>();
        foreach (var entry in requested.DistinctBy(item => (item.Type, item.Id)))
        {
            if (entry.CreatesResource)
            {
                resources.Add(new(
                    entry.Type,
                    entry.Id,
                    OperationalProjection.StableId(command.Id, "occupancy-epoch", entry.Id),
                    0));
                continue;
            }
            var node = entry.Type == "tab" ? FindTab(root, entry.Id) : FindTable(root, entry.Id);
            var epoch = OptionalString(node, "occupancyEpoch");
            var version = OptionalInt(node, "resourceVersion");
            // A command accepted against an N-1 snapshot remains a conservative V1 command.
            if (epoch is null || version is null) return null;
            resources.Add(new(entry.Type, entry.Id, epoch, version.Value));
        }
        var primaryResourceId = requested.First(item => item.Type == "tab").Id;
        var uniquePriceReferences = priceReferences
            .DistinctBy(item => (item.Kind, item.EntityId, item.PriceRevision))
            .OrderBy(item => item.Kind, StringComparer.Ordinal)
            .ThenBy(item => item.EntityId, StringComparer.Ordinal)
            .ThenBy(item => item.PriceRevision, StringComparer.Ordinal)
            .ToArray();
        return new(
            resources.OrderBy(item => item.Type, StringComparer.Ordinal).ThenBy(item => item.Id, StringComparer.Ordinal).ToArray(),
            uniquePriceReferences,
            primaryResourceId);
    }

    public OperationalSnapshot AdvanceProjection(OperationalSnapshot projected)
    {
        var root = JsonNode.Parse(projected.Serialize())!.AsObject();
        foreach (var resource in Resources)
        {
            foreach (var node in ResourceNodes(root, resource.Type, resource.Id))
            {
                node["occupancyEpoch"] = resource.OccupancyEpoch;
                node["resourceVersion"] = checked(resource.ResourceVersion + 1);
            }
        }
        return OperationalSnapshot.Deserialize(root.ToJsonString(OperationalSnapshot.JsonOptions));
    }

    private static IEnumerable<JsonObject> ResourceNodes(JsonObject root, string type, string id)
    {
        if (type == "table")
        {
            var table = FindTable(root, id);
            if (table is not null) yield return table;
            yield break;
        }
        var seen = new HashSet<JsonObject>(ReferenceEqualityComparer.Instance);
        foreach (var candidate in new JsonNode?[]
        {
            FindById(root["tabs"]?.AsArray(), id),
            FindById(root["floor"]?["openTabs"]?.AsArray(), id),
            root["tabDetails"]?[id]?["tab"],
        })
        {
            if (candidate is JsonObject node && seen.Add(node)) yield return node;
        }
    }

    private static void CollectPriceReferences(
        JsonObject root,
        JsonObject data,
        List<PriceReference> references)
    {
        var body = data["body"]?.AsObject() ?? throw Conflict();
        var items = body["items"]?.AsArray() ?? throw Conflict();
        foreach (var itemNode in items)
        {
            var item = itemNode?.AsObject() ?? throw Conflict();
            var productId = Required(item, "productId");
            var price = FindBy(root["catalog"]?["prices"]?.AsArray(), "productId", productId)
                ?? throw new OperationalConflictException("PRODUCT_PRICE_NOT_CONFIGURED");
            references.Add(new("product", productId,
                OptionalString(price, "priceRevision")
                    ?? throw new OperationalConflictException("PRICE_REFERENCE_UNAVAILABLE"),
                OptionalString(price, "priceReference")
                    ?? throw new OperationalConflictException("PRICE_REFERENCE_UNAVAILABLE")));
            foreach (var optionId in item["modifierOptionIds"]?.AsArray()
                         .Select(node => node!.GetValue<string>()) ?? [])
            {
                var option = FindById(root["catalog"]?["modifierOptions"]?.AsArray(), optionId)
                    ?? throw new OperationalConflictException("INVALID_MODIFIER_SELECTION");
                references.Add(new("modifier-option", optionId,
                    OptionalString(option, "priceRevision")
                        ?? throw new OperationalConflictException("PRICE_REFERENCE_UNAVAILABLE"),
                    OptionalString(option, "priceReference")
                        ?? throw new OperationalConflictException("PRICE_REFERENCE_UNAVAILABLE")));
            }
        }
    }

    private static void AddOptionalTable(
        List<(string Type, string Id, bool CreatesResource)> requested,
        JsonObject? body,
        JsonObject root,
        bool required = false)
    {
        var tableId = OptionalString(body, "tableId");
        if (tableId is null)
        {
            if (required) throw new OperationalConflictException("TARGET_TABLE_PRECONDITION_REQUIRED");
            return;
        }
        if (FindTable(root, tableId) is null) throw new OperationalConflictException("TABLE_NOT_FOUND");
        requested.Add(("table", tableId, false));
    }

    private static string TabForOrder(JsonObject root, string orderId)
    {
        foreach (var pair in root["tabDetails"]?.AsObject() ?? [])
            if (FindById(pair.Value?["orders"]?.AsArray(), orderId) is not null) return pair.Key;
        throw new OperationalConflictException("ORDER_NOT_FOUND");
    }

    private static string TabForItem(JsonObject root, string itemId)
    {
        foreach (var pair in root["tabDetails"]?.AsObject() ?? [])
            if (FindById(pair.Value?["items"]?.AsArray(), itemId) is not null) return pair.Key;
        throw new OperationalConflictException("ORDER_ITEM_NOT_FOUND");
    }

    private static string TabForTicket(JsonObject root, string ticketId)
    {
        var ticket = FindById(root["kds"]?["tickets"]?.AsArray(), ticketId)
            ?? throw new OperationalConflictException("KDS_TICKET_NOT_FOUND");
        return TabForOrder(root, Required(ticket, "orderId"));
    }

    private static JsonObject FindTab(JsonObject root, string id) =>
        FindById(root["tabs"]?.AsArray(), id)
        ?? root["tabDetails"]?[id]?["tab"]?.AsObject()
        ?? throw new OperationalConflictException("TAB_NOT_FOUND");

    private static JsonObject? FindTable(JsonObject root, string id) =>
        FindById(root["floor"]?["tables"]?.AsArray(), id);

    private static JsonObject? FindById(JsonArray? array, string id) =>
        array?.OfType<JsonObject>().FirstOrDefault(node => OptionalString(node, "id") == id);

    private static JsonObject? FindBy(JsonArray? array, string field, string value) =>
        array?.OfType<JsonObject>().FirstOrDefault(node => OptionalString(node, field) == value);

    private static string Required(JsonObject node, string field) =>
        OptionalString(node, field) ?? throw Conflict();

    private static string? OptionalString(JsonObject? node, string field) =>
        node?[field] is JsonValue value && value.TryGetValue<string>(out var result) ? result : null;

    private static int? OptionalInt(JsonObject? node, string field) =>
        node?[field] is JsonValue value && value.TryGetValue<int>(out var result) ? result : null;

    private static OperationalConflictException Conflict() => new("INVALID_OFFLINE_PAYLOAD");
}
