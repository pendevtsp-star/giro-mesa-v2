using System.Globalization;
using System.Text.Json;

namespace GiroMesa.EdgeHub.Adapters;

public static class ThermalReceiptFormatter
{
    public static string Format(string documentType, JsonElement payload, int width)
    {
        width = Math.Clamp(width, 24, 64);
        if (documentType == "kds_ticket") return FormatKdsTicket(payload, width);
        var lines = new List<string>
        {
            Center("GIROMESA", width),
            Center(DocumentLabel(documentType), width),
            new('-', width),
        };
        var tab = Object(payload, "tab");
        var totals = Object(payload, "totals");
        Add(lines, Text(tab, "label"), width);
        Add(lines, Text(tab, "customerName"), width);
        Add(lines, DateLine(payload), width);
        lines.Add(new string('-', width));

        if (documentType != "payment_statement")
        {
            foreach (var item in Array(payload, "items"))
            {
                if (Text(item, "status") == "canceled") continue;
                var quantity = Number(item, "quantity");
                var name = Text(item, "productName") ?? "Item";
                lines.Add(Columns($"{quantity}x {name}", Money(Number(item, "netCents")), width));
            }
            lines.Add(new string('-', width));
            lines.Add(Columns("Subtotal", Money(Number(totals, "subtotalCents")), width));
            AddAmount(lines, "Descontos", Number(totals, "discountCents"), width);
            AddAmount(lines, "Servico", Number(totals, "serviceChargeCents"), width);
            AddAmount(lines, "Gorjeta", Number(totals, "tipCents"), width);
            lines.Add(Columns("TOTAL", Money(Number(totals, "totalCents")), width));
        }

        var payments = Array(payload, "payments").ToArray();
        if (documentType != "partial_statement" || payments.Length > 0)
        {
            lines.Add(new string('-', width));
            lines.Add("PAGAMENTOS");
            foreach (var payment in payments)
                lines.Add(Columns(PaymentLabel(Text(payment, "method")), Money(Number(payment, "amountCents")), width));
            if (payments.Length == 0) lines.Add("Nenhum pagamento registrado");
        }
        lines.Add(new string('-', width));
        lines.Add(Columns("Pago", Money(Number(totals, "paidCents")), width));
        lines.Add(Columns("Saldo", Money(Number(totals, "remainingCents")), width));
        lines.Add("");
        lines.Add(Center("NAO E DOCUMENTO FISCAL", width));
        if (documentType == "final_receipt") lines.Add(Center("ATENDIMENTO ENCERRADO", width));
        return string.Join('\n', lines);
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
            AddWrapped(lines, $"{Number(item, "quantity")}x {Text(item, "productName") ?? "Item"}", width);
            foreach (var modifier in Array(item, "modifiers"))
                if (modifier.ValueKind == JsonValueKind.String)
                    AddWrapped(lines, $"  + {modifier.GetString()}", width);
            AddPrefixed(lines, "  OBS: ", Text(item, "notes"), width);
            AddPrefixed(lines, "  !! ALERGIA: ", Text(item, "allergyNote"), width);
            var seat = NullableNumber(item, "seatNumber");
            if (seat is not null) AddWrapped(lines, $"  Pessoa {seat}", width);
            lines.Add("");
        }
        lines.Add(new string('-', width));
        var dueAt = Date(payload, "dueAt");
        if (dueAt is not null) lines.Add($"PREVISAO: {dueAt.Value.ToLocalTime():HH:mm}");
        var generatedAt = Date(payload, "generatedAt");
        if (generatedAt is not null) lines.Add($"IMPRESSO: {generatedAt.Value.ToLocalTime():dd/MM/yyyy HH:mm}");
        AddPrefixed(lines, "ID: ", Text(payload, "id"), width);
        return string.Join('\n', lines);
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

    private static void AddWrapped(List<string> lines, string value, int width)
    {
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

    private static void Add(List<string> lines, string? value, int width)
    {
        if (!string.IsNullOrWhiteSpace(value)) lines.Add(Fit(value.Trim(), width));
    }

    private static void AddAmount(List<string> lines, string label, long amount, int width)
    {
        if (amount != 0) lines.Add(Columns(label, Money(amount), width));
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

    private static string Fit(string value, int width)
    {
        var clean = Clean(value);
        return clean.Length > width ? clean[..width] : clean;
    }

    private static string Clean(string value) =>
        new(value.Where(character => !char.IsControl(character)).ToArray());

    private static string DateLine(JsonElement payload)
    {
        var value = Text(payload, "generatedAt");
        return DateTimeOffset.TryParse(value, out var parsed)
            ? parsed.ToLocalTime().ToString("dd/MM/yyyy HH:mm", CultureInfo.GetCultureInfo("pt-BR"))
            : "";
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

    private static string Money(long cents) =>
        $"R$ {(cents / 100m).ToString("N2", CultureInfo.GetCultureInfo("pt-BR"))}";

    private static JsonElement Object(JsonElement source, string name) =>
        source.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : default;

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

    private static long Number(JsonElement source, string name) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(name, out var value) &&
        value.TryGetInt64(out var number)
            ? number
            : 0;

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
