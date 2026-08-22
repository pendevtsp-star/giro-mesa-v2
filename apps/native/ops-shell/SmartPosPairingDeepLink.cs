namespace GiroMesa.OpsShell;

internal sealed record SmartPosPairingDeepLink(
    string ApiBaseUrl,
    string Code);

internal static class SmartPosPairingDeepLinkInbox
{
    private static readonly object Sync = new();
    private static SmartPosPairingDeepLink? _pending;

    public static bool TryCapture(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.Scheme, "giromesa", StringComparison.Ordinal) ||
            !string.Equals(uri.Host, "smartpos", StringComparison.Ordinal) ||
            !string.Equals(uri.AbsolutePath, "/pair", StringComparison.Ordinal))
        {
            return false;
        }
        var query = ParseQuery(uri.Query);
        if (query is null || !query.TryGetValue("apiBaseUrl", out var apiBaseUrl) ||
            !query.TryGetValue("code", out var code) ||
            !Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var apiUri) ||
            apiUri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(apiUri.Query) ||
            !string.IsNullOrEmpty(apiUri.Fragment))
        {
            return false;
        }
        var normalizedCode = code.Trim().ToUpperInvariant();
        if (normalizedCode.Length != 8 ||
            normalizedCode.Any(character => character is not (>= 'A' and <= 'Z') and not (>= '0' and <= '9')))
        {
            return false;
        }
        lock (Sync)
        {
            _pending = new(
                apiUri.ToString().TrimEnd('/'),
                normalizedCode);
        }
        return true;
    }

    public static SmartPosPairingDeepLink? Consume()
    {
        lock (Sync)
        {
            var value = _pending;
            _pending = null;
            return value;
        }
    }

    private static Dictionary<string, string>? ParseQuery(string query)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0) return null;
            var key = Uri.UnescapeDataString(pair[..separator].Replace('+', ' '));
            var value = Uri.UnescapeDataString(pair[(separator + 1)..].Replace('+', ' '));
            if (!values.TryAdd(key, value)) return null;
        }
        return values;
    }
}
