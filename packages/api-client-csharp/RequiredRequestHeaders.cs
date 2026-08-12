using Microsoft.Kiota.Abstractions;

namespace GiroMesa.ApiClient;

public sealed record TableCallHeaders
{
    public TableCallHeaders(string authorization, string requestNonce, string idempotencyKey)
    {
        Authorization = Required(authorization, nameof(authorization));
        RequestNonce = Required(requestNonce, nameof(requestNonce));
        IdempotencyKey = Required(idempotencyKey, nameof(idempotencyKey));
    }

    public string Authorization { get; }
    public string RequestNonce { get; }
    public string IdempotencyKey { get; }

    public void Apply(RequestConfiguration<DefaultQueryParameters> configuration)
    {
        configuration.Headers.TryAdd("Authorization", Authorization);
        configuration.Headers.TryAdd("X-Request-Nonce", RequestNonce);
        configuration.Headers.TryAdd("Idempotency-Key", IdempotencyKey);
    }

    private static string Required(string value, string parameterName) =>
        string.IsNullOrWhiteSpace(value)
            ? throw new ArgumentException("A required request header cannot be blank.", parameterName)
            : value;
}

public sealed record TablePartialHeaders
{
    public TablePartialHeaders(string authorization)
    {
        Authorization = string.IsNullOrWhiteSpace(authorization)
            ? throw new ArgumentException(
                "A required request header cannot be blank.",
                nameof(authorization))
            : authorization;
    }

    public string Authorization { get; }

    public void Apply(RequestConfiguration<DefaultQueryParameters> configuration) =>
        configuration.Headers.TryAdd("Authorization", Authorization);
}

public sealed record DispatchOutcomeHeaders
{
    public DispatchOutcomeHeaders(string authorization)
    {
        Authorization = string.IsNullOrWhiteSpace(authorization)
            ? throw new ArgumentException(
                "A required request header cannot be blank.",
                nameof(authorization))
            : authorization;
    }

    public string Authorization { get; }

    public void Apply(RequestConfiguration<DefaultQueryParameters> configuration) =>
        configuration.Headers.TryAdd("Authorization", Authorization);
}
