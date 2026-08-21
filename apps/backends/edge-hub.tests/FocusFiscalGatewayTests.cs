using System.Net;
using System.Text;
using GiroMesa.EdgeHub.Adapters;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class FocusFiscalGatewayTests
{
    private const string ActorIdentityId = "11111111-1111-4111-8111-111111111111";
    private const string OrderId = "22222222-2222-4222-8222-222222222222";

    [Fact]
    public async Task IssuesNfceWithBasicAuthAndIdempotentReference()
    {
        var handler = new RecordingHandler((request, call) =>
        {
            Assert.Equal(1, call);
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://homologacao.focusnfe.com.br/v2/nfce?ref=order-2026-0001", request.RequestUri?.ToString());
            Assert.Equal("Basic", request.Headers.Authorization?.Scheme);
            Assert.Equal(
                Convert.ToBase64String(Encoding.UTF8.GetBytes("focus-company-token:")),
                request.Headers.Authorization?.Parameter);
            return new HttpResponseMessage(HttpStatusCode.Created)
            {
                Content = new StringContent("{\"status\":\"autorizado\",\"chave_nfe\":\"nfce-key\"}")
            };
        });
        var gateway = Gateway(handler);

        var result = await gateway.IssueAsync(new FiscalRequest(
            "order-2026-0001",
            ActorIdentityId,
            OrderId,
            1590,
            "{\"natureza_operacao\":\"Venda\"}"));

        Assert.True(result.Success);
        Assert.Equal("nfce-key", result.DocumentReference);
        Assert.True(gateway.Capability.Configured);
    }

    [Fact]
    public async Task ReconcilesAnExistingReferenceAfterUnprocessableResponse()
    {
        var handler = new RecordingHandler((request, call) =>
        {
            if (call == 1)
                return new HttpResponseMessage(HttpStatusCode.UnprocessableEntity)
                {
                    Content = new StringContent("{\"codigo\":\"referencia_ja_utilizada\"}")
                };
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.EndsWith("/v2/nfce/order-2026-0001", request.RequestUri?.ToString());
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"status\":\"autorizado\",\"ref\":\"order-2026-0001\"}")
            };
        });
        var result = await Gateway(handler).IssueAsync(new FiscalRequest(
            "order-2026-0001",
            ActorIdentityId,
            OrderId,
            1590,
            "{\"natureza_operacao\":\"Venda\"}"));

        Assert.True(result.Success);
        Assert.Equal("order-2026-0001", result.DocumentReference);
        Assert.Equal(2, handler.CallCount);
    }

    [Fact]
    public async Task FailsClosedWhenDisabledOrPayloadIsInvalid()
    {
        var disabled = new FocusFiscalGateway(
            new HttpClient(new RecordingHandler((_, _) => throw new Xunit.Sdk.XunitException("HTTP should not be called"))),
            Options.Create(new HubOptions()),
            new FocusCredentialStore());
        var unavailable = await disabled.IssueAsync(new FiscalRequest(
            "order-2026", ActorIdentityId, "order", 100, "{}"));
        Assert.Equal("FOCUS_NOT_CONFIGURED", unavailable.ErrorCode);

        var invalid = await Gateway(new RecordingHandler((_, _) => throw new Xunit.Sdk.XunitException("HTTP should not be called")))
            .IssueAsync(new FiscalRequest("unsafe ref", ActorIdentityId, "order", 100, "not-json"));
        Assert.Equal("FOCUS_REQUEST_INVALID", invalid.ErrorCode);
    }

    [Fact]
    public async Task UsesCompanyCredentialReceivedFromAuthenticatedCloudSync()
    {
        var credentials = new FocusCredentialStore();
        credentials.Apply(new FocusRuntimeConfiguration(
            "focus",
            true,
            "homologation",
            "focus-runtime-token"));
        var gateway = new FocusFiscalGateway(
            new HttpClient(new RecordingHandler((request, _) =>
            {
                Assert.Equal("Basic", request.Headers.Authorization?.Scheme);
                var expected = Convert.ToBase64String(Encoding.UTF8.GetBytes("focus-runtime-token:"));
                Assert.Equal(expected, request.Headers.Authorization?.Parameter);
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("""{"status":"autorizado","ref":"runtime-ref"}""")
                };
            })),
            Options.Create(new HubOptions()),
            credentials);

        var result = await gateway.IssueAsync(new FiscalRequest(
            "runtime-ref",
            ActorIdentityId,
            Guid.NewGuid().ToString(),
            100,
            "{}"));

        Assert.True(result.Success);
        credentials.Apply(null);
        Assert.False(gateway.Capability.Configured);
    }

    [Fact]
    public async Task DoesNotReportAProcessingDocumentAsAuthorized()
    {
        var handler = new RecordingHandler((_, _) => new HttpResponseMessage(HttpStatusCode.Created)
        {
            Content = new StringContent("{\"status\":\"processando_autorizacao\"}")
        });
        var result = await Gateway(handler).IssueAsync(new FiscalRequest(
            "order-2026-0002",
            ActorIdentityId,
            OrderId,
            1590,
            "{\"natureza_operacao\":\"Venda\"}"));

        Assert.False(result.Success);
        Assert.Equal("processing", result.Status);
        Assert.Equal("FOCUS_PROCESSING", result.ErrorCode);
    }

    [Fact]
    public async Task ConsultsTheProviderWithoutInferringAuthorization()
    {
        var handler = new RecordingHandler((request, _) =>
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.EndsWith("/v2/nfce/order-2026-0003", request.RequestUri?.ToString());
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"status\":\"processando_autorizacao\",\"ref\":\"order-2026-0003\"}")
            };
        });

        var result = await Gateway(handler).ConsultAsync(new(
            ActorIdentityId,
            "order-2026-0003"));

        Assert.False(result.Success);
        Assert.Equal("processing", result.Status);
        Assert.Equal("FOCUS_PROCESSING", result.ErrorCode);
    }

    [Fact]
    public async Task CancelsWithTheDocumentReferenceAndRequiredJustification()
    {
        var handler = new RecordingHandler((request, _) =>
        {
            Assert.Equal(HttpMethod.Delete, request.Method);
            Assert.EndsWith("/v2/nfce/order-2026-0004", request.RequestUri?.ToString());
            Assert.Equal(
                "{\"justificativa\":\"Venda emitida em duplicidade\"}",
                request.Content?.ReadAsStringAsync().GetAwaiter().GetResult());
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"status\":\"cancelado\"}")
            };
        });

        var result = await Gateway(handler).CancelAsync(
            "order-2026-0004",
            new(ActorIdentityId, "Venda emitida em duplicidade"));

        Assert.True(result.Success);
        Assert.Equal("canceled", result.Status);
    }

    [Fact]
    public async Task ReconcilesAnAlreadyCanceledDocument()
    {
        var handler = new RecordingHandler((request, call) =>
        {
            if (call == 1)
            {
                Assert.Equal(HttpMethod.Delete, request.Method);
                return new HttpResponseMessage(HttpStatusCode.UnprocessableEntity)
                {
                    Content = new StringContent("{\"codigo\":\"nota_cancelada\"}")
                };
            }
            Assert.Equal(HttpMethod.Get, request.Method);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"status\":\"cancelado\",\"ref\":\"order-2026-0005\"}")
            };
        });

        var result = await Gateway(handler).CancelAsync(
            "order-2026-0005",
            new(ActorIdentityId, "Venda emitida em duplicidade"));

        Assert.True(result.Success);
        Assert.Equal("canceled", result.Status);
        Assert.Equal(2, handler.CallCount);
    }

    [Fact]
    public async Task InvalidatesANumberRangeOnlyAfterProviderAuthorization()
    {
        var handler = new RecordingHandler((request, _) =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.EndsWith("/v2/nfce/inutilizacao", request.RequestUri?.ToString());
            var body = request.Content?.ReadAsStringAsync().GetAwaiter().GetResult();
            Assert.Contains("\"cnpj\":\"12345678000199\"", body);
            Assert.Contains("\"numero_inicial\":40", body);
            Assert.Contains("\"numero_final\":42", body);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"status\":\"autorizado\",\"protocolo_sefaz\":\"135260000000001\"}")
            };
        });

        var result = await Gateway(handler).InvalidateNumbersAsync(new(
            ActorIdentityId,
            "gap-2026-0001",
            "12345678000199",
            "1",
            40,
            42,
            "Falha tecnica na sequencia fiscal"));

        Assert.True(result.Success);
        Assert.Equal("invalidated", result.Status);
        Assert.Equal("135260000000001", result.DocumentReference);
    }

    [Fact]
    public async Task ReconcilesAnAlreadyInvalidatedNumberRange()
    {
        var handler = new RecordingHandler((request, call) =>
        {
            if (call == 1)
            {
                Assert.Equal(HttpMethod.Post, request.Method);
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"status\":\"erro_autorizacao\"}")
                };
            }
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Contains("cnpj=12345678000199", request.RequestUri?.Query);
            Assert.Contains("numero_inicial=40", request.RequestUri?.Query);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[{\"status\":\"autorizado\",\"cnpj\":\"12345678000199\",\"serie\":1,\"numero_inicial\":40,\"numero_final\":42,\"protocolo_sefaz\":\"135260000000002\"}]")
            };
        });

        var result = await Gateway(handler).InvalidateNumbersAsync(new(
            ActorIdentityId,
            "gap-2026-0002",
            "12345678000199",
            "1",
            40,
            42,
            "Falha tecnica na sequencia fiscal"));

        Assert.True(result.Success);
        Assert.Equal("135260000000002", result.DocumentReference);
        Assert.Equal(2, handler.CallCount);
    }

    [Fact]
    public async Task RejectsInvalidFiscalMutationsBeforeCallingFocus()
    {
        var gateway = Gateway(new RecordingHandler(
            (_, _) => throw new Xunit.Sdk.XunitException("HTTP should not be called")));

        var cancellation = await gateway.CancelAsync(
            "order-2026-0006",
            new(ActorIdentityId, "curta"));
        var invalidation = await gateway.InvalidateNumbersAsync(new(
            ActorIdentityId,
            "gap-2026-0003",
            "12345678000199",
            "1",
            42,
            40,
            "Falha tecnica na sequencia fiscal"));
        var invalidCnpj = await gateway.InvalidateNumbersAsync(new(
            ActorIdentityId,
            "gap-2026-0004",
            "123456780001AZ",
            "1",
            40,
            42,
            "Falha tecnica na sequencia fiscal"));

        Assert.Equal("FOCUS_REQUEST_INVALID", cancellation.ErrorCode);
        Assert.Equal("FOCUS_REQUEST_INVALID", invalidation.ErrorCode);
        Assert.Equal("FOCUS_REQUEST_INVALID", invalidCnpj.ErrorCode);
    }

    private static FocusFiscalGateway Gateway(HttpMessageHandler handler) => new(
        new HttpClient(handler),
        Options.Create(new HubOptions
        {
            Focus = new FocusOptions
            {
                Enabled = true,
                Environment = "homologation",
                Token = "focus-company-token",
                RequestTimeoutSeconds = 5,
            }
        }),
        new FocusCredentialStore());

    private sealed class RecordingHandler(Func<HttpRequestMessage, int, HttpResponseMessage> response)
        : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount += 1;
            return Task.FromResult(response(request, CallCount));
        }
    }
}
