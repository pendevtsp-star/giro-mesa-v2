using System.Net;
using System.Text;
using GiroMesa.EdgeHub.Adapters;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class FocusFiscalGatewayTests
{
    private const string ActorIdentityId = "11111111-1111-4111-8111-111111111111";

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
            "order-id",
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
            "order-id",
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
            Options.Create(new HubOptions()));
        var unavailable = await disabled.IssueAsync(new FiscalRequest(
            "order-2026", ActorIdentityId, "order", 100, "{}"));
        Assert.Equal("FOCUS_NOT_CONFIGURED", unavailable.ErrorCode);

        var invalid = await Gateway(new RecordingHandler((_, _) => throw new Xunit.Sdk.XunitException("HTTP should not be called")))
            .IssueAsync(new FiscalRequest("unsafe ref", ActorIdentityId, "order", 100, "not-json"));
        Assert.Equal("FOCUS_REQUEST_INVALID", invalid.ErrorCode);
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
            "order-id",
            1590,
            "{\"natureza_operacao\":\"Venda\"}"));

        Assert.False(result.Success);
        Assert.Equal("retryable", result.Status);
        Assert.Equal("FOCUS_PROCESSING", result.ErrorCode);
    }

    [Fact]
    public async Task RefusesProductionWithoutExplicitHomologationEvidence()
    {
        var gateway = new FocusFiscalGateway(
            new HttpClient(new RecordingHandler((_, _) =>
                throw new Xunit.Sdk.XunitException("HTTP should not be called"))),
            Options.Create(new HubOptions
            {
                Focus = new FocusOptions
                {
                    Enabled = true,
                    Environment = "production",
                    Token = "focus-company-token",
                    Homologated = false,
                }
            }));

        var result = await gateway.IssueAsync(new FiscalRequest(
            "order-2026-0003",
            ActorIdentityId,
            "order-id",
            1590,
            "{\"natureza_operacao\":\"Venda\"}"));

        Assert.False(result.Success);
        Assert.Equal("FOCUS_NOT_CONFIGURED", result.ErrorCode);
        Assert.False(gateway.Capability.Configured);
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
        }));

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
