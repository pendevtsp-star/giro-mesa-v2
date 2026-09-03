using GiroMesa.EdgeHub.Security;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class MachineConfigurationStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"giromesa-edge-config-{Guid.NewGuid():N}");

    [Fact]
    public void Protects_and_restores_machine_configuration()
    {
        if (!OperatingSystem.IsWindows()) return;
        var path = Path.Combine(_directory, "enrollment.bin");
        var configuration = new MachineConfiguration(
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            "https://api.giromesa.com.br",
            "sync-secret",
            "database-secret-with-more-than-32-characters",
            Path.Combine(_directory, "data"));

        MachineConfigurationStore.Save(configuration, path);

        Assert.Equal(configuration, MachineConfigurationStore.TryLoad(path));
        Assert.DoesNotContain("sync-secret", File.ReadAllText(path));
    }

    [Fact]
    public void Rejects_incomplete_legacy_configuration()
    {
        if (!OperatingSystem.IsWindows()) return;
        var path = Path.Combine(_directory, "legacy.bin");
        MachineConfigurationStore.Save(new MachineConfiguration(
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            Guid.NewGuid().ToString(),
            "https://api.giromesa.com.br",
            "",
            "database-secret-with-more-than-32-characters",
            Path.Combine(_directory, "data")), path);

        Assert.Null(MachineConfigurationStore.TryLoad(path));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }
}
