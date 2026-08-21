using System.Text.Json;

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

public sealed record FiscalConsultRequest(
    string ActorIdentityId,
    string DocumentReference);

public sealed record FiscalCancellationRequest(
    string ActorIdentityId,
    string Justification);

public sealed record FiscalNumberInvalidationRequest(
    string ActorIdentityId,
    string IdempotencyKey,
    string Cnpj,
    string Series,
    int InitialNumber,
    int FinalNumber,
    string Justification);

public sealed record FiscalResult(
    bool Success,
    string Status,
    string? DocumentReference,
    string? ErrorCode);

public interface IFiscalGateway
{
    CapabilityState Capability { get; }
    Task<FiscalResult> IssueAsync(FiscalRequest request, CancellationToken cancellationToken = default);
    Task<FiscalResult> ConsultAsync(FiscalConsultRequest request, CancellationToken cancellationToken = default);
    Task<FiscalResult> CancelAsync(
        string documentReference,
        FiscalCancellationRequest request,
        CancellationToken cancellationToken = default);
    Task<FiscalResult> InvalidateNumbersAsync(
        FiscalNumberInvalidationRequest request,
        CancellationToken cancellationToken = default);
}

public sealed record PrintRequest(
    string IdempotencyKey,
    string? PrinterId,
    string Station,
    string DocumentType,
    JsonElement Payload,
    int Copies = 1);

public sealed record PrintResult(
    bool Success,
    string Status,
    string? ErrorCode,
    int BytesWritten = 0,
    string? PrinterId = null,
    bool Duplicate = false);

public sealed record PrinterStatus(
    string Id,
    bool Configured,
    bool Available,
    bool IsDefault,
    int PaperWidthMm,
    string? ErrorCode = null);

public interface IPrinterGateway
{
    CapabilityState Capability { get; }
    Task<PrintResult> PrintAsync(PrintRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PrinterStatus>> GetStatusesAsync(CancellationToken cancellationToken = default);
}
