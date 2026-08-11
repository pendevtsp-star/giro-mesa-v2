using GiroMesa.EdgeHub.Adapters;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class PaymentAdapterTests
{
    [Fact]
    public async Task KeepsTimeoutAfterDispatchUnknownUntilLookup()
    {
        var adapter = new SmartPosSimulator(SmartPosScenario.UnknownThenAuthorized);
        var request = new PaymentRequest("attempt-0001", 2500, "credit", "order-1");

        var executed = await adapter.ExecuteAsync(request);
        var lookedUp = await adapter.LookupAsync(executed.ProviderReference!);

        Assert.False(executed.Success);
        Assert.Equal("unknown", executed.Status);
        Assert.Equal("authorized", lookedUp.Status);
        Assert.Equal(executed.ProviderReference, lookedUp.ProviderReference);
    }

    [Fact]
    public async Task IsIdempotentAndNeverAcceptsCardholderData()
    {
        var adapter = new SmartPosSimulator(SmartPosScenario.Authorized);
        var request = new PaymentRequest("attempt-0002", 1099, "pix", "order-2");

        var first = await adapter.ExecuteAsync(request);
        var replay = await adapter.ExecuteAsync(request);

        Assert.True(first.Success);
        Assert.Equal(first, replay);
        Assert.DoesNotContain("pan", request.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("cvv", request.ToString(), StringComparison.OrdinalIgnoreCase);
    }
}
