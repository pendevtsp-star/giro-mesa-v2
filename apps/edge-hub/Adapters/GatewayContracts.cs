namespace GiroMesa.EdgeHub.Adapters;

public sealed record CapabilityState(bool Configured, string Provider, string Message);

public sealed record PaymentRequest(
    string IdempotencyKey,
    long AmountInCents,
    string Method,
    string OrderId);

public sealed record PaymentResult(
    bool Success,
    string Status,
    string? ProviderReference,
    string? ErrorCode);

public interface IPaymentGateway
{
    CapabilityState Capability { get; }
    Task<PaymentResult> ExecuteAsync(PaymentRequest request, CancellationToken cancellationToken = default);
}

public sealed record FiscalRequest(
    string IdempotencyKey,
    string ActorIdentityId,
    string OrderId,
    long TotalInCents,
    string DocumentPayload);

public sealed record FiscalResult(
    bool Success,
    string Status,
    string? DocumentReference,
    string? ErrorCode);

public interface IFiscalGateway
{
    CapabilityState Capability { get; }
    Task<FiscalResult> IssueAsync(FiscalRequest request, CancellationToken cancellationToken = default);
}

public sealed record PrintRequest(
    string IdempotencyKey,
    string PrinterId,
    string Station,
    string Content);

public sealed record PrintResult(bool Success, string Status, string? ErrorCode);

public interface IPrinterGateway
{
    CapabilityState Capability { get; }
    Task<PrintResult> PrintAsync(PrintRequest request, CancellationToken cancellationToken = default);
}
