using GiroMesa.EdgeHub.Storage;

namespace GiroMesa.EdgeHub.Adapters;

public sealed class DisabledPaymentGateway : IPaymentGateway
{
    public CapabilityState Capability => new(false, "paygo", "PayGo requires contract, credentials, pinpad and homologation.");

    public Task<PaymentResult> ExecuteAsync(PaymentRequest request, CancellationToken cancellationToken = default) =>
        Task.FromResult(new PaymentResult(false, "unavailable", null, "PAYGO_NOT_CONFIGURED"));
}

public sealed class DisabledFiscalGateway : IFiscalGateway
{
    public CapabilityState Capability => new(false, "focus-nfe", "Focus NFe requires credentials and fiscal onboarding.");

    public Task<FiscalResult> IssueAsync(FiscalRequest request, CancellationToken cancellationToken = default) =>
        Task.FromResult(new FiscalResult(false, "unavailable", null, "FOCUS_NOT_CONFIGURED"));
}

public sealed class DisabledPrinterGateway : IPrinterGateway
{
    public CapabilityState Capability => new(false, "escpos", "No printer has been paired with this hub.");

    public Task<PrintResult> PrintAsync(PrintRequest request, CancellationToken cancellationToken = default) =>
        Task.FromResult(new PrintResult(false, "unavailable", "PRINTER_NOT_CONFIGURED"));
}

public sealed class LocalKitchenDispatchGateway(HubStore store) : IKitchenDispatchGateway
{
    public CapabilityState Capability { get; } = new(
        true,
        "local-kds-inbox",
        "KDS local persistente aguardando confirmação da estação.");

    public async Task<KitchenDispatchResult> DeliverAsync(
        KitchenDispatchRequest request,
        CancellationToken cancellationToken = default)
    {
        _ = cancellationToken;
        await store.PublishKitchenDispatchAsync(request);
        return new(true, "delivered", null);
    }
}
