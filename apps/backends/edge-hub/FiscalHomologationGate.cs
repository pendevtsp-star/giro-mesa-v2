using GiroMesa.EdgeHub.Adapters;

namespace GiroMesa.EdgeHub;

public static class FiscalHomologationGate
{
    public static FiscalHomologationGateResult Check(
        FocusOptions options,
        FocusRuntimeConfiguration? runtimeConfiguration)
    {
        var enabled = runtimeConfiguration?.Enabled ?? options.Enabled;
        var environment = (runtimeConfiguration?.Environment ?? options.Environment ?? "")
            .Trim()
            .ToLowerInvariant();
        var token = runtimeConfiguration?.Token ?? options.Token;
        var credentialAvailable = enabled && token is { Length: >= 12 };
        var code = !enabled
            ? "FOCUS_DISABLED"
            : environment != "homologation"
                ? "FOCUS_HOMOLOGATION_ENVIRONMENT_REQUIRED"
                : !credentialAvailable
                    ? "FOCUS_CREDENTIAL_MISSING"
                    : "FOCUS_CREDENTIAL_READY";
        return new(
            code == "FOCUS_CREDENTIAL_READY",
            credentialAvailable,
            false,
            false,
            "focus-nfe",
            environment,
            code);
    }
}

public sealed record FiscalHomologationGateResult(
    bool Ready,
    bool CredentialAvailable,
    bool NetworkAttempted,
    bool SefazVerified,
    string Provider,
    string Environment,
    string Code);
