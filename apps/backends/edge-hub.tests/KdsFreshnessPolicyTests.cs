using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class KdsFreshnessPolicyTests
{
    [Fact]
    public void ProjectionBlockThenOfflineTakePrecedenceOverStalenessAndLease()
    {
        var now = DateTimeOffset.UtcNow;

        Assert.Equal(
            "degraded",
            KdsFreshnessPolicy.Resolve(true, "offline", now.AddHours(-1), now.AddMinutes(-1), now));
        Assert.Equal(
            "offline",
            KdsFreshnessPolicy.Resolve(false, "offline", now.AddHours(-1), now.AddMinutes(-1), now));
        Assert.Equal(
            "stale",
            KdsFreshnessPolicy.Resolve(false, "idle", now.AddHours(-1), now.AddMinutes(-1), now));
        Assert.Equal(
            "degraded",
            KdsFreshnessPolicy.Resolve(false, "idle", now, now.AddMinutes(-1), now));
        Assert.Equal(
            "live",
            KdsFreshnessPolicy.Resolve(false, "idle", now, now.AddMinutes(1), now));
    }
}
