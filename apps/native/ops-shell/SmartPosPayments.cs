using System.Text.Json;

namespace GiroMesa.OpsShell;

internal interface ISmartPosPaymentProvider
{
    Task<SmartPosPaymentCapabilities> GetCapabilitiesAsync();
    Task<SmartPosPaymentResult> StartAsync(SmartPosPaymentRequest request);
    Task<SmartPosPaymentResult> RecoverAsync(string attemptId);
    Task<SmartPosPaymentResult> CancelAsync(string attemptId);
    Task<SmartPosPaymentResult> ReverseAsync(SmartPosReversalRequest request);
    Task<SmartPosPaymentResult> RecoverReversalAsync(SmartPosReversalRequest request);
}

public sealed class SmartPosPaymentService
{
    private readonly ISmartPosPaymentProvider _provider;
    private readonly ISmartPosPaymentAttemptResolver _attemptResolver;
    private readonly SmartPosResultOutbox? _outbox;
    private readonly ISmartPosResultSink? _resultSink;
    private readonly ISmartPosReversalResolver? _reversalResolver;

    internal SmartPosPaymentService(
        ISmartPosPaymentProvider provider,
        ISmartPosPaymentAttemptResolver attemptResolver,
        SmartPosResultOutbox? outbox = null,
        ISmartPosResultSink? resultSink = null,
        ISmartPosReversalResolver? reversalResolver = null)
    {
        _provider = provider;
        _attemptResolver = attemptResolver;
        _outbox = outbox;
        _resultSink = resultSink;
        _reversalResolver = reversalResolver;
    }

    public async Task<SmartPosPaymentCapabilities> GetCapabilitiesAsync()
    {
        if (_outbox is not null && _resultSink is not null)
            await _outbox.FlushAsync(_resultSink);
        var capabilities = await _provider.GetCapabilitiesAsync();
        if (!capabilities.CanStart) return capabilities;
        if (!_attemptResolver.Available)
        {
            return capabilities with
            {
                CanStart = false,
                ErrorCode = "SMARTPOS_TRUSTED_ATTEMPT_RESOLVER_UNAVAILABLE",
            };
        }
        if (!capabilities.Homologated)
        {
            return capabilities with
            {
                CanStart = false,
                ErrorCode = "SMARTPOS_NATIVE_PROVIDER_NOT_HOMOLOGATED",
            };
        }
        var authorization = await _attemptResolver.GetAuthorizationAsync();
        if (!authorization.Allows(capabilities))
        {
            return capabilities with
            {
                CanStart = false,
                Homologated = false,
                ErrorCode = authorization.ErrorCode ?? "SMARTPOS_CERTIFICATION_MISMATCH",
            };
        }
        if (_outbox is not null && !await _outbox.CanAcceptAsync())
        {
            return capabilities with
            {
                CanStart = false,
                ErrorCode = "SMARTPOS_RESULT_OUTBOX_FULL",
            };
        }
        return capabilities with
        {
            Methods = capabilities.Methods
                .Intersect(authorization.Methods, StringComparer.Ordinal)
                .OrderBy(method => method, StringComparer.Ordinal)
                .ToArray(),
            CanRecover = capabilities.CanRecover && authorization.CanRecover,
            CanCancel = capabilities.CanCancel && authorization.CanCancel,
            CanReverse = capabilities.CanReverse && authorization.CanReverse,
        };
    }

    public async Task<SmartPosPaymentResult> StartAsync(string attemptId)
    {
        if (!TryNormalizeAttemptId(attemptId, out var normalized))
            return Failed(null, "SMARTPOS_ATTEMPT_ID_INVALID");

        var capabilities = await GetCapabilitiesAsync();
        if (!capabilities.CanStart)
            return Failed(normalized, capabilities.ErrorCode ?? "SMARTPOS_PROVIDER_UNAVAILABLE");

        var resolution = await _attemptResolver.ResolveAsync(normalized);
        if (!resolution.Success || resolution.Request is null)
            return Failed(normalized, resolution.ErrorCode ?? "SMARTPOS_TRUSTED_ATTEMPT_RESOLVER_UNAVAILABLE");
        if (!resolution.Request.IsValid ||
            !string.Equals(resolution.Request.AttemptId, normalized, StringComparison.Ordinal) ||
            !string.Equals(resolution.Provider, capabilities.Provider, StringComparison.Ordinal) ||
            !resolution.CertificationHomologated ||
            !capabilities.Methods.Contains(resolution.Request.Method, StringComparer.Ordinal))
        {
            return Failed(normalized, "SMARTPOS_TRUSTED_ATTEMPT_INVALID");
        }
        var providerResult = resolution.Action switch
        {
            SmartPosLaunchAction.Start => await _provider.StartAsync(resolution.Request),
            SmartPosLaunchAction.Recover => await _provider.RecoverAsync(normalized),
            SmartPosLaunchAction.Cancel => await _provider.CancelAsync(normalized),
            _ => Failed(normalized, "SMARTPOS_CLAIM_ACTION_INVALID"),
        };
        return await PersistAndFlushResultAsync(providerResult, normalized);
    }

    public async Task<SmartPosPaymentResult> RecoverAsync(string attemptId)
    {
        if (!TryNormalizeAttemptId(attemptId, out var normalized))
            return Failed(null, "SMARTPOS_ATTEMPT_ID_INVALID");
        var capabilities = await GetCapabilitiesAsync();
        if (!capabilities.CanRecover)
            return Failed(normalized, capabilities.ErrorCode ?? "SMARTPOS_RECOVERY_NOT_AVAILABLE");
        var resolution = await _attemptResolver.ResolveAsync(normalized);
        if (!IsTrustedResolution(resolution, capabilities, normalized) ||
            resolution.Action != SmartPosLaunchAction.Recover)
            return Failed(normalized, resolution.ErrorCode ?? "SMARTPOS_RECOVERY_NOT_AUTHORIZED");
        return await PersistAndFlushResultAsync(await _provider.RecoverAsync(normalized), normalized);
    }

    public async Task<SmartPosPaymentResult> CancelAsync(string attemptId)
    {
        if (!TryNormalizeAttemptId(attemptId, out var normalized))
            return Failed(null, "SMARTPOS_ATTEMPT_ID_INVALID");
        var capabilities = await GetCapabilitiesAsync();
        if (!capabilities.CanCancel)
            return Failed(normalized, capabilities.ErrorCode ?? "SMARTPOS_CANCEL_NOT_AVAILABLE");
        var resolution = await _attemptResolver.ResolveAsync(normalized);
        if (!IsTrustedResolution(resolution, capabilities, normalized) ||
            resolution.Action != SmartPosLaunchAction.Cancel)
            return Failed(normalized, resolution.ErrorCode ?? "SMARTPOS_CANCEL_NOT_AUTHORIZED");
        return await PersistAndFlushResultAsync(await _provider.CancelAsync(normalized), normalized);
    }

    public async Task<SmartPosPaymentResult> ReverseAsync(string reversalId)
    {
        if (!Guid.TryParse(reversalId, out var parsedReversalId))
            return Failed(null, "SMARTPOS_REVERSAL_ID_INVALID");
        var capabilities = await GetCapabilitiesAsync();
        if (!capabilities.CanReverse || _reversalResolver is null)
            return Failed(null, "SMARTPOS_REVERSAL_PROVIDER_UNAVAILABLE");
        var resolution = await _reversalResolver.ResolveAsync(parsedReversalId.ToString());
        if (!resolution.Success || resolution.Request is null || !resolution.Request.IsValid ||
            !string.Equals(resolution.Request.Provider, capabilities.Provider, StringComparison.Ordinal))
        {
            return Failed(
                resolution.Request?.PaymentAttemptId,
                resolution.ErrorCode ?? "SMARTPOS_REVERSAL_CLAIM_INVALID");
        }
        var result = resolution.Action switch
        {
            SmartPosReversalLaunchAction.Reverse => await _provider.ReverseAsync(resolution.Request),
            SmartPosReversalLaunchAction.Recover => await _provider.RecoverReversalAsync(resolution.Request),
            _ => Failed(resolution.Request.PaymentAttemptId, "SMARTPOS_REVERSAL_ACTION_INVALID"),
        };
        return await PersistAndFlushResultAsync(
            result,
            resolution.Request.PaymentAttemptId,
            resolution.Request.ReversalId);
    }

    internal Task<SmartPosOutboxFlushResult> FlushResultsAsync(CancellationToken cancellationToken = default) =>
        _outbox is not null && _resultSink is not null
            ? _outbox.FlushAsync(_resultSink, cancellationToken)
            : Task.FromResult(new SmartPosOutboxFlushResult(
                0,
                0,
                0,
                "SMARTPOS_RESULT_SINK_UNAVAILABLE"));

    internal static SmartPosPaymentService Create(
        SmartPosPendingPaymentStore store,
        ISmartPosPaymentAttemptResolver attemptResolver,
        SmartPosResultOutbox outbox,
        ISmartPosResultSink resultSink,
        ISmartPosReversalResolver reversalResolver)
    {
        var configuration = SmartPosIntentConfiguration.Load(typeof(SmartPosPaymentService).Assembly);
#if ANDROID
        var validationError = configuration.Validate();
        return validationError is null
            ? new SmartPosPaymentService(
                new AndroidSmartPosPaymentProvider(configuration, store),
                attemptResolver,
                outbox,
                resultSink,
                reversalResolver)
            : new SmartPosPaymentService(
                new DisabledSmartPosPaymentProvider(store, configuration, validationError),
                attemptResolver,
                outbox,
                resultSink,
                reversalResolver);
#else
        return new SmartPosPaymentService(new DisabledSmartPosPaymentProvider(
            store,
            configuration,
            configuration.IsConfigured ? "SMARTPOS_ANDROID_REQUIRED" : "SMARTPOS_NOT_CONFIGURED"),
            attemptResolver,
            outbox,
            resultSink,
            reversalResolver);
#endif
    }

    internal static SmartPosPaymentResult Failed(string? attemptId, string errorCode) =>
        new(false, false, "unavailable", attemptId, null, errorCode, false);

    private static bool TryNormalizeAttemptId(string attemptId, out string normalized)
    {
        normalized = string.Empty;
        if (!Guid.TryParse(attemptId, out var parsed)) return false;
        normalized = parsed.ToString();
        return true;
    }

    private static bool IsTrustedResolution(
        SmartPosPaymentAttemptResolution resolution,
        SmartPosPaymentCapabilities capabilities,
        string attemptId) =>
        resolution.Success && resolution.Request is not null && resolution.Request.IsValid &&
        resolution.CertificationHomologated &&
        string.Equals(resolution.Request.AttemptId, attemptId, StringComparison.Ordinal) &&
        string.Equals(resolution.Provider, capabilities.Provider, StringComparison.Ordinal) &&
        capabilities.Methods.Contains(resolution.Request.Method, StringComparer.Ordinal);

    private async Task<SmartPosPaymentResult> PersistAndFlushResultAsync(
        SmartPosPaymentResult result,
        string expectedAttemptId,
        string? reversalId = null)
    {
        var resultToPersist = result;
        var response = result;
        if (!TryNormalizeAttemptId(result.AttemptId ?? string.Empty, out var actualAttemptId) ||
            !string.Equals(actualAttemptId, expectedAttemptId, StringComparison.Ordinal))
        {
            response = ReconciliationRequired(
                result,
                expectedAttemptId,
                "SMARTPOS_PROVIDER_ATTEMPT_MISMATCH");
            resultToPersist = response;
        }
        var envelope = SmartPosResultEnvelope.FromProviderResult(resultToPersist);
        if (envelope is null)
        {
            if (!resultToPersist.Success && resultToPersist.Status != "approved") return resultToPersist;
            response = ReconciliationRequired(
                resultToPersist,
                expectedAttemptId,
                "SMARTPOS_PROVIDER_RESULT_UNSAFE");
            resultToPersist = response;
            envelope = SmartPosResultEnvelope.FromProviderResult(resultToPersist);
        }
        if (envelope is null || _outbox is null || _resultSink is null)
        {
            return ReconciliationRequired(
                resultToPersist,
                expectedAttemptId,
                "SMARTPOS_RESULT_SINK_UNAVAILABLE");
        }
        if (reversalId is not null)
            envelope = envelope with { Operation = "reversal", ReversalId = reversalId };
        if (!await _outbox.EnqueueAsync(envelope))
        {
            return ReconciliationRequired(
                resultToPersist,
                expectedAttemptId,
                "SMARTPOS_RESULT_OUTBOX_UNAVAILABLE");
        }
        var flush = await _outbox.FlushAsync(_resultSink);
        return flush.Remaining == 0 && flush.Quarantined == 0
            ? response
            : response with { RequiresReconciliation = true };
    }

    private static SmartPosPaymentResult ReconciliationRequired(
        SmartPosPaymentResult result,
        string expectedAttemptId,
        string errorCode) =>
        new(
            false,
            result.Launched,
            "unknown",
            expectedAttemptId,
            null,
            errorCode,
            true);
}

internal interface ISmartPosReversalResolver
{
    Task<SmartPosReversalResolution> ResolveAsync(string reversalId);
}

internal sealed record SmartPosReversalResolution(
    bool Success,
    SmartPosReversalRequest? Request,
    SmartPosReversalLaunchAction Action,
    string? ErrorCode);

internal enum SmartPosReversalLaunchAction
{
    None,
    Reverse,
    Recover,
}

internal interface ISmartPosPaymentAttemptResolver
{
    bool Available { get; }
    Task<SmartPosBackendCapabilities> GetAuthorizationAsync();
    Task<SmartPosPaymentAttemptResolution> ResolveAsync(string attemptId);
}

internal enum SmartPosLaunchAction
{
    None,
    Start,
    Recover,
    Cancel,
}

internal sealed record SmartPosPaymentAttemptResolution(
    bool Success,
    SmartPosPaymentRequest? Request,
    string? Provider,
    SmartPosLaunchAction Action,
    bool CertificationHomologated,
    string? ErrorCode);

internal sealed class UnavailableSmartPosPaymentAttemptResolver : ISmartPosPaymentAttemptResolver
{
    public bool Available => false;

    public Task<SmartPosBackendCapabilities> GetAuthorizationAsync() =>
        Task.FromResult(SmartPosBackendCapabilities.Unavailable(
            "SMARTPOS_TRUSTED_ATTEMPT_RESOLVER_UNAVAILABLE"));

    public Task<SmartPosPaymentAttemptResolution> ResolveAsync(string attemptId) =>
        Task.FromResult(new SmartPosPaymentAttemptResolution(
            false,
            null,
            null,
            SmartPosLaunchAction.None,
            false,
            "SMARTPOS_TRUSTED_ATTEMPT_RESOLVER_UNAVAILABLE"));
}

internal sealed class DisabledSmartPosPaymentProvider : ISmartPosPaymentProvider
{
    private readonly SmartPosPendingPaymentStore _store;
    private readonly SmartPosIntentConfiguration _configuration;
    private readonly string _errorCode;

    public DisabledSmartPosPaymentProvider(
        SmartPosPendingPaymentStore store,
        SmartPosIntentConfiguration configuration,
        string errorCode)
    {
        _store = store;
        _configuration = configuration;
        _errorCode = errorCode;
    }

    public async Task<SmartPosPaymentCapabilities> GetCapabilitiesAsync()
    {
        var state = await _store.LoadAsync();
        return new(
            false,
            _configuration.IsConfigured,
            false,
            _configuration.Provider,
            _configuration.Environment,
            [],
            false,
            false,
            false,
            state.Pending?.AttemptId,
            _errorCode);
    }

    public Task<SmartPosPaymentResult> StartAsync(SmartPosPaymentRequest request) =>
        Task.FromResult(SmartPosPaymentService.Failed(request.AttemptId, _errorCode));

    public Task<SmartPosPaymentResult> RecoverAsync(string attemptId) =>
        Task.FromResult(SmartPosPaymentService.Failed(attemptId, _errorCode));

    public Task<SmartPosPaymentResult> CancelAsync(string attemptId) =>
        Task.FromResult(SmartPosPaymentService.Failed(attemptId, _errorCode));

    public Task<SmartPosPaymentResult> ReverseAsync(SmartPosReversalRequest request) =>
        Task.FromResult(SmartPosPaymentService.Failed(
            request.PaymentAttemptId,
            "SMARTPOS_REVERSAL_PROVIDER_UNAVAILABLE"));

    public Task<SmartPosPaymentResult> RecoverReversalAsync(SmartPosReversalRequest request) =>
        Task.FromResult(SmartPosPaymentService.Failed(
            request.PaymentAttemptId,
            "SMARTPOS_REVERSAL_RECOVERY_PROVIDER_UNAVAILABLE"));
}

internal sealed class SmartPosPendingPaymentStore
{
    private const string PendingPaymentKey = "smartpos_pending_payment_v1";

    public async Task<bool> SaveAsync(SmartPosPendingPayment pending)
    {
        if (!pending.IsValid) return false;
        try
        {
            await SecureStorage.Default.SetAsync(PendingPaymentKey, JsonSerializer.Serialize(pending));
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return false;
        }
    }

    public async Task<SmartPosPendingPaymentState> LoadAsync()
    {
        try
        {
            var value = await SecureStorage.Default.GetAsync(PendingPaymentKey);
            var pending = string.IsNullOrWhiteSpace(value)
                ? null
                : JsonSerializer.Deserialize<SmartPosPendingPayment>(value);
            if (pending is not null && !pending.IsValid) return new(false, null);
            return new(true, pending);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return new(false, null);
        }
    }

    public Task<bool> ClearAsync()
    {
        try
        {
            SecureStorage.Default.Remove(PendingPaymentKey);
            return Task.FromResult(true);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return Task.FromResult(false);
        }
    }
}

internal sealed record SmartPosPendingPaymentState(bool Available, SmartPosPendingPayment? Pending);
