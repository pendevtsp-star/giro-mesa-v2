using System.Text.Json;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class OperationalCommandTests
{
    [Fact]
    public void RejectsMissingScopeAndInvalidVersion()
    {
        var command = new OperationalCommand(
            "", "", "", "actor", "device", "order.created",
            JsonDocument.Parse("{}").RootElement, 0, DateTimeOffset.UtcNow);

        var errors = command.Validate();

        Assert.Contains(nameof(command.Id), errors);
        Assert.Contains(nameof(command.OrganizationId), errors);
        Assert.Contains(nameof(command.UnitId), errors);
        Assert.Contains(nameof(command.Version), errors);
    }
}
