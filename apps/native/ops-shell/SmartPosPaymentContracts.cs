using System.Reflection;
using System.Text.RegularExpressions;

namespace GiroMesa.OpsShell;

public sealed record SmartPosPaymentCapabilities(
    bool Available,
    bool Configured,
    bool Homologated,
    string Provider,
    string Environment,
    IReadOnlyList<string> Methods,
    bool CanStart,
    bool CanRecover,
    bool CanCancel,
    string? PendingAttemptId,
    string? ErrorCode,
    string? PackageName = null,
    string? SigningCertificateSha256 = null,
    bool CanReverse = false);

public sealed record SmartPosPaymentResult(
    bool Success,
    bool Launched,
    string Status,
    string? AttemptId,
    string? ProviderReference,
    string? ErrorCode,
    bool RequiresReconciliation);

internal enum SmartPosOperation
{
    Start,
    Recover,
    Cancel,
}

internal sealed record SmartPosPaymentRequest(
    string AttemptId,
    long AmountCents,
    string Method,
    int Installments = 1)
{
    private const long MaximumAmountCents = int.MaxValue;
    private static readonly HashSet<string> SupportedMethods =
        new(["credit_card", "debit_card", "pix"], StringComparer.Ordinal);

    public bool IsValid =>
        Guid.TryParse(AttemptId, out var parsedAttemptId) &&
        string.Equals(AttemptId, parsedAttemptId.ToString(), StringComparison.Ordinal) &&
        AmountCents is > 0 and <= MaximumAmountCents &&
        SupportedMethods.Contains(Method) &&
        Installments is >= 1 and <= 24 &&
        (Method == "credit_card" || Installments == 1);
}

internal sealed record SmartPosReversalRequest(
    string ReversalId,
    string PaymentAttemptId,
    string Provider)
{
    public bool IsValid =>
        Guid.TryParse(ReversalId, out _) &&
        Guid.TryParse(PaymentAttemptId, out _) &&
        !string.IsNullOrWhiteSpace(Provider);
}

internal sealed record SmartPosPendingPayment(
    string AttemptId,
    long AmountCents,
    string Method,
    string Provider,
    SmartPosOperation Operation,
    DateTimeOffset UpdatedAt,
    int Installments = 1)
{
    public bool IsValid =>
        new SmartPosPaymentRequest(AttemptId, AmountCents, Method, Installments).IsValid &&
        !string.IsNullOrWhiteSpace(Provider) &&
        Enum.IsDefined(Operation) &&
        UpdatedAt != default;
}

internal sealed record SmartPosIntentConfiguration(
    string Provider,
    string Environment,
    string PackageName,
    IReadOnlySet<string> AllowedPackages,
    IReadOnlySet<string> AllowedSchemes,
    IReadOnlySet<string> Methods,
    string StartUriTemplate,
    string? RecoverUriTemplate,
    string? CancelUriTemplate,
    TimeSpan Timeout)
{
    private const string MetadataPrefix = "GiroMesa.SmartPos.";
    private static readonly Regex ProviderPattern = new("^[a-z0-9][a-z0-9_-]{1,39}$", RegexOptions.CultureInvariant);
    private static readonly Regex PackagePattern = new(
        "^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$",
        RegexOptions.CultureInvariant);
    private static readonly HashSet<string> ForbiddenSchemes =
        new(
            ["content", "data", "file", "http", "https", "javascript", "market"],
            StringComparer.OrdinalIgnoreCase);

    public bool IsConfigured => !string.Equals(Provider, "disabled", StringComparison.Ordinal);

    public static SmartPosIntentConfiguration Load(Assembly assembly)
    {
        var values = assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .Where(attribute => attribute.Key.StartsWith(MetadataPrefix, StringComparison.Ordinal))
            .ToDictionary(
                attribute => attribute.Key[MetadataPrefix.Length..],
                attribute => attribute.Value ?? string.Empty,
                StringComparer.Ordinal);
        return FromValues(values);
    }

    internal static SmartPosIntentConfiguration FromValues(IReadOnlyDictionary<string, string> values)
    {
        var provider = Read(values, "Provider", "disabled").ToLowerInvariant();
        var environment = Read(values, "Environment", "disabled").ToLowerInvariant();
        var packageName = Read(values, "Package", string.Empty);
        var timeout = int.TryParse(Read(values, "TimeoutSeconds", "180"), out var seconds)
            ? TimeSpan.FromSeconds(Math.Clamp(seconds, 30, 600))
            : TimeSpan.FromSeconds(180);
        return new(
            provider,
            environment,
            packageName,
            Split(values, "AllowedPackages", StringComparer.Ordinal),
            Split(values, "AllowedSchemes", StringComparer.OrdinalIgnoreCase),
            Split(values, "Methods", StringComparer.Ordinal),
            Read(values, "StartUriTemplate", string.Empty),
            NullIfEmpty(Read(values, "RecoverUriTemplate", string.Empty)),
            NullIfEmpty(Read(values, "CancelUriTemplate", string.Empty)),
            timeout);
    }

    public string? Validate()
    {
        if (!IsConfigured) return "SMARTPOS_NOT_CONFIGURED";
        if (string.Equals(Provider, "rede", StringComparison.Ordinal))
            return "SMARTPOS_REDE_PRIVATE_CONTRACT_AND_HOMOLOGATION_REQUIRED";
        if (!string.Equals(Provider, "generic_intent", StringComparison.Ordinal))
            return "SMARTPOS_PROVIDER_ADAPTER_MISSING";
        if (!string.Equals(Environment, "homologation", StringComparison.Ordinal))
            return "SMARTPOS_PROVIDER_NOT_HOMOLOGATED";
        if (!ProviderPattern.IsMatch(Provider) || !PackagePattern.IsMatch(PackageName))
            return "SMARTPOS_CONFIGURATION_INVALID";
        if (!AllowedPackages.Contains(PackageName) || AllowedPackages.Count == 0)
            return "SMARTPOS_PACKAGE_NOT_ALLOWED";
        if (AllowedSchemes.Count == 0 || AllowedSchemes.Any(ForbiddenSchemes.Contains))
            return "SMARTPOS_SCHEME_NOT_ALLOWED";
        if (Methods.Count == 0 || Methods.Any(method => method is not ("credit_card" or "debit_card" or "pix")))
            return "SMARTPOS_METHOD_NOT_ALLOWED";
        if (!HasRequiredPlaceholders(StartUriTemplate, "{attemptId}", "{amountCents}", "{method}"))
            return "SMARTPOS_START_TEMPLATE_INVALID";
        if (RecoverUriTemplate is not null && !HasRequiredPlaceholders(RecoverUriTemplate, "{attemptId}"))
            return "SMARTPOS_RECOVER_TEMPLATE_INVALID";
        if (CancelUriTemplate is not null && !HasRequiredPlaceholders(CancelUriTemplate, "{attemptId}"))
            return "SMARTPOS_CANCEL_TEMPLATE_INVALID";
        return null;
    }

    public bool TryBuildUri(
        SmartPosOperation operation,
        SmartPosPaymentRequest request,
        out Uri? uri,
        out string? errorCode)
    {
        uri = null;
        errorCode = null;
        var template = operation switch
        {
            SmartPosOperation.Start => StartUriTemplate,
            SmartPosOperation.Recover => RecoverUriTemplate,
            SmartPosOperation.Cancel => CancelUriTemplate,
            _ => null,
        };
        if (string.IsNullOrWhiteSpace(template))
        {
            errorCode = operation == SmartPosOperation.Recover
                ? "SMARTPOS_RECOVERY_REQUIRES_PROVIDER_ADAPTER"
                : "SMARTPOS_CANCEL_REQUIRES_PROVIDER_ADAPTER";
            return false;
        }

        var value = template
            .Replace("{attemptId}", Uri.EscapeDataString(request.AttemptId), StringComparison.Ordinal)
            .Replace("{amountCents}", request.AmountCents.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{method}", Uri.EscapeDataString(request.Method), StringComparison.Ordinal);
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) ||
            !AllowedSchemes.Contains(uri.Scheme) ||
            ForbiddenSchemes.Contains(uri.Scheme))
        {
            uri = null;
            errorCode = "SMARTPOS_URI_NOT_ALLOWED";
            return false;
        }

        return true;
    }

    private static string Read(IReadOnlyDictionary<string, string> values, string key, string fallback) =>
        values.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value.Trim() : fallback;

    private static HashSet<string> Split(
        IReadOnlyDictionary<string, string> values,
        string key,
        StringComparer comparer) =>
        Read(values, key, string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(comparer);

    private static bool HasRequiredPlaceholders(string template, params string[] placeholders) =>
        !string.IsNullOrWhiteSpace(template) &&
        placeholders.All(placeholder => template.Contains(placeholder, StringComparison.Ordinal));

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
