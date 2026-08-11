using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using GiroMesa.EdgeHub.Security;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace GiroMesa.EdgeHub.Tests;

public sealed class HubRecoveryTests : IAsyncLifetime
{
    private readonly string _testRoot = Path.Combine(Path.GetTempPath(), "giromesa-edgehub-recovery-tests");
    private readonly string _directory;
    private readonly string _installationId = Guid.NewGuid().ToString();
    private readonly string _unitId = Guid.NewGuid().ToString();

    public HubRecoveryTests() => _directory = Path.Combine(_testRoot, Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task RequiresThePinnedMutualTlsIdentityAndHonorsRevocation()
    {
        using var certificate = CreateCertificate("CN=giromesa-edge-test");
        var options = CreateOptions(certificate);
        var store = CreateStore(options);
        await store.InitializeAsync();
        var identity = new HubIdentity(Options.Create(options), store);
        await identity.InitializeAsync();
        var authenticator = new DeviceAuthenticator(Options.Create(options), store, identity);

        var pairing = await authenticator.PairAsync(
            new PairDeviceRequest(Guid.NewGuid().ToString(), "Caixa 01", "654321"), certificate);
        Assert.True(pairing.IsSuccess);
        Assert.True(await authenticator.IsAuthorizedAsync(pairing.Token, certificate));

        using var cloneCertificate = CreateCertificate("CN=cloned-edge");
        Assert.False(await authenticator.IsAuthorizedAsync(pairing.Token, cloneCertificate));
        await identity.RevokeAsync("unit decommissioned");
        Assert.False(await authenticator.IsAuthorizedAsync(pairing.Token, certificate));
    }

    [Fact]
    public void RejectsClonedAndRolledBackInstallationState()
    {
        var database = new StoredHubIdentity(_installationId, _unitId, "AABB", 3, false, null);
        var clone = new HubAnchor(Guid.NewGuid().ToString(), 3, "signature");
        var rollback = new HubAnchor(_installationId, 4, "signature");

        Assert.Equal(
            "HUB_CLONE_DETECTED",
            Assert.Throws<HubIdentityException>(() => HubIdentity.ValidateState(database, clone, _installationId)).Code);
        Assert.Equal(
            "HUB_ROLLBACK_DETECTED",
            Assert.Throws<HubIdentityException>(() => HubIdentity.ValidateState(database, rollback, _installationId)).Code);
    }

    [Fact]
    public async Task FailsHealthClosedForDiskClockAndClockRollback()
    {
        using var certificate = CreateCertificate("CN=health-edge");
        var options = CreateOptions(certificate);
        var store = CreateStore(options);
        await store.InitializeAsync();
        var identity = new HubIdentity(Options.Create(options), store);
        await identity.InitializeAsync();
        var now = DateTimeOffset.UtcNow;

        var unhealthy = await identity.CheckHealthAsync(now, availableDiskBytes: 1, trustedUtc: now.AddMinutes(10));
        Assert.Equal("blocked", unhealthy.Status);
        Assert.Contains("DISK_LOW", unhealthy.Findings);
        Assert.Contains("CLOCK_SKEW", unhealthy.Findings);

        await identity.CheckHealthAsync(now.AddMinutes(1), availableDiskBytes: long.MaxValue, trustedUtc: now.AddMinutes(1));
        var rollback = await identity.CheckHealthAsync(now.AddMinutes(-10), availableDiskBytes: long.MaxValue, trustedUtc: now.AddMinutes(-10));
        Assert.Contains("CLOCK_ROLLBACK", rollback.Findings);
    }

    [Fact]
    public async Task CreatesAndValidatesAnEncryptedBackupManifest()
    {
        using var certificate = CreateCertificate("CN=backup-edge");
        var options = CreateOptions(certificate);
        var store = CreateStore(options);
        await store.InitializeAsync();
        var identity = new HubIdentity(Options.Create(options), store);
        await identity.InitializeAsync();

        var backup = await identity.CreateBackupAsync();
        Assert.True(File.Exists(backup.DatabasePath));
        Assert.True(File.Exists(backup.ManifestPath));
        Assert.True(await identity.ValidateBackupAsync(backup.ManifestPath));
        var bytes = await File.ReadAllBytesAsync(backup.DatabasePath);
        Assert.DoesNotContain("SQLite format 3", System.Text.Encoding.UTF8.GetString(bytes));
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        SqliteConnection.ClearAllPools();
        var root = Path.GetFullPath(_testRoot) + Path.DirectorySeparatorChar;
        var directory = Path.GetFullPath(_directory);
        if (directory.StartsWith(root, StringComparison.OrdinalIgnoreCase) && Directory.Exists(directory))
            Directory.Delete(directory, recursive: true);
        return Task.CompletedTask;
    }

    private HubOptions CreateOptions(X509Certificate2 certificate) => new()
    {
        DataDirectory = _directory,
        DatabaseKey = "test-database-key-32-characters-long",
        EnrollmentCode = "654321",
        InstallationId = _installationId,
        UnitId = _unitId,
        RequireMutualTls = true,
        ClientCertificateThumbprint = certificate.GetCertHashString(HashAlgorithmName.SHA256),
        MinimumFreeDiskBytes = 1024,
        MaximumClockSkewSeconds = 60,
    };

    private HubStore CreateStore(HubOptions options) => new(
        Options.Create(options),
        NullLogger<HubStore>.Instance);

    private static X509Certificate2 CreateCertificate(string subject)
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(subject, rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddDays(1));
    }
}
