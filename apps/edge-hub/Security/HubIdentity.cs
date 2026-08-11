using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using GiroMesa.EdgeHub.Storage;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Security;

public sealed record StoredHubIdentity(
    string InstallationId,
    string UnitId,
    string CertificateThumbprint,
    long StateGeneration,
    bool Revoked,
    DateTimeOffset? LastObservedUtc);

public sealed record HubIdentityRegistration(StoredHubIdentity Identity, bool Created);
public sealed record HubAnchor(string InstallationId, long StateGeneration, string Signature);
public sealed record HubHealth(string Status, IReadOnlyList<string> Findings, long AvailableDiskBytes);
public sealed record HubBackup(string DatabasePath, string ManifestPath, long StateGeneration);
public sealed record HubRevocationRequest(string Reason);

public sealed record HubBackupManifest(
    string InstallationId,
    string UnitId,
    long StateGeneration,
    DateTimeOffset CreatedAt,
    string DatabaseFile,
    string Sha256,
    string Signature);

public sealed class HubIdentityException(string code) : InvalidOperationException(code)
{
    public string Code { get; } = code;
}

public sealed class HubIdentity(IOptions<HubOptions> options, HubStore store)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly HubOptions _options = options.Value;
    private StoredHubIdentity? _state;

    private string DataDirectory => Path.GetFullPath(_options.DataDirectory);
    private string AnchorPath => Path.Combine(DataDirectory, "hub-installation.anchor.json");
    private string BackupDirectory => Path.GetFullPath(
        _options.BackupDirectory ?? Path.Combine(DataDirectory, "backups"));

    public StoredHubIdentity State => _state ?? throw new HubIdentityException("HUB_IDENTITY_NOT_INITIALIZED");

    public async Task<StoredHubIdentity> InitializeAsync()
    {
        var installationId = RequireCanonicalId(_options.InstallationId, "HUB_INSTALLATION_ID_REQUIRED");
        var unitId = RequireCanonicalId(_options.UnitId, "HUB_UNIT_ID_REQUIRED");
        var thumbprint = NormalizeThumbprint(_options.ClientCertificateThumbprint);
        if (_options.RequireMutualTls && thumbprint.Length != 64)
            throw new HubIdentityException("HUB_MTLS_CERTIFICATE_REQUIRED");
        if (string.IsNullOrWhiteSpace(_options.DatabaseKey) || _options.DatabaseKey.Length < 32)
            throw new HubIdentityException("HUB_DATABASE_KEY_REQUIRED");

        Directory.CreateDirectory(DataDirectory);
        var registration = await store.EnsureHubIdentityAsync(installationId, unitId, thumbprint);
        if (registration.Created)
        {
            if (File.Exists(AnchorPath)) throw new HubIdentityException("HUB_DATABASE_ROLLBACK_DETECTED");
            _state = registration.Identity;
            await WriteAnchorAsync(_state);
            return _state;
        }

        if (!File.Exists(AnchorPath)) throw new HubIdentityException("HUB_ANCHOR_MISSING");
        var anchor = JsonSerializer.Deserialize<HubAnchor>(await File.ReadAllTextAsync(AnchorPath), JsonOptions)
            ?? throw new HubIdentityException("HUB_ANCHOR_INVALID");
        if (!FixedEquals(anchor.Signature, SignAnchor(anchor.InstallationId, anchor.StateGeneration)))
            throw new HubIdentityException("HUB_ANCHOR_TAMPERED");
        ValidateState(registration.Identity, anchor, installationId);
        if (!FixedEquals(registration.Identity.UnitId, unitId))
            throw new HubIdentityException("HUB_CLONE_DETECTED");
        if (_options.RequireMutualTls && !FixedEquals(registration.Identity.CertificateThumbprint, thumbprint))
            throw new HubIdentityException("HUB_CERTIFICATE_IDENTITY_MISMATCH");
        _state = registration.Identity;
        if (anchor.StateGeneration < _state.StateGeneration) await WriteAnchorAsync(_state);
        return _state;
    }

    public static void ValidateState(
        StoredHubIdentity database,
        HubAnchor anchor,
        string configuredInstallationId)
    {
        if (!FixedEquals(database.InstallationId, configuredInstallationId) ||
            !FixedEquals(anchor.InstallationId, configuredInstallationId))
            throw new HubIdentityException("HUB_CLONE_DETECTED");
        if (anchor.StateGeneration > database.StateGeneration)
            throw new HubIdentityException("HUB_ROLLBACK_DETECTED");
    }

    public bool IsCertificateAuthorized(X509Certificate2? certificate)
    {
        if (!_options.RequireMutualTls) return !State.Revoked;
        if (certificate is null || State.Revoked) return false;
        var presented = certificate.GetCertHashString(HashAlgorithmName.SHA256);
        return FixedEquals(NormalizeThumbprint(presented), State.CertificateThumbprint);
    }

    public async Task RevokeAsync(string reason)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw new HubIdentityException("HUB_REVOCATION_REASON_REQUIRED");
        _state = await store.RevokeHubIdentityAsync(reason.Trim());
        await WriteAnchorAsync(_state);
    }

    public async Task<HubHealth> CheckHealthAsync(
        DateTimeOffset now,
        long? availableDiskBytes = null,
        DateTimeOffset? trustedUtc = null)
    {
        var findings = new List<string>();
        if (State.Revoked) findings.Add("IDENTITY_REVOKED");
        var available = availableDiskBytes ?? AvailableDiskBytes();
        if (available < _options.MinimumFreeDiskBytes) findings.Add("DISK_LOW");
        if (trustedUtc is { } trusted &&
            Math.Abs((trusted - now).TotalSeconds) > _options.MaximumClockSkewSeconds)
            findings.Add("CLOCK_SKEW");
        if (!await store.ObserveHubClockAsync(now, _options.MaximumClockSkewSeconds))
            findings.Add("CLOCK_ROLLBACK");
        var status = findings.Count == 0 ? "ready" : "blocked";
        return new HubHealth(status, findings, available);
    }

    public async Task<HubBackup> CreateBackupAsync()
    {
        Directory.CreateDirectory(BackupDirectory);
        EnsureWithin(DataDirectory, BackupDirectory, "HUB_BACKUP_DIRECTORY_INVALID");
        var createdAt = DateTimeOffset.UtcNow;
        var stem = $"edge-{createdAt:yyyyMMddTHHmmssfffZ}-g{State.StateGeneration}-{Guid.NewGuid():N}";
        var databasePath = Path.Combine(BackupDirectory, $"{stem}.db");
        var manifestPath = Path.Combine(BackupDirectory, $"{stem}.manifest.json");
        await store.CreateEncryptedBackupAsync(databasePath);
        var hash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(databasePath)));
        var unsigned = new HubBackupManifest(
            State.InstallationId,
            State.UnitId,
            State.StateGeneration,
            createdAt,
            Path.GetFileName(databasePath),
            hash,
            string.Empty);
        var manifest = unsigned with { Signature = SignManifest(unsigned) };
        await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest, JsonOptions));
        return new HubBackup(databasePath, manifestPath, State.StateGeneration);
    }

    public async Task<bool> ValidateBackupAsync(string manifestPath)
    {
        var fullManifestPath = Path.GetFullPath(manifestPath);
        EnsureWithin(BackupDirectory, fullManifestPath, "HUB_BACKUP_PATH_INVALID");
        var manifest = JsonSerializer.Deserialize<HubBackupManifest>(
            await File.ReadAllTextAsync(fullManifestPath), JsonOptions)
            ?? throw new HubIdentityException("HUB_BACKUP_MANIFEST_INVALID");
        if (!FixedEquals(manifest.InstallationId, State.InstallationId) ||
            !FixedEquals(manifest.UnitId, State.UnitId) ||
            manifest.StateGeneration < State.StateGeneration)
            return false;
        var unsigned = manifest with { Signature = string.Empty };
        if (!FixedEquals(manifest.Signature, SignManifest(unsigned))) return false;
        var databasePath = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(fullManifestPath)!, manifest.DatabaseFile));
        EnsureWithin(BackupDirectory, databasePath, "HUB_BACKUP_PATH_INVALID");
        if (!File.Exists(databasePath)) return false;
        var hash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(databasePath)));
        return FixedEquals(hash, manifest.Sha256);
    }

    private async Task WriteAnchorAsync(StoredHubIdentity state)
    {
        var anchor = new HubAnchor(
            state.InstallationId,
            state.StateGeneration,
            SignAnchor(state.InstallationId, state.StateGeneration));
        var temporaryPath = $"{AnchorPath}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllTextAsync(temporaryPath, JsonSerializer.Serialize(anchor, JsonOptions));
        File.Move(temporaryPath, AnchorPath, true);
    }

    private string SignAnchor(string installationId, long stateGeneration) =>
        Sign($"anchor\n{installationId}\n{stateGeneration}");

    private string SignManifest(HubBackupManifest manifest) =>
        Sign(string.Join('\n',
            "backup",
            manifest.InstallationId,
            manifest.UnitId,
            manifest.StateGeneration,
            manifest.CreatedAt.ToString("O"),
            manifest.DatabaseFile,
            manifest.Sha256));

    private string Sign(string value)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_options.DatabaseKey!));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(value)));
    }

    private long AvailableDiskBytes()
    {
        var root = Path.GetPathRoot(DataDirectory)
            ?? throw new HubIdentityException("HUB_DATA_VOLUME_INVALID");
        return new DriveInfo(root).AvailableFreeSpace;
    }

    private static string RequireCanonicalId(string? value, string code) =>
        Guid.TryParseExact(value, "D", out var id) ? id.ToString() : throw new HubIdentityException(code);

    private static string NormalizeThumbprint(string? value) =>
        new((value ?? string.Empty).Where(Uri.IsHexDigit).Select(char.ToUpperInvariant).ToArray());

    private static bool FixedEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length &&
            CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    private static void EnsureWithin(string root, string candidate, string code)
    {
        var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var fullCandidate = Path.GetFullPath(candidate);
        if (!fullCandidate.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
            throw new HubIdentityException(code);
    }
}
