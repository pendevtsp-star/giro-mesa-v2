namespace GiroMesa.EdgeHub.Adapters;

public sealed record FocusRuntimeConfiguration(
    string Provider,
    bool Enabled,
    string Environment,
    string? Token);

public sealed class FocusCredentialStore
{
    private FocusRuntimeConfiguration? _current;

    public FocusRuntimeConfiguration? Current => Volatile.Read(ref _current);

    public void Apply(FocusRuntimeConfiguration? configuration)
    {
        var environment = configuration?.Environment.Trim().ToLowerInvariant();
        var valid = configuration is
            {
                Provider: "focus",
                Enabled: true,
                Token.Length: >= 12
            } && environment is "homologation" or "production";
        Volatile.Write(
            ref _current,
            valid ? configuration! with { Environment = environment! } : null);
    }
}
