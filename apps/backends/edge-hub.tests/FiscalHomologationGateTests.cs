using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class FiscalHomologationGateTests
{
    [Fact]
    public void FailsClosedWithoutCredentialAndDoesNotAttemptTheNetwork()
    {
        var result = FiscalHomologationGate.Check(
            new FocusOptions { Enabled = true, Environment = "homologation" },
            null);

        Assert.False(result.Ready);
        Assert.False(result.CredentialAvailable);
        Assert.False(result.NetworkAttempted);
        Assert.False(result.SefazVerified);
        Assert.Equal("FOCUS_CREDENTIAL_MISSING", result.Code);
    }

    [Fact]
    public void RequiresHomologationAndNeverSerializesTheCredential()
    {
        const string sentinel = "never-log-this-focus-token";
        var production = FiscalHomologationGate.Check(
            new FocusOptions { Enabled = true, Environment = "production", Token = sentinel },
            null);
        var homologation = FiscalHomologationGate.Check(
            new FocusOptions(),
            new FocusRuntimeConfiguration("focus", true, "homologation", sentinel));

        Assert.False(production.Ready);
        Assert.Equal("FOCUS_HOMOLOGATION_ENVIRONMENT_REQUIRED", production.Code);
        Assert.True(homologation.Ready);
        Assert.False(homologation.SefazVerified);
        Assert.DoesNotContain(sentinel, JsonSerializer.Serialize(production));
        Assert.DoesNotContain(sentinel, JsonSerializer.Serialize(homologation));
    }
}
