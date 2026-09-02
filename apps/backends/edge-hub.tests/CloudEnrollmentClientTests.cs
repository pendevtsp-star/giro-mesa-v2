using System.Net;
using System.Text;
using GiroMesa.EdgeHub.Enrollment;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class CloudEnrollmentClientTests
{
    [Fact]
    public async Task Normalizes_and_redeems_the_short_lived_code()
    {
        var handler = new RecordingHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """{"deviceId":"device","organizationId":"org","unitId":"unit","syncKey":"secret"}""",
                Encoding.UTF8,
                "application/json"),
        });

        var result = await CloudEnrollmentClient.RedeemAsync(
            new HttpClient(handler),
            new Uri("http://localhost:3200"),
            "ab-cd 2345");

        Assert.Equal("device", result.DeviceId);
        Assert.Equal("/api/v1/device/edge-hub-pairings/redeem", handler.Request?.RequestUri?.AbsolutePath);
        Assert.Contains("\"code\":\"ABCD2345\"", handler.Body);
    }

    [Fact]
    public async Task Rejects_plain_http_outside_local_development()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => CloudEnrollmentClient.RedeemAsync(
            new HttpClient(new RecordingHandler(new HttpResponseMessage(HttpStatusCode.OK))),
            new Uri("http://api.example.test"),
            "ABCD2345"));
    }

    private sealed class RecordingHandler(HttpResponseMessage response) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string Body { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Request = request;
            Body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            return response;
        }
    }
}
