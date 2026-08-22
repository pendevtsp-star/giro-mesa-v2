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
    public void FormatsACompactReceiptWithinTheConfiguredPaperWidth()
    {
        var payload = JsonDocument.Parse("""
            {
              "establishmentName":"Casa Giro Centro",
              "generatedAt":"2026-08-18T12:30:00-03:00",
              "tab":{"label":"Mesa 12","customerName":"Joao"},
              "totals":{"subtotalCents":2900,"discountCents":0,"serviceChargeCents":290,"tipCents":0,"totalCents":3190,"paidCents":1000,"remainingCents":2190},
              "items":[{"quantity":1,"productName":"Prato muito longo para testar a bobina","netCents":2900,"status":"sent"}],
              "payments":[{"method":"pix","amountCents":1000}]
            }
            """).RootElement.Clone();

        var receipt = ThermalReceiptFormatter.Format("partial_statement", payload, 32);

        Assert.Contains("CASA GIRO CENTRO", receipt);
        Assert.Contains("PRE-CONTA", receipt);
        Assert.Contains("Mesa 12", receipt);
        Assert.Contains("R$ 31,90", receipt);
        Assert.Contains("Saldo", receipt);
        Assert.All(receipt.Split('\n'), line => Assert.True(line.Length <= 32, line));
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
}
