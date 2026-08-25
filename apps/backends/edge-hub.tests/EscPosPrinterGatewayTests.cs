using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class EscPosPrinterGatewayTests
{
    [Fact]
    public async Task SendsEscPosBytesToAConfiguredNetworkPrinter()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var received = Task.Run(async () =>
        {
            using var client = await listener.AcceptTcpClientAsync();
            await using var stream = client.GetStream();
            await using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer);
            return buffer.ToArray();
        });
        var gateway = new EscPosPrinterGateway(
            Options.Create(new HubOptions
            {
                Printer = new PrinterOptions
                {
                    Enabled = true,
                    Id = "caixa",
                    Host = IPAddress.Loopback.ToString(),
                    Port = port,
                    PaperWidthMm = 80,
                    CharactersPerLine = 48,
                },
            }),
            NullLogger<EscPosPrinterGateway>.Instance);
        var payload = JsonDocument.Parse("{\"tab\":{\"label\":\"Mesa 1\"},\"totals\":{},\"items\":[],\"payments\":[]}")
            .RootElement.Clone();

        var result = await gateway.PrintAsync(
            new PrintRequest("job-1:1", null, "counter", "partial_statement", payload));
        var bytes = await received;
        listener.Stop();

        Assert.True(result.Success);
        Assert.Equal("accepted", result.Status);
        Assert.Equal("caixa", result.PrinterId);
        Assert.Equal(bytes.Length, result.BytesWritten);
        Assert.True(bytes.Length > 20);
    }

    [Fact]
    public async Task RoutesByStationAndUsesFallbackOnlyWhenThePrimaryIsUnreachable()
    {
        var unavailable = new TcpListener(IPAddress.Loopback, 0);
        unavailable.Start();
        var unavailablePort = ((IPEndPoint)unavailable.LocalEndpoint).Port;
        unavailable.Stop();
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var fallbackPort = ((IPEndPoint)listener.LocalEndpoint).Port;
        var received = Task.Run(async () =>
        {
            using var client = await listener.AcceptTcpClientAsync();
            await using var stream = client.GetStream();
            var buffer = new byte[4096];
            return await stream.ReadAsync(buffer);
        });
        var gateway = new EscPosPrinterGateway(
            Options.Create(new HubOptions
            {
                Printers =
                [
                    new PrinterOptions
                    {
                        Enabled = true,
                        Id = "bar-primary",
                        Host = IPAddress.Loopback.ToString(),
                        Port = unavailablePort,
                        PaperWidthMm = 58,
                        CharactersPerLine = 32,
                        Stations = ["bar"],
                        FallbackPrinterId = "bar-backup",
                    },
                    new PrinterOptions
                    {
                        Enabled = true,
                        Id = "bar-backup",
                        Host = IPAddress.Loopback.ToString(),
                        Port = fallbackPort,
                        PaperWidthMm = 58,
                        CharactersPerLine = 32,
                    },
                ],
            }),
            NullLogger<EscPosPrinterGateway>.Instance);
        var payload = JsonDocument.Parse("{\"tab\":{},\"totals\":{},\"items\":[],\"payments\":[]}")
            .RootElement.Clone();

        var result = await gateway.PrintAsync(
            new PrintRequest("job-route:1", null, "bar", "partial_statement", payload));
        var receivedBytes = await received;
        listener.Stop();

        Assert.True(result.Success);
        Assert.Equal("bar-backup", result.PrinterId);
        Assert.True(receivedBytes > 20);
    }

    [Fact]
    public async Task StationIdNeverFallsBackToDisplayOrLegacyStationName()
    {
        var configuredStationId = "33333333-3333-4333-8333-333333333333";
        var requestedStationId = "44444444-4444-4444-8444-444444444444";
        var gateway = new EscPosPrinterGateway(
            Options.Create(new HubOptions
            {
                Printers =
                [
                    new PrinterOptions
                    {
                        Enabled = true,
                        Id = "kitchen",
                        Host = IPAddress.Loopback.ToString(),
                        Port = 9100,
                        PaperWidthMm = 80,
                        CharactersPerLine = 48,
                        Default = true,
                        StationIds = [configuredStationId],
                        Stations = ["Cozinha"],
                        DocumentTypes = ["kds_ticket"],
                    },
                ],
            }),
            NullLogger<EscPosPrinterGateway>.Instance);
        var payload = JsonDocument.Parse("{\"items\":[]}").RootElement.Clone();

        var result = await gateway.PrintAsync(new PrintRequest(
            "job-station-id:1",
            null,
            null,
            "kds_ticket",
            payload,
            StationId: requestedStationId,
            StationName: "Cozinha"));

        Assert.False(result.Success);
        Assert.Equal("rejected", result.Status);
        Assert.Equal("PRINTER_ROUTE_NOT_FOUND", result.ErrorCode);
    }

    [Fact]
    public void FormatsACompactReceiptWithinTheConfiguredPaperWidth()
    {
        var payload = JsonDocument.Parse("""
            {
              "establishmentName":"Casa Giro Centro",
              "generatedAt":"2026-08-18T12:30:00-03:00",
              "tab":{"label":"Mesa 12","customerName":"Joao"},
              "totals":{"subtotalCents":2900,"discountCents":0,"serviceChargeCents":290,"tipCents":0,"totalCents":3190,"paidCents":1000,"remainingCents":2190},
              "items":[{"id":"item-v1","quantity":1,"productName":"Prato muito longo para testar a bobina","netCents":2900,"status":"sent","seatNumber":1}],
              "modifiers":[{"orderItemId":"item-v1","name":"Sem molho","quantity":1,"totalDeltaCents":0}],
              "payments":[{"method":"pix","amountCents":1000}]
            }
            """).RootElement.Clone();

        var receipt = ThermalReceiptFormatter.Format("partial_statement", payload, 32);

        Assert.Contains("CASA GIRO CENTRO", receipt);
        Assert.Contains("PRE-CONTA", receipt);
        Assert.Contains("Mesa 12", receipt);
        Assert.Contains("R$ 31,90", receipt);
        Assert.Contains("Saldo", receipt);
        Assert.Contains("Pessoa 1", receipt);
        Assert.Contains("+ Sem molho", receipt);
        Assert.All(receipt.Split('\n'), line => Assert.True(line.Length <= 32, line));
    }

    [Theory]
    [InlineData(32)]
    [InlineData(48)]
    public void FormatsVersionTwoReceiptForFiftyEightAndEightyMillimeterPaper(int width)
    {
        var payload = JsonDocument.Parse("""
            {
              "schemaVersion":2,
              "generatedAt":"2026-08-22T20:45:00-03:00",
              "establishment":{
                "displayName":"Casa Giro Centro",
                "legalName":"Casa Giro Alimentos Ltda",
                "document":"12.345.678/0001-90",
                "address":{"street":"Rua Central","number":"42","city":"Recife","state":"PE"},
                "phone":"(81) 3333-4444",
                "openingHours":"Seg a Sab, 11:00 as 23:00",
                "logoRaster":{"encoding":"escpos-raster","widthDots":16,"heightDots":2,"dataBase64":"/wAA/w=="}
              },
              "context":{
                "areaName":"Salao principal",
                "squareName":"Praca A",
                "waiterDisplayName":"Equipe A",
                "openedAt":"2026-08-22T19:10:00-03:00",
                "closedAt":"2026-08-22T20:45:00-03:00",
                "durationMinutes":95
              },
              "tab":{"label":"Mesa 12","fulfillmentType":"dine_in","guestCount":4,"customerPhone":"81999999999"},
              "totals":{
                "subtotalCents":4100,
                "discountCents":100,
                "serviceChargeCents":400,
                "serviceChargeOptional":true,
                "tipCents":0,
                "totalCents":4000,
                "suggestedTotalCents":4400,
                "paidCents":1000,
                "remainingCents":3000,
                "serviceTaxNotice":"Servico sugerido e opcional."
              },
              "items":[{
                "id":"item-1",
                "quantity":2,
                "productName":"Hamburguer da casa",
                "netCents":4100,
                "status":"sent",
                "seatNumber":2,
                "notes":"dado reservado",
                "allergyNote":"amendoim",
                "modifiers":[{"name":"Sem cebola","quantity":1,"totalDeltaCents":0}]
              }],
              "payments":[{"method":"pix","amountCents":1000,"netAmountCents":1000,"reference":"segredo-pagamento"}],
              "split":{"method":"equal","partNumber":1,"partCount":2,"amountCents":2200}
            }
            """).RootElement.Clone();

        var document = ThermalReceiptFormatter.FormatDocument("partial_statement", payload, width);

        Assert.Contains("CASA GIRO CENTRO", document.Text);
        Assert.Contains("CNPJ: 12.345.678/0001-90", document.Text);
        Assert.Contains("Rua Central", document.Text);
        Assert.Contains("TEL: (81) 3333-4444", document.Text);
        Assert.Contains("HORARIO:", document.Text);
        Assert.Contains("TEMPO DE CONSUMO: 1h 35min", document.Text);
        Assert.Contains("Pessoa 2", document.Text);
        Assert.Contains("+ Sem cebola", document.Text);
        Assert.Contains("Servico opcional", document.Text);
        Assert.Contains("TOTAL SUGERIDO", document.Text);
        Assert.DoesNotContain(
            document.Text.Split('\n'),
            line => line.StartsWith("TOTAL ") && !line.StartsWith("TOTAL SUGERIDO"));
        Assert.Contains("DIVISAO DA CONTA", document.Text);
        Assert.Contains("PARTE 1 DE 2", document.Text);
        Assert.Contains("NAO E DOCUMENTO FISCAL", document.Text);
        Assert.DoesNotContain("81999999999", document.Text);
        Assert.DoesNotContain("dado reservado", document.Text);
        Assert.DoesNotContain("amendoim", document.Text);
        Assert.DoesNotContain("segredo-pagamento", document.Text);
        Assert.NotNull(document.HeaderGraphic);
        Assert.All(document.Text.Split('\n'), line => Assert.True(line.Length <= width, line));
    }

    [Fact]
    public void EmitsRasterOnlyWhenThePrinterExplicitlySupportsIt()
    {
        var payload = JsonDocument.Parse("""
            {
              "schemaVersion":2,
              "establishment":{
                "displayName":"Casa Giro",
                "logoRaster":{"encoding":"escpos-raster","widthDots":16,"heightDots":2,"dataBase64":"/wAA/w=="}
              },
              "tab":{},"totals":{},"items":[],"payments":[]
            }
            """).RootElement.Clone();
        var document = ThermalReceiptFormatter.FormatDocument("partial_statement", payload, 32);

        var textFallback = EscPosDocument.Render(
            document,
            32,
            16,
            true,
            supportsRasterGraphics: false,
            maximumRasterWidthDots: 384);
        var graphic = EscPosDocument.Render(
            document,
            32,
            16,
            true,
            supportsRasterGraphics: true,
            maximumRasterWidthDots: 384);

        Assert.False(ContainsSequence(textFallback, [0x1d, 0x28, 0x4c]));
        Assert.True(ContainsSequence(
            graphic,
            [0x1d, 0x28, 0x4c, 0x0e, 0x00, 0x30, 0x70, 0x30, 0x01, 0x01, 0x31]));
        Assert.True(ContainsSequence(graphic, [0x1d, 0x28, 0x4c, 0x02, 0x00, 0x30, 0x32]));
        Assert.Contains("CASA GIRO", Encoding.Latin1.GetString(textFallback));
        Assert.Contains("CASA GIRO", Encoding.Latin1.GetString(graphic));
    }

    [Fact]
    public async Task RejectsMoreThanFiveCopiesBeforeContactingAPrinter()
    {
        var gateway = new EscPosPrinterGateway(
            Options.Create(new HubOptions
            {
                Printer = new PrinterOptions
                {
                    Enabled = true,
                    Id = "caixa",
                    Host = IPAddress.Loopback.ToString(),
                    Port = 9100,
                    PaperWidthMm = 80,
                    CharactersPerLine = 48,
                },
            }),
            NullLogger<EscPosPrinterGateway>.Instance);
        var payload = JsonDocument.Parse("{\"tab\":{},\"totals\":{},\"items\":[],\"payments\":[]}")
            .RootElement.Clone();

        var result = await gateway.PrintAsync(
            new PrintRequest("job-copies:1", null, "counter", "partial_statement", payload, 6));

        Assert.False(result.Success);
        Assert.Equal("rejected", result.Status);
        Assert.Equal("PRINT_JOB_INVALID", result.ErrorCode);
    }

    [Fact]
    public void RemovesControlCharactersBeforeCreatingEscPosBytes()
    {
        var bytes = EscPosDocument.Render("Pedido\u001b@ seguro", 32, 16, true);
        var text = Encoding.Latin1.GetString(bytes);

        Assert.Contains("Pedido@ seguro", text);
        Assert.Equal(0x1b, bytes[0]);
        Assert.Equal(0x40, bytes[1]);
        Assert.Equal(0x1d, bytes[^3]);
    }

    [Fact]
    public void FormatsKdsTicketWithRushAndProductionExceptions()
    {
        var payload = JsonDocument.Parse("""
            {
              "generatedAt":"2026-08-18T12:30:00-03:00",
              "id":"ticket-1",
              "reference":"014",
              "stationName":"Cozinha",
              "tableLabel":"Mesa 12",
              "channel":"Salao",
              "rush":true,
              "items":[{
                "quantity":2,
                "productName":"Croquete",
                "modifiers":["Sem molho"],
                "notes":"Bem passado",
                "allergyNote":"Amendoim",
                "seatNumber":2
              }]
            }
            """).RootElement.Clone();

        var receipt = ThermalReceiptFormatter.Format("kds_ticket", payload, 32);

        Assert.Contains("PEDIDO 014", receipt);
        Assert.Contains("*** RUSH ***", receipt);
        Assert.Contains("2x Croquete", receipt);
        Assert.Contains("!! ALERGIA: Amendoim", receipt);
        Assert.All(receipt.Split('\n'), line => Assert.True(line.Length <= 32, line));
    }

    private static bool ContainsSequence(byte[] source, byte[] sequence)
    {
        for (var index = 0; index <= source.Length - sequence.Length; index += 1)
        {
            if (source.AsSpan(index, sequence.Length).SequenceEqual(sequence)) return true;
        }
        return false;
    }
}
