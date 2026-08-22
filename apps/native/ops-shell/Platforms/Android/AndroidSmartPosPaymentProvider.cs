using Android.App;
using Android.Content;
using AndroidUri = Android.Net.Uri;

namespace GiroMesa.OpsShell;

internal sealed class AndroidSmartPosPaymentProvider : ISmartPosPaymentProvider
{
    private readonly SmartPosIntentConfiguration _configuration;
    private readonly SmartPosPendingPaymentStore _store;
    private readonly SemaphoreSlim _operationLock = new(1, 1);

    public AndroidSmartPosPaymentProvider(
        SmartPosIntentConfiguration configuration,
        SmartPosPendingPaymentStore store)
    {
        _configuration = configuration;
        _store = store;
    }

    public async Task<SmartPosPaymentCapabilities> GetCapabilitiesAsync()
    {
        var state = await _store.LoadAsync();
        return new(
            state.Available,
            true,
            false,
            _configuration.Provider,
            _configuration.Environment,
            _configuration.Methods.OrderBy(method => method, StringComparer.Ordinal).ToArray(),
            state.Available,
            state.Available && _configuration.RecoverUriTemplate is not null,
            state.Available && _configuration.CancelUriTemplate is not null,
            state.Pending?.AttemptId,
            state.Available ? null : "SMARTPOS_PENDING_STORAGE_UNAVAILABLE");
    }

    public async Task<SmartPosPaymentResult> StartAsync(SmartPosPaymentRequest request)
    {
        if (!_configuration.Methods.Contains(request.Method))
            return Failed(request.AttemptId, "SMARTPOS_METHOD_NOT_ALLOWED");
        if (!await _operationLock.WaitAsync(0))
            return Failed(request.AttemptId, "SMARTPOS_OPERATION_IN_PROGRESS");

        try
        {
            var state = await _store.LoadAsync();
            if (!state.Available)
                return Failed(request.AttemptId, "SMARTPOS_PENDING_STORAGE_UNAVAILABLE");
            var existing = state.Pending;
            if (existing is not null)
            {
                return Unknown(
                    existing.AttemptId,
                    existing.AttemptId == request.AttemptId
                        ? "SMARTPOS_ATTEMPT_PENDING"
                        : "SMARTPOS_PENDING_ATTEMPT_EXISTS");
            }

            if (!_configuration.TryBuildUri(SmartPosOperation.Start, request, out var uri, out var errorCode))
                return Failed(request.AttemptId, errorCode ?? "SMARTPOS_URI_NOT_ALLOWED");

            var pending = new SmartPosPendingPayment(
                request.AttemptId,
                request.AmountCents,
                request.Method,
                _configuration.Provider,
                SmartPosOperation.Start,
                DateTimeOffset.UtcNow,
                request.Installments);
            if (!await _store.SaveAsync(pending))
                return Failed(request.AttemptId, "SMARTPOS_PENDING_STORAGE_UNAVAILABLE");

            var launchError = await LaunchAsync(uri!);
            if (WasNotLaunched(launchError))
            {
                if (!await _store.ClearAsync())
                    return Unknown(request.AttemptId, "SMARTPOS_PENDING_STORAGE_UNAVAILABLE");
                return Failed(request.AttemptId, launchError!);
            }

            return Unknown(request.AttemptId, launchError ?? "SMARTPOS_RESULT_UNVERIFIED", launched: true);
        }
        finally
        {
            _operationLock.Release();
        }
    }

    public Task<SmartPosPaymentResult> RecoverAsync(string attemptId) =>
        ResumeAsync(attemptId, SmartPosOperation.Recover);

    public Task<SmartPosPaymentResult> CancelAsync(string attemptId) =>
        ResumeAsync(attemptId, SmartPosOperation.Cancel);

    public Task<SmartPosPaymentResult> ReverseAsync(SmartPosReversalRequest request) =>
        Task.FromResult(SmartPosPaymentService.Failed(
            request.PaymentAttemptId,
            "SMARTPOS_REVERSAL_PROVIDER_UNAVAILABLE"));

    public Task<SmartPosPaymentResult> RecoverReversalAsync(SmartPosReversalRequest request) =>
        Task.FromResult(SmartPosPaymentService.Failed(
            request.PaymentAttemptId,
            "SMARTPOS_REVERSAL_RECOVERY_PROVIDER_UNAVAILABLE"));

    private async Task<SmartPosPaymentResult> ResumeAsync(string attemptId, SmartPosOperation operation)
    {
        if (!await _operationLock.WaitAsync(0))
            return Failed(attemptId, "SMARTPOS_OPERATION_IN_PROGRESS");

        try
        {
            var state = await _store.LoadAsync();
            if (!state.Available)
                return Unknown(attemptId, "SMARTPOS_PENDING_STORAGE_UNAVAILABLE");
            var pending = state.Pending;
            if (pending is null) return Failed(attemptId, "SMARTPOS_PENDING_ATTEMPT_NOT_FOUND");
            if (!string.Equals(pending.AttemptId, attemptId, StringComparison.Ordinal))
                return Unknown(pending.AttemptId, "SMARTPOS_PENDING_ATTEMPT_MISMATCH");
            if (!string.Equals(pending.Provider, _configuration.Provider, StringComparison.Ordinal))
                return Unknown(attemptId, "SMARTPOS_PENDING_PROVIDER_MISMATCH");

            var request = new SmartPosPaymentRequest(
                pending.AttemptId,
                pending.AmountCents,
                pending.Method,
                pending.Installments);
            if (!_configuration.TryBuildUri(operation, request, out var uri, out var errorCode))
                return Unknown(attemptId, errorCode ?? "SMARTPOS_URI_NOT_ALLOWED");

            if (!await _store.SaveAsync(pending with { Operation = operation, UpdatedAt = DateTimeOffset.UtcNow }))
                return Unknown(attemptId, "SMARTPOS_PENDING_STORAGE_UNAVAILABLE");

            var launchError = await LaunchAsync(uri!);
            return Unknown(
                attemptId,
                launchError ?? "SMARTPOS_RESULT_UNVERIFIED",
                launched: !WasNotLaunched(launchError));
        }
        finally
        {
            _operationLock.Release();
        }
    }

    private async Task<string?> LaunchAsync(Uri uri)
    {
        var androidUri = AndroidUri.Parse(uri.AbsoluteUri);
        if (androidUri is null) return "SMARTPOS_URI_NOT_ALLOWED";

        using var intent = new Intent(Intent.ActionView, androidUri);
        intent.SetPackage(_configuration.PackageName);
        intent.AddCategory(Intent.CategoryBrowsable);
        using var timeout = new CancellationTokenSource(_configuration.Timeout);
        try
        {
            await SmartPosActivityResultBroker.StartAsync(intent, timeout.Token);
            // A generic Activity result is not proof of financial approval. A homologated
            // provider adapter must validate its documented fields before returning success.
            return null;
        }
        catch (ActivityNotFoundException)
        {
            return "SMARTPOS_APP_NOT_INSTALLED";
        }
        catch (Java.Lang.SecurityException)
        {
            return "SMARTPOS_INTENT_REJECTED";
        }
        catch (OperationCanceledException)
        {
            return "SMARTPOS_RESULT_TIMEOUT";
        }
        catch (InvalidOperationException)
        {
            return "SMARTPOS_ACTIVITY_UNAVAILABLE";
        }
    }

    private static SmartPosPaymentResult Failed(string attemptId, string errorCode) =>
        new(false, false, "unavailable", attemptId, null, errorCode, false);

    private static SmartPosPaymentResult Unknown(string attemptId, string errorCode, bool launched = false) =>
        new(false, launched, "unknown", attemptId, null, errorCode, true);

    private static bool WasNotLaunched(string? errorCode) =>
        errorCode is "SMARTPOS_APP_NOT_INSTALLED" or
            "SMARTPOS_INTENT_REJECTED" or
            "SMARTPOS_ACTIVITY_UNAVAILABLE" or
            "SMARTPOS_URI_NOT_ALLOWED";
}

internal static class SmartPosActivityResultBroker
{
    private const int PaymentRequestCode = 43129;
    private static readonly object Sync = new();
    private static TaskCompletionSource<Result>? _pending;

    public static async Task<Result> StartAsync(Intent intent, CancellationToken cancellationToken)
    {
        var activity = Microsoft.Maui.ApplicationModel.Platform.CurrentActivity
            ?? throw new InvalidOperationException("Android activity is unavailable.");
        TaskCompletionSource<Result> completion;
        lock (Sync)
        {
            if (_pending is not null) throw new InvalidOperationException("A SmartPOS intent is already active.");
            completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending = completion;
        }

        try
        {
            await MainThread.InvokeOnMainThreadAsync(() =>
                activity.StartActivityForResult(intent, PaymentRequestCode));
            return await completion.Task.WaitAsync(cancellationToken);
        }
        finally
        {
            lock (Sync)
            {
                if (ReferenceEquals(_pending, completion)) _pending = null;
            }
        }
    }

    public static bool TryComplete(int requestCode, Result resultCode)
    {
        if (requestCode != PaymentRequestCode) return false;
        TaskCompletionSource<Result>? completion;
        lock (Sync)
        {
            completion = _pending;
            _pending = null;
        }
        return completion?.TrySetResult(resultCode) ?? false;
    }
}
