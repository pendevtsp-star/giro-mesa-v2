using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GiroMesa.EdgeHub.Adapters;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class ThermalReceiptFormatterTests
{
    [Theory]
    [InlineData("partial_statement", 32)]
    [InlineData("partial_statement", 48)]
    [InlineData("payment_statement", 32)]
    [InlineData("payment_statement", 48)]
    [InlineData("final_receipt", 32)]
    [InlineData("final_receipt", 48)]
    public void PrintsRecordedCashExchangeWithoutAddingItToPaidOrBalance(string type, int width)
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            totals = new { totalCents = 10000, paidCents = 5000, remainingCents = 5000 },
            payments = new[] { new { method = "cash", amountCents = 5000, receivedCents = 7000, changeCents = 2000 } },
        });
        var receipt = ThermalReceiptFormatter.Format(type, payload, width);
        var content = System.Text.RegularExpressions.Regex.Replace(receipt, @"\s+", " ");
        Assert.Contains("Dinheiro R$ 50,00 Recebido em dinheiro R$ 70,00 Troco R$ 20,00", content);
        Assert.Contains("Pago R$ 50,00 Saldo R$ 50,00", content);
        Assert.All(receipt.Split('\n'), line => Assert.True(line.Length <= width, line));
    }

    [Theory]
    [InlineData(2000)]
    [InlineData(5000)]
    public void KeepsOriginalCashExchangeSeparateFromReversedAndNetAmounts(int reversedCents)
    {
        var netAmountCents = 5000 - reversedCents;
        var payload = JsonSerializer.SerializeToElement(new
        {
            payments = new[] { new { method = "cash", amountCents = netAmountCents, netAmountCents, reversedCents, receivedCents = 7000, changeCents = 2000 } },
        });
        var receipt = ThermalReceiptFormatter.Format("payment_statement", payload, 32);
        var content = System.Text.RegularExpressions.Regex.Replace(receipt, @"\s+", " ");
        Assert.Contains($"Dinheiro (liquido) R$ {netAmountCents / 100},00 Estornado R$ {reversedCents / 100},00", content);
        Assert.Contains("Recebimento original Recebido em dinheiro R$ 70,00 Troco R$ 20,00", content);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"receivedCents":null,"changeCents":null}""")]
    [InlineData("""{"receivedCents":7000}""")]
    [InlineData("""{"changeCents":2000}""")]
    [InlineData("""{"receivedCents":"7000","changeCents":2000}""")]
    [InlineData("""{"receivedCents":7000.1,"changeCents":2000.1}""")]
    [InlineData("""{"receivedCents":5000,"changeCents":-1}""")]
    [InlineData("""{"receivedCents":7000,"changeCents":1000}""")]
    [InlineData("""{"method":"pix","receivedCents":7000,"changeCents":2000}""")]
    public void OmitsUnknownOrInvalidCashExchangeWithoutInventingZeroChange(string fields)
    {
        var payment = JsonNode.Parse("""{"method":"cash","amountCents":5000,"reference":"Recebido 70; troco 20"}""")!;
        foreach (var field in JsonNode.Parse(fields)!.AsObject()) payment[field.Key] = field.Value?.DeepClone();
        var payload = JsonSerializer.SerializeToElement(new { payments = new[] { payment } });
        var receipt = ThermalReceiptFormatter.Format("final_receipt", payload, 32);
        Assert.DoesNotContain("Recebido em dinheiro", receipt);
        Assert.DoesNotContain("Troco", receipt);
    }

    [Fact]
    public void PrintsZeroChangeOnlyWhenRecorded()
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            payments = new[] { new { method = "cash", amountCents = 5000, receivedCents = 5000, changeCents = 0 } },
        });
        var receipt = ThermalReceiptFormatter.Format("final_receipt", payload, 32);
        Assert.Contains("Troco R$ 0,00", System.Text.RegularExpressions.Regex.Replace(receipt, @"\s+", " "));
    }

    [Theory]
    [InlineData("partial_statement", 32)]
    [InlineData("partial_statement", 48)]
    [InlineData("final_receipt", 32)]
    [InlineData("final_receipt", 48)]
    public void ShowsGrossItemsAndOneAggregateDiscountWithServiceAndTip(string type, int width)
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            items = new[] { new { productName = "Espresso", quantity = 2, grossCents = 1800, discountCents = 300, netCents = 1500 } },
            totals = new { subtotalCents = 1800, discountCents = 300, serviceChargeCents = 150, serviceChargeOptional = true, tipCents = 200, totalCents = 1850, suggestedTotalCents = 1850 },
        });
        var receipt = ThermalReceiptFormatter.Format(type, payload, width);
        var content = System.Text.RegularExpressions.Regex.Replace(receipt, @"\s+", " ");
        Assert.Contains("2x Espresso R$ 18,00", content);
        Assert.Contains("Subtotal R$ 18,00 Descontos R$ -3,00", content);
        Assert.Single(receipt.Split('\n'), line => line.StartsWith("Descontos"));
        Assert.Contains("Servico opcional R$ 1,50 Gorjeta R$ 2,00", content);
        Assert.Contains(type == "partial_statement" ? "TOTAL SUGERIDO R$ 18,50" : "TOTAL R$ 18,50", content);
        if (type == "final_receipt") Assert.DoesNotContain("TOTAL SUGERIDO", receipt);
        Assert.All(receipt.Split('\n'), line => Assert.True(line.Length <= width, line));

        var removed = JsonNode.Parse(payload.GetRawText())!;
        removed["totals"]!["serviceChargeCents"] = 0;
        removed["totals"]!["serviceChargeOptional"] = false;
        removed["totals"]!["totalCents"] = 1700;
        removed["totals"]!["suggestedTotalCents"] = 1700;
        var withoutService = ThermalReceiptFormatter.Format(type, JsonSerializer.SerializeToElement(removed), width);
        Assert.DoesNotContain("Servico", withoutService);
        Assert.DoesNotContain("TOTAL SUGERIDO", withoutService);
        Assert.Contains("Gorjeta", withoutService);
        Assert.Contains("TOTAL R$ 17,00", System.Text.RegularExpressions.Regex.Replace(withoutService, @"\s+", " "));
    }

    [Theory]
    [InlineData("delivery_slip", 32)]
    [InlineData("delivery_slip", 48)]
    [InlineData("partial_statement", 32)]
    [InlineData("partial_statement", 48)]
    [InlineData("payment_statement", 32)]
    [InlineData("payment_statement", 48)]
    [InlineData("final_receipt", 32)]
    [InlineData("final_receipt", 48)]
    public void PrintsVersionTwoSnapshotAndKeepsDeliveryDetailsInTheDeliveryCopy(string type, int width)
    {
        var source = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "delivery-receipt.json")))!;
        if (type != "delivery_slip")
        {
            source["context"]!["label"] = "Mesa 12";
            source["context"]!["displayNumber"] = 12;
            source["context"]!["fulfillmentType"] = "dine_in";
            source["totals"]!["deliveryFeeCents"] = 0;
            source["totals"]!["totalCents"] = 4000;
            source["totals"]!["suggestedTotalCents"] = 4000;
            source["totals"]!["remainingCents"] = 2000;
        }
        if (type == "final_receipt")
        {
            source["context"]!["status"] = "closed";
            source["totals"]!["grossPaidCents"] = 4000;
            source["totals"]!["paidCents"] = 4000;
            source["totals"]!["remainingCents"] = 0;
            source["payments"]![0]!["amountCents"] = 4000;
        }
        var payload = JsonSerializer.SerializeToElement(source);
        Assert.False(payload.TryGetProperty("tab", out _));
        var document = ThermalReceiptFormatter.FormatDocument(type, payload, width);
        var content = System.Text.RegularExpressions.Regex.Replace(document.Text, @"\s+", " ");
        Assert.NotNull(document.HeaderGraphic);
        Assert.Contains("CASA GIRO CENTRO", document.Text);
        Assert.Contains("SEGUNDA VIA", document.Text);
        Assert.Contains(type == "delivery_slip" ? "Delivery 014" : "Mesa 12", document.Text);
        Assert.Contains(type == "delivery_slip" ? "PEDIDO 14" : "PEDIDO 12", document.Text);
        Assert.Contains(type == "final_receipt" ? "STATUS: ENCERRADO" : "STATUS: ABERTO", document.Text);
        Assert.Contains("18/09/2026 15:45", document.Text);
        Assert.Contains(type == "final_receipt" ? "R$ 40,00" : "R$ 20,00", document.Text);
        Assert.Contains(type == "delivery_slip" ? "R$ 27,00" : type == "final_receipt" ? "R$ 0,00" : "R$ 20,00", document.Text);
        Assert.All(document.Text.Split('\n'), line => Assert.True(line.Length <= width, line));
        if (type == "delivery_slip")
        {
            foreach (var value in new[] { "VIA DE ENTREGA", "SAIU PARA ENTREGA", "Cliente de exemplo", "99999-1234", "Rua das Flores", "100", "Apto 302", "Boa Vista", "Recife", "PE", "50050-000", "Portaria azul", "Chamar na portaria", "Entregador de exemplo", "Molho separado", "Queijo extra", "Taxa de entrega", "R$ 7,00", "R$ 47,00", "18/09/2026 16:00" })
                Assert.Contains(value, content);
        }
        else
        {
            foreach (var value in new[] { "Cliente de exemplo", "99999-1234", "Rua das Flores", "Portaria azul", "Chamar na portaria", "Entregador de exemplo", "Molho separado" })
                Assert.DoesNotContain(value, document.Text);
        }
        var output = Path.Combine(AppContext.BaseDirectory, "receipt-previews");
        Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output, $"{type}-{(width == 32 ? 58 : 80)}mm.txt"), document.Text);
    }

    [Theory]
    [InlineData(32)]
    [InlineData(48)]
    public void KitchenCopyHasIdentityAndExceptionsButNeverDeliveryContactOrAddress(int width)
    {
        var source = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "delivery-receipt.json")))!;
        source["stationName"] = "Cozinha";
        source["reference"] = "014";
        source["status"] = "preparing";
        source["channel"] = "Delivery";
        source["rush"] = true;
        source["items"]![0]!["allergyNote"] = "Amendoim";
        var document = ThermalReceiptFormatter.FormatDocument("kds_ticket", JsonSerializer.SerializeToElement(source), width);
        foreach (var value in new[] { "CASA GIRO CENTRO", "CNPJ:", "PEDIDO 014", "COZINHA", "SEGUNDA VIA", "STATUS: EM PREPARO", "RUSH", "Molho separado", "ALERGIA: Amendoim", "Queijo extra" })
            Assert.Contains(value, document.Text);
        foreach (var value in new[] { "Cliente de exemplo", "99999-1234", "Rua das Flores", "Portaria azul", "Chamar na portaria", "Entregador de exemplo" })
            Assert.DoesNotContain(value, document.Text);
        Assert.NotNull(document.HeaderGraphic);
        Assert.DoesNotContain("R$", document.Text);
        Assert.All(document.Text.Split('\n'), line => Assert.True(line.Length <= width, line));
        var output = Path.Combine(AppContext.BaseDirectory, "receipt-previews");
        Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(output, $"kds_ticket-{(width == 32 ? 58 : 80)}mm.txt"), document.Text);
    }

    [Theory]
    [InlineData("invalid", 16, 2)]
    [InlineData("/w==", 16, 2)]
    [InlineData("/wAA/w==", 0, 2)]
    [InlineData("/wAA/w==", 577, 2)]
    [InlineData("/wAA/w==", 16, 513)]
    public void InvalidRasterFallsBackToTheEstablishmentText(string data, int width, int height)
    {
        var payload = JsonSerializer.SerializeToElement(new { establishment = new { displayName = "Casa Giro", logoRaster = new { encoding = "escpos-raster", widthDots = width, heightDots = height, dataBase64 = data } } });
        var document = ThermalReceiptFormatter.FormatDocument("partial_statement", payload, 32);
        Assert.Null(document.HeaderGraphic);
        Assert.Contains("CASA GIRO", document.Text);
    }

    [Fact]
    public void RasterThatExceedsPaperWidthFallsBackWithoutLosingText()
    {
        var document = new ThermalPrintDocument("CASA GIRO", new(576, 1, new byte[72]));
        var bytes = EscPosDocument.Render(document, 32, 16, false, true, 384);
        Assert.Equal(EscPosDocument.Render(document.Text, 32, 16, false), bytes);
        Assert.Contains("CASA GIRO", Encoding.Latin1.GetString(bytes));
    }

    [Fact]
    public void MissingOptionalFieldsAndMalformedNumbersDoNotBreakReceiptPrinting()
    {
        var payload = JsonDocument.Parse("""{"establishment":{"displayName":"Casa Giro","legalName":"Casa Giro","document":null,"address":{},"phone":""},"context":{"label":"Mesa 8","guestCount":null},"totals":{"paidCents":null},"items":[{"quantity":null,"netCents":"invalid","productName":"Produto"}]}""").RootElement;
        var receipt = ThermalReceiptFormatter.Format("partial_statement", payload, 32);
        Assert.DoesNotContain("CNPJ:", receipt);
        Assert.DoesNotContain("END:", receipt);
        Assert.DoesNotContain("TEL:", receipt);
        Assert.DoesNotContain("null", receipt);
        Assert.Equal(1, receipt.Split('\n').Count(line => line.Trim().Equals("CASA GIRO", StringComparison.OrdinalIgnoreCase)));
    }

    [Fact]
    public void PreservesTheFullAllowedDeliveryObservationAcrossWrappedLines()
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            delivery = new { notes = new string('a', 460) + " FIM DA OBSERVACAO" },
        });
        var receipt = ThermalReceiptFormatter.Format("delivery_slip", payload, 32);
        Assert.Contains("FIM DA OBSERVACAO", receipt);
        Assert.All(receipt.Split('\n'), line => Assert.True(line.Length <= 32, line));
    }
}
