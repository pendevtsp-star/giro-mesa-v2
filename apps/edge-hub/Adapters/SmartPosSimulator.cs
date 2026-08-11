using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace GiroMesa.EdgeHub.Adapters;

public enum SmartPosScenario
{
    Authorized,
    Declined,
    UnknownThenAuthorized,
}

public sealed class SmartPosSimulator(SmartPosScenario scenario = SmartPosScenario.Authorized) : IPaymentGateway
{
    private readonly ConcurrentDictionary<string, PaymentResult> _executions = new();
    private readonly ConcurrentDictionary<string, PaymentResult> _lookups = new();

    public CapabilityState Capability => new(
        true,
        "smartpos-simulator",
        "Contract simulator only; no acquirer or physical terminal is homologated.");

    public Task<PaymentResult> ExecuteAsync(
        PaymentRequest request,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey)
            || request.AmountInCents <= 0
            || string.IsNullOrWhiteSpace(request.Method)
            || string.IsNullOrWhiteSpace(request.OrderId))
        {
            return Task.FromResult(new PaymentResult(false, "declined", null, "SMARTPOS_REQUEST_INVALID"));
        }

        var result = _executions.GetOrAdd(request.IdempotencyKey, _ => CreateResult(request));
        return Task.FromResult(result);
    }

    public Task<PaymentResult> LookupAsync(
        string providerReference,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(providerReference)
            || !_lookups.TryGetValue(providerReference, out var result))
        {
            return Task.FromResult(new PaymentResult(
                false,
                "unknown",
                providerReference,
                "SMARTPOS_REFERENCE_NOT_FOUND"));
        }

        return Task.FromResult(result);
    }

    private PaymentResult CreateResult(PaymentRequest request)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(request.IdempotencyKey));
        var reference = $"sim-{Convert.ToHexString(digest)[..24].ToLowerInvariant()}";
        var initial = scenario switch
        {
            SmartPosScenario.Declined => new PaymentResult(false, "declined", reference, "SIMULATED_DECLINE"),
            SmartPosScenario.UnknownThenAuthorized => new PaymentResult(
                false,
                "unknown",
                reference,
                "SIMULATED_TIMEOUT_AFTER_SEND"),
            _ => new PaymentResult(true, "authorized", reference, null),
        };
        _lookups[reference] = scenario == SmartPosScenario.UnknownThenAuthorized
            ? new PaymentResult(true, "authorized", reference, null)
            : initial;
        return initial;
    }
}
