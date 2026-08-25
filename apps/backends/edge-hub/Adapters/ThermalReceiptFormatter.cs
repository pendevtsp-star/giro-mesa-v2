using System.Globalization;
using System.Text.Json;

namespace GiroMesa.EdgeHub.Adapters;

public sealed record ThermalRasterGraphic(int WidthDots, int HeightDots, byte[] Data);

public sealed record ThermalPrintDocument(string Text, ThermalRasterGraphic? HeaderGraphic = null);

public static class ThermalReceiptFormatter
{
    private const int MaximumTextLength = 240;

    public static string Format(string documentType, JsonElement payload, int width) =>
        FormatDocument(documentType, payload, width).Text;

    public static ThermalPrintDocument FormatDocument(
        string documentType,
        JsonElement payload,
        int width)
    {
        width = Math.Clamp(width, 24, 64);
        if (documentType == "kds_ticket")
            return new(FormatKdsTicket(payload, width));

        var establishment = Object(payload, "establishment");
        var establishmentName = FirstText(establishment, "displayName", "tradeName", "name")
            ?? Text(payload, "establishmentName")
            ?? "GIROMESA";
        var lines = new List<string>();
        AddCenteredWrapped(lines, establishmentName.ToUpperInvariant(), width);
        AddCenteredWrapped(lines, FirstText(establishment, "legalName"), width);
        AddPrefixed(lines, "CNPJ: ", FirstText(establishment, "document", "cnpj"), width);
        AddPrefixed(lines, "END: ", Address(establishment), width);
        AddPrefixed(lines, "TEL: ", FirstText(establishment, "phone"), width);
        AddPrefixed(lines, "HORARIO: ", OpeningHours(establishment), width);
        lines.Add(Center(DocumentLabel(documentType), width));
        lines.Add(new('-', width));

        var tab = Object(payload, "tab");
        var context = Object(payload, "context");
        var totals = Object(payload, "totals");
        AddWrapped(lines, FirstText(tab, "label") ?? "Comanda", width);
        AddJoined(
            lines,
            width,
            FulfillmentLabel(FirstText(tab, "fulfillmentType")),
            PositiveNumber(tab, "guestCount") is { } guestCount ? $"{guestCount} pessoa(s)" : null);
        AddPrefixed(lines, "AREA: ", FirstText(context, "areaName"), width);
        AddPrefixed(lines, "PRACA: ", FirstText(context, "squareName"), width);
        AddPrefixed(lines, "ATENDENTE: ", FirstText(context, "waiterDisplayName", "waiterName"), width);

        var openedAt = Date(context, "openedAt") ?? Date(tab, "openedAt");
        var closedAt = Date(context, "closedAt") ?? Date(tab, "closedAt");
        var durationMinutes = PositiveNumber(context, "durationMinutes")
            ?? DurationMinutes(openedAt, closedAt ?? Date(payload, "generatedAt"));
        if (openedAt is not null)
            lines.Add($"INICIO: {LocalDateTime(openedAt.Value)}");
        if (durationMinutes is not null)
            lines.Add($"TEMPO DE CONSUMO: {Duration(durationMinutes.Value)}");
        var generatedAt = Date(payload, "generatedAt");
        if (generatedAt is not null)
            lines.Add($"IMPRESSO: {LocalDateTime(generatedAt.Value)}");
        lines.Add(new string('-', width));

        if (documentType != "payment_statement")
        {
            var topLevelModifiers = Array(payload, "modifiers").ToArray();
            foreach (var item in Array(payload, "items"))
            {
                if (Text(item, "status") == "canceled") continue;
                var quantity = Quantity(item, "quantity");
                var name = FirstText(item, "productName", "name") ?? "Item";
                AddColumnsWrapped(lines, $"{quantity}x {name}", Money(Number(item, "netCents")), width);
                var seat = PositiveNumber(item, "seatNumber");
                if (seat is not null) AddWrapped(lines, $"  Pessoa {seat}", width);

                var nestedModifiers = Array(item, "modifiers").ToArray();
                var itemId = Text(item, "id");
                var modifiers = nestedModifiers.Length > 0
                    ? nestedModifiers
                    : topLevelModifiers.Where(modifier =>
                        itemId is not null && Text(modifier, "orderItemId") == itemId);
                foreach (var modifier in modifiers)
                    AddModifier(lines, modifier, width);
            }
            lines.Add(new string('-', width));
            lines.Add(Columns("Subtotal", Money(Number(totals, "subtotalCents")), width));
            AddAmount(lines, "Descontos", Number(totals, "discountCents"), width);
            var optionalService = Boolean(totals, "serviceChargeOptional") ||
                Boolean(Object(payload, "serviceCharge"), "optional");
            AddAmount(
                lines,
                optionalService ? "Servico opcional" : "Servico",
                Number(totals, "serviceChargeCents"),
                width);
            AddAmount(lines, "Gorjeta", Number(totals, "tipCents"), width);
            if (optionalService && Number(totals, "serviceChargeCents") > 0 &&
                NullableNumber(totals, "suggestedTotalCents") is { } suggestedTotal)
                lines.Add(Columns("TOTAL SUGERIDO", Money(suggestedTotal), width));
            else
                lines.Add(Columns("TOTAL", Money(Number(totals, "totalCents")), width));
            AddWrapped(
                lines,
                FirstText(totals, "serviceTaxNotice")
                    ?? FirstText(Object(payload, "serviceCharge"), "notice")
                    ?? FirstText(establishment, "serviceTaxNotice"),
                width);
        }

        var split = FirstObject(payload, "split", "division");
        AddSplit(lines, split, width);

        var payments = Array(payload, "payments").ToArray();
        if (documentType != "partial_statement" || payments.Length > 0)
        {
            lines.Add(new string('-', width));
            lines.Add("PAGAMENTOS");
            foreach (var payment in payments)
            {
                var netAmount = NullableNumber(payment, "netAmountCents")
                    ?? Math.Max(0, Number(payment, "amountCents") - Number(payment, "reversedCents"));
                lines.Add(Columns(PaymentLabel(Text(payment, "method")), Money(netAmount), width));
                if (Number(payment, "reversedCents") > 0)
                    AddAmount(lines, "  Estornado", Number(payment, "reversedCents"), width);
            }
            if (payments.Length == 0) lines.Add("Nenhum pagamento registrado");
        }
        lines.Add(new string('-', width));
        lines.Add(Columns("Pago", Money(Number(totals, "paidCents")), width));
        lines.Add(Columns("Saldo", Money(Number(totals, "remainingCents")), width));
        lines.Add("");
        lines.Add(Center("NAO E DOCUMENTO FISCAL", width));
        if (documentType == "final_receipt") lines.Add(Center("ATENDIMENTO ENCERRADO", width));
        return new(string.Join('\n', lines), RasterGraphic(establishment));
    }

    private static string FormatKdsTicket(JsonElement payload, int width)
    {
        var station = Text(payload, "stationName") ?? "PRODUCAO";
        var reference = Text(payload, "reference") ?? "SEM REFERENCIA";
        var lines = new List<string>
        {
            Center(station.ToUpperInvariant(), width),
            Center($"PEDIDO {reference}", width),
        };
        if (Boolean(payload, "rush")) lines.Add(Center("*** RUSH ***", width));
        AddJoined(lines, width, Text(payload, "tableLabel"), Text(payload, "tabLabel"), Text(payload, "channel"));
        lines.Add(new string('-', width));
        foreach (var item in Array(payload, "items"))
        {
            AddWrapped(lines, $"{Quantity(item, "quantity")}x {Text(item, "productName") ?? "Item"}", width);
            foreach (var modifier in Array(item, "modifiers"))
            {
                if (modifier.ValueKind == JsonValueKind.String)
                    AddWrapped(lines, $"  + {modifier.GetString()}", width);
            }
            AddPrefixed(lines, "  OBS: ", Text(item, "notes"), width);
            AddPrefixed(lines, "  !! ALERGIA: ", Text(item, "allergyNote"), width);
            var seat = NullableNumber(item, "seatNumber");
            if (seat is not null) AddWrapped(lines, $"  Pessoa {seat}", width);
            lines.Add("");
        }
        lines.Add(new string('-', width));
        var dueAt = Date(payload, "dueAt");
        if (dueAt is not null) lines.Add($"PREVISAO: {dueAt.Value:HH:mm}");
        var generatedAt = Date(payload, "generatedAt");
        if (generatedAt is not null) lines.Add($"IMPRESSO: {LocalDateTime(generatedAt.Value)}");
        AddPrefixed(lines, "ID: ", Text(payload, "id"), width);
        return string.Join('\n', lines);
    }

    private static void AddModifier(List<string> lines, JsonElement modifier, int width)
    {
        if (modifier.ValueKind == JsonValueKind.String)
        {
            AddWrapped(lines, $"  + {modifier.GetString()}", width);
            return;
        }
        if (modifier.ValueKind != JsonValueKind.Object) return;
        var name = FirstText(modifier, "name", "label");
        if (name is null) return;
        var quantity = PositiveNumber(modifier, "quantity") ?? 1;
        var label = quantity > 1 ? $"  + {quantity}x {name}" : $"  + {name}";
        var amount = Number(modifier, "totalDeltaCents");
        if (amount == 0) AddWrapped(lines, label, width);
        else AddColumnsWrapped(lines, label, Money(amount), width);
    }

    private static void AddSplit(List<string> lines, JsonElement split, int width)
    {
        if (split.ValueKind != JsonValueKind.Object) return;
        var partNumber = PositiveNumber(split, "partNumber");
        var partCount = PositiveNumber(split, "partCount");
        var amount = NullableNumber(split, "amountCents");
        var parts = Array(split, "parts").ToArray();
        if (partNumber is null && partCount is null && amount is null && parts.Length == 0) return;

        lines.Add(new string('-', width));
        lines.Add(Center("DIVISAO DA CONTA", width));
        AddWrapped(lines, SplitLabel(FirstText(split, "method", "mode", "label")), width);
        if (partNumber is not null && partCount is not null)
            lines.Add(Center($"PARTE {partNumber} DE {partCount}", width));
        if (amount is not null)
            lines.Add(Columns("VALOR DESTA PARTE", Money(amount.Value), width));
        for (var index = 0; index < Math.Min(parts.Length, 20); index += 1)
        {
            var partAmount = NullableNumber(parts[index], "amountCents");
            if (partAmount is not null)
                lines.Add(Columns($"Parte {index + 1}", Money(partAmount.Value), width));
        }
    }

    private static ThermalRasterGraphic? RasterGraphic(JsonElement establishment)
    {
        var logo = Object(establishment, "logoRaster");
        if (logo.ValueKind != JsonValueKind.Object ||
            !string.Equals(Text(logo, "encoding"), "escpos-raster", StringComparison.OrdinalIgnoreCase) ||
            PositiveNumber(logo, "widthDots") is not { } widthDots ||
            PositiveNumber(logo, "heightDots") is not { } heightDots ||
            widthDots is > 576 || heightDots is > 512 ||
            RawText(logo, "dataBase64", 64 * 1024) is not { } encoded)
            return null;
        try
        {
            var data = Convert.FromBase64String(encoded);
            var expectedLength = checked(((widthDots + 7) / 8) * heightDots);
            return data.Length == expectedLength && data.Length <= 64 * 1024
                ? new((int)widthDots, (int)heightDots, data)
                : null;
        }
        catch (Exception exception) when (exception is FormatException or OverflowException)
        {
            return null;
        }
    }

    private static string? Address(JsonElement establishment)
    {
        if (Text(establishment, "address") is { } simpleAddress) return simpleAddress;
        var address = Object(establishment, "address");
        if (address.ValueKind != JsonValueKind.Object) return null;
        if (FirstText(address, "formatted", "text", "line") is { } formatted) return formatted;

        var street = FirstText(address, "street", "streetName", "line1");
        var number = FirstText(address, "number");
        var firstLine = Join(street, number);
        var secondLine = Join(
            FirstText(address, "complement"),
            FirstText(address, "district", "neighborhood"));
        var cityAndState = Join(
            FirstText(address, "city"),
            FirstText(address, "state", "stateCode"));
        return string.Join(" - ", new[]
        {
            firstLine,
            secondLine,
            cityAndState,
            FirstText(address, "postalCode", "zipCode"),
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
    }

    private static string? OpeningHours(JsonElement establishment)
    {
        if (FirstText(establishment, "openingHours", "businessHoursText") is { } text) return text;
        var hours = establishment.ValueKind == JsonValueKind.Object &&
            establishment.TryGetProperty("openingHours", out var value)
            ? value
            : default;
        return hours.ValueKind == JsonValueKind.Array
            ? string.Join(" | ", hours.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => Clean(item.GetString() ?? ""))
                .Where(item => item.Length > 0))
            : null;
    }

    private static void AddJoined(List<string> lines, int width, params string?[] values)
    {
        var value = string.Join(" | ", values.Where(candidate => !string.IsNullOrWhiteSpace(candidate)));
        if (value.Length > 0) AddWrapped(lines, value, width);
    }

    private static void AddPrefixed(List<string> lines, string prefix, string? value, int width)
    {
        if (!string.IsNullOrWhiteSpace(value)) AddWrapped(lines, prefix + value.Trim(), width);
    }

    private static void AddWrapped(List<string> lines, string? value, int width)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var remaining = Clean(value).Trim();
        while (remaining.Length > width)
        {
            var boundary = remaining.LastIndexOf(' ', width);
            if (boundary < 1) boundary = width;
            lines.Add(remaining[..boundary].TrimEnd());
            remaining = remaining[boundary..].TrimStart();
        }
        if (remaining.Length > 0) lines.Add(remaining);
    }

    private static void AddCenteredWrapped(List<string> lines, string? value, int width)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var wrapped = new List<string>();
        AddWrapped(wrapped, value, width);
        lines.AddRange(wrapped.Select(line => Center(line, width)));
    }

    private static void AddAmount(List<string> lines, string label, long amount, int width)
    {
        if (amount != 0) lines.Add(Columns(label, Money(amount), width));
    }

    private static void AddColumnsWrapped(List<string> lines, string left, string right, int width)
    {
        left = Clean(left);
        right = Clean(right);
        if (left.Length + right.Length + 1 <= width)
        {
            lines.Add(Columns(left, right, width));
            return;
        }
        AddWrapped(lines, left, width);
        lines.Add(right.PadLeft(width));
    }

    private static string Columns(string left, string right, int width)
    {
        left = Clean(left);
        right = Clean(right);
        var leftWidth = Math.Max(1, width - right.Length - 1);
        if (left.Length > leftWidth) left = left[..leftWidth];
        return left.PadRight(width - right.Length) + right;
    }

    private static string Center(string value, int width)
    {
        value = Clean(value);
        if (value.Length >= width) return value[..width];
        return value.PadLeft(value.Length + ((width - value.Length) / 2));
    }

    private static string Clean(string value)
    {
        var clean = new string(value.Where(character => !char.IsControl(character)).ToArray()).Trim();
        return clean.Length > MaximumTextLength ? clean[..MaximumTextLength] : clean;
    }

    private static string DocumentLabel(string type) => type switch
    {
        "partial_statement" => "PRE-CONTA",
        "payment_statement" => "EXTRATO DE PAGAMENTOS",
        "final_receipt" => "COMPROVANTE FINAL",
        _ => "DOCUMENTO OPERACIONAL",
    };

    private static string PaymentLabel(string? method) => method switch
    {
        "cash" => "Dinheiro",
        "credit_card" => "Credito",
        "debit_card" => "Debito",
        "pix" => "Pix",
        _ => "Outro",
    };

    private static string? FulfillmentLabel(string? type) => type switch
    {
        "dine_in" => "No salao",
        "takeaway" => "Retirada",
        "delivery" => "Entrega",
        "counter" => "Balcao",
        _ => null,
    };

    private static string? SplitLabel(string? method) => method?.ToLowerInvariant() switch
    {
        "equal" => "Divisao em partes iguais",
        "by_item" => "Divisao por itens",
        "custom" => "Divisao personalizada",
        { Length: > 0 } value => Clean(value),
        _ => null,
    };

    private static string Money(long cents) =>
        $"R$ {(cents / 100m).ToString("N2", CultureInfo.GetCultureInfo("pt-BR"))}";

    private static string Quantity(JsonElement source, string name)
    {
        if (source.ValueKind == JsonValueKind.Object &&
            source.TryGetProperty(name, out var value) &&
            value.TryGetDecimal(out var number))
            return number.ToString("0.###", CultureInfo.GetCultureInfo("pt-BR"));
        return "0";
    }

    private static string LocalDateTime(DateTimeOffset value) =>
        value.ToString("dd/MM/yyyy HH:mm", CultureInfo.GetCultureInfo("pt-BR"));

    private static string Duration(long minutes)
    {
        var hours = minutes / 60;
        var remainder = minutes % 60;
        return hours > 0 ? $"{hours}h {remainder:00}min" : $"{remainder}min";
    }

    private static long? DurationMinutes(DateTimeOffset? start, DateTimeOffset? end)
    {
        if (start is null || end is null || end < start) return null;
        return Math.Max(0, (long)Math.Floor((end.Value - start.Value).TotalMinutes));
    }

    private static string? Join(params string?[] values)
    {
        var joined = string.Join(", ", values.Where(value => !string.IsNullOrWhiteSpace(value)));
        return joined.Length == 0 ? null : joined;
    }

    private static JsonElement Object(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : default;

    private static JsonElement FirstObject(JsonElement source, params string[] names)
    {
        foreach (var name in names)
        {
            var value = Object(source, name);
            if (value.ValueKind == JsonValueKind.Object) return value;
        }
        return default;
    }

    private static IEnumerable<JsonElement> Array(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray()
            : [];

    private static string? Text(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? Clean(value.GetString() ?? "")
            : null;

    private static string? RawText(JsonElement source, string name, int maximumLength)
    {
        if (source.ValueKind != JsonValueKind.Object ||
            !source.TryGetProperty(name, out var value) ||
            value.ValueKind != JsonValueKind.String)
            return null;
        var text = value.GetString();
        return !string.IsNullOrWhiteSpace(text) &&
            text.Length <= maximumLength &&
            text.All(character => !char.IsControl(character))
                ? text
                : null;
    }

    private static string? FirstText(JsonElement source, params string[] names)
    {
        foreach (var name in names)
        {
            var value = Text(source, name);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return null;
    }

    private static long Number(JsonElement source, string name) =>
        NullableNumber(source, name) ?? 0;

    private static long? PositiveNumber(JsonElement source, string name) =>
        NullableNumber(source, name) is > 0 and var value ? value : null;

    private static long? NullableNumber(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.TryGetInt64(out var number)
            ? number
            : null;

    private static bool Boolean(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.True;

    private static DateTimeOffset? Date(JsonElement source, string name) =>
        DateTimeOffset.TryParse(Text(source, name), out var value) ? value : null;
}
