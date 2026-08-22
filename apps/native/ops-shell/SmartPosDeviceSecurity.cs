using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GiroMesa.OpsShell;

internal sealed record SmartPosDeviceCredential(
    string InstallationId,
    string CredentialId,
    string ApiBaseUrl,
    string PrivateKeyPkcs8,
    string PublicKeySpki,
    DateTimeOffset CredentialExpiresAt,
    DateTimeOffset RotateAfter)
{
    public bool IsValid =>
        Guid.TryParse(InstallationId, out _) &&
        Guid.TryParse(CredentialId, out _) &&
        Uri.TryCreate(ApiBaseUrl, UriKind.Absolute, out var apiUri) &&
        apiUri.Scheme == Uri.UriSchemeHttps &&
        !string.IsNullOrWhiteSpace(PrivateKeyPkcs8) &&
        !string.IsNullOrWhiteSpace(PublicKeySpki) &&
        CredentialExpiresAt > DateTimeOffset.UtcNow;
}

internal sealed record SmartPosPendingCredentialRotation(
    string RotationId,
    string PrivateKeyPkcs8,
    string PublicKeySpki,
    DateTimeOffset CreatedAt);

internal sealed record SmartPosDeviceCredentialState(
    SmartPosDeviceCredential Current,
    SmartPosDeviceCredential? Previous,
    DateTimeOffset? PreviousValidUntil,
    SmartPosPendingCredentialRotation? PendingRotation);

internal sealed class SmartPosDeviceCredentialStore
{
    private const string CredentialStateKey = "smartpos_device_credentials_v2";
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<SmartPosDeviceCredentialState?> LoadAsync()
    {
        await _gate.WaitAsync();
        try
        {
            var value = await SecureStorage.Default.GetAsync(CredentialStateKey);
            if (string.IsNullOrWhiteSpace(value)) return null;
            var state = JsonSerializer.Deserialize<SmartPosDeviceCredentialState>(value);
            return state?.Current.IsValid == true ? state : null;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> SaveAsync(SmartPosDeviceCredentialState state)
    {
        if (!state.Current.IsValid) return false;
        await _gate.WaitAsync();
        try
        {
            await SecureStorage.Default.SetAsync(CredentialStateKey, JsonSerializer.Serialize(state));
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return false;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> SavePendingRotationAsync(SmartPosPendingCredentialRotation pending)
    {
        await _gate.WaitAsync();
        try
        {
            var value = await SecureStorage.Default.GetAsync(CredentialStateKey);
            var state = string.IsNullOrWhiteSpace(value)
                ? null
                : JsonSerializer.Deserialize<SmartPosDeviceCredentialState>(value);
            if (state?.Current.IsValid != true) return false;
            await SecureStorage.Default.SetAsync(
                CredentialStateKey,
                JsonSerializer.Serialize(state with { PendingRotation = pending }));
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return false;
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task ClearAsync()
    {
        try
        {
            SecureStorage.Default.Remove(CredentialStateKey);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // A failed secure-storage removal must not expose credential material.
        }
        return Task.CompletedTask;
    }
}

internal sealed record SmartPosSignatureHeaders(
    string CredentialId,
    string Timestamp,
    string Nonce,
    string Signature);

internal sealed class SmartPosRequestSigner
{
    private readonly Func<DateTimeOffset> _clock;
    private readonly Func<string> _nonceFactory;

    public SmartPosRequestSigner(
        Func<DateTimeOffset>? clock = null,
        Func<string>? nonceFactory = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _nonceFactory = nonceFactory ?? (() => Base64Url(RandomNumberGenerator.GetBytes(24)));
    }

    public SmartPosSignatureHeaders Sign(
        HttpMethod method,
        Uri uri,
        ReadOnlySpan<byte> canonicalBody,
        SmartPosDeviceCredential credential)
    {
        if (!credential.IsValid) throw new InvalidOperationException("SMARTPOS_CREDENTIAL_INVALID");
        var timestamp = _clock().ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var nonce = _nonceFactory();
        var bodyHash = Convert.ToHexString(SHA256.HashData(canonicalBody)).ToLowerInvariant();
        var canonical = string.Join(
            '\n',
            method.Method.ToUpperInvariant(),
            uri.PathAndQuery,
            timestamp,
            nonce,
            bodyHash);
        using var key = ECDsa.Create();
        key.ImportPkcs8PrivateKey(Convert.FromBase64String(credential.PrivateKeyPkcs8), out _);
        var signature = key.SignData(
            Encoding.UTF8.GetBytes(canonical),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        if (signature.Length != 64) throw new CryptographicException("SMARTPOS_SIGNATURE_FORMAT_INVALID");
        return new(credential.CredentialId, timestamp, nonce, Base64Url(signature));
    }

    internal static byte[] CanonicalJson<T>(T value) =>
        CanonicalJson(JsonSerializer.SerializeToElement(value, SmartPosJson.Options));

    internal static byte[] CanonicalJson(JsonElement value)
    {
        var canonical = new StringBuilder();
        WriteCanonical(canonical, value);
        return Encoding.UTF8.GetBytes(canonical.ToString());
    }

    internal static (string PrivateKeyPkcs8, string PublicKeySpki) CreateP256KeyPair()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (
            Convert.ToBase64String(key.ExportPkcs8PrivateKey()),
            Convert.ToBase64String(key.ExportSubjectPublicKeyInfo()));
    }

    private static void WriteCanonical(StringBuilder writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.Append('{');
                var firstProperty = true;
                foreach (var property in value.EnumerateObject().OrderBy(
                    property => property.Name,
                    StringComparer.Ordinal))
                {
                    if (!firstProperty) writer.Append(',');
                    firstProperty = false;
                    WriteJsonString(writer, property.Name);
                    writer.Append(':');
                    WriteCanonical(writer, property.Value);
                }
                writer.Append('}');
                break;
            case JsonValueKind.Array:
                writer.Append('[');
                var firstItem = true;
                foreach (var item in value.EnumerateArray())
                {
                    if (!firstItem) writer.Append(',');
                    firstItem = false;
                    WriteCanonical(writer, item);
                }
                writer.Append(']');
                break;
            case JsonValueKind.String:
                WriteJsonString(writer, value.GetString() ?? string.Empty);
                break;
            case JsonValueKind.True:
                writer.Append("true");
                break;
            case JsonValueKind.False:
                writer.Append("false");
                break;
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                writer.Append("null");
                break;
            default:
                writer.Append(value.GetRawText());
                break;
        }
    }

    private static void WriteJsonString(StringBuilder writer, string value)
    {
        writer.Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            switch (character)
            {
                case '"':
                    writer.Append("\\\"");
                    break;
                case '\\':
                    writer.Append("\\\\");
                    break;
                case '\b':
                    writer.Append("\\b");
                    break;
                case '\f':
                    writer.Append("\\f");
                    break;
                case '\n':
                    writer.Append("\\n");
                    break;
                case '\r':
                    writer.Append("\\r");
                    break;
                case '\t':
                    writer.Append("\\t");
                    break;
                default:
                    if (character < ' ' ||
                        (char.IsSurrogate(character) &&
                            !(char.IsHighSurrogate(character) &&
                                index + 1 < value.Length &&
                                char.IsLowSurrogate(value[index + 1]))))
                    {
                        writer.Append("\\u");
                        writer.Append(((int)character).ToString("x4", System.Globalization.CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        writer.Append(character);
                        if (char.IsHighSurrogate(character)) writer.Append(value[++index]);
                    }
                    break;
            }
        }
        writer.Append('"');
    }

    private static string Base64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

internal static class SmartPosJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
}
