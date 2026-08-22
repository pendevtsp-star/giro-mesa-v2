using GiroMesa.OpsShell;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var validValues = new Dictionary<string, string>(StringComparer.Ordinal)
{
    ["Provider"] = "generic_intent",
    ["Environment"] = "homologation",
    ["Package"] = "br.com.example.smartpos",
    ["AllowedPackages"] = "br.com.example.smartpos",
    ["AllowedSchemes"] = "examplepay",
    ["Methods"] = "credit_card,debit_card,pix",
    ["StartUriTemplate"] = "examplepay://payment/start?attempt={attemptId}&amount={amountCents}&method={method}",
    ["RecoverUriTemplate"] = "examplepay://payment/recover?attempt={attemptId}",
    ["CancelUriTemplate"] = "examplepay://payment/cancel?attempt={attemptId}",
    ["TimeoutSeconds"] = "180",
};

var configuration = SmartPosIntentConfiguration.FromValues(validValues);
Assert(configuration.Validate() is null, "a homologation config with exact allowlists should validate");

var attemptId = Guid.NewGuid().ToString();
var request = new SmartPosPaymentRequest(attemptId, 12345, "credit_card");
Assert(request.IsValid, "a trusted payment request should validate");
Assert(
    configuration.TryBuildUri(SmartPosOperation.Start, request, out var uri, out var uriError) && uriError is null,
    "a configured start URI should build");
Assert(uri!.Scheme == "examplepay", "only the configured custom scheme should be used");
Assert(uri.Query.Contains("amount=12345", StringComparison.Ordinal), "amount cents should be preserved");

Assert(!new SmartPosPaymentRequest(attemptId, 0, "credit_card").IsValid, "zero-value payments should be rejected");
Assert(!new SmartPosPaymentRequest(attemptId, 100, "voucher").IsValid, "unsupported methods should be rejected");

var roguePackage = new Dictionary<string, string>(validValues, StringComparer.Ordinal)
{
    ["Package"] = "br.com.attacker.app",
};
Assert(
    SmartPosIntentConfiguration.FromValues(roguePackage).Validate() == "SMARTPOS_PACKAGE_NOT_ALLOWED",
    "the target package must be in the immutable allowlist");

var unsafeScheme = new Dictionary<string, string>(validValues, StringComparer.Ordinal)
{
    ["AllowedSchemes"] = "https",
};
Assert(
    SmartPosIntentConfiguration.FromValues(unsafeScheme).Validate() == "SMARTPOS_SCHEME_NOT_ALLOWED",
    "web and file-like schemes must remain forbidden");

var productionGeneric = new Dictionary<string, string>(validValues, StringComparer.Ordinal)
{
    ["Environment"] = "production",
};
Assert(
    SmartPosIntentConfiguration.FromValues(productionGeneric).Validate() == "SMARTPOS_PROVIDER_NOT_HOMOLOGATED",
    "the generic adapter must fail closed outside homologation");

var redeConfiguration = new Dictionary<string, string>(validValues, StringComparer.Ordinal)
{
    ["Provider"] = "rede",
};
Assert(
    SmartPosIntentConfiguration.FromValues(redeConfiguration).Validate() ==
        "SMARTPOS_REDE_PRIVATE_CONTRACT_AND_HOMOLOGATION_REQUIRED",
    "Rede must remain fail-closed without its private contract and hardware homologation");

using var unorderedJson = JsonDocument.Parse("{\"z\":1,\"nested\":{\"b\":2,\"a\":1},\"a\":[2,1]}");
using var orderedJson = JsonDocument.Parse("{\"a\":[2,1],\"nested\":{\"a\":1,\"b\":2},\"z\":1}");
var canonical = SmartPosRequestSigner.CanonicalJson(unorderedJson.RootElement);
Assert(
    canonical.SequenceEqual(SmartPosRequestSigner.CanonicalJson(orderedJson.RootElement)),
    "canonical JSON must recursively sort object keys while preserving array order");
using var unicodeJson = JsonDocument.Parse(
    "{\"Z\":\"maquininha\",\"z\":\"<>&\\u2028\",\"\\u00e9\":\"a\\u00e7\\u00e3o\",\"\\ud83d\\ude00\":{\"A\":\"Rede\",\"\\u03b2\":\"Pix\"}}");
var unicodeCanonical = Encoding.UTF8.GetString(
    SmartPosRequestSigner.CanonicalJson(unicodeJson.RootElement));
Assert(
    unicodeCanonical ==
        "{\"Z\":\"maquininha\",\"z\":\"<>&\u2028\",\"é\":\"ação\",\"😀\":{\"A\":\"Rede\",\"β\":\"Pix\"}}",
    "canonical JSON must match JSON.stringify bytes for Unicode, HTML characters, and U+2028");
Assert(
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(unicodeCanonical))).ToLowerInvariant() ==
        "38d681a24aa72ab626acc5b52418f64da03aa7485e4823e8cbbef9523cd41c86",
    "canonical JSON must match the backend v1 SHA-256 vector");
var keyPair = SmartPosRequestSigner.CreateP256KeyPair();
var credential = new SmartPosDeviceCredential(
    Guid.NewGuid().ToString(),
    Guid.NewGuid().ToString(),
    "https://api.giromesa.test",
    keyPair.PrivateKeyPkcs8,
    keyPair.PublicKeySpki,
    DateTimeOffset.UtcNow.AddDays(1),
    DateTimeOffset.UtcNow.AddHours(12));
var signer = new SmartPosRequestSigner(
    () => DateTimeOffset.FromUnixTimeSeconds(1_700_000_000),
    () => "fixed-nonce");
var signedUri = new Uri("https://api.giromesa.test/api/v1/device/payment-attempts/1/claim");
var signed = signer.Sign(HttpMethod.Post, signedUri, canonical, credential);
var signatureBytes = DecodeBase64Url(signed.Signature);
Assert(signatureBytes.Length == 64, "P-256 signatures must use fixed 64-byte IEEE-P1363 format");
var bodyHash = Convert.ToHexString(SHA256.HashData(canonical)).ToLowerInvariant();
var signingInput = string.Join(
    '\n',
    "POST",
    signedUri.PathAndQuery,
    signed.Timestamp,
    signed.Nonce,
    bodyHash);
using var publicKey = ECDsa.Create();
publicKey.ImportSubjectPublicKeyInfo(Convert.FromBase64String(keyPair.PublicKeySpki), out _);
Assert(
    publicKey.VerifyData(
        Encoding.UTF8.GetBytes(signingInput),
        signatureBytes,
        HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation),
    "the exported SPKI public key must verify the canonical request signature");

var canceledEnvelope = SmartPosResultEnvelope.FromProviderResult(new SmartPosPaymentResult(
    false,
    true,
    "canceled",
    attemptId,
    null,
    "PAYMENT_CANCELED",
    false));
Assert(canceledEnvelope?.IsValid == true, "canceled provider outcomes must be durably queueable");
Assert(
    !new SmartPosResultEnvelope(
        Guid.NewGuid().ToString(),
        attemptId,
        "declined",
        null,
        null,
        "PAN 4111111111111111",
        DateTimeOffset.UtcNow).IsValid,
    "free-form provider/card payloads must not enter the result outbox");
Assert(
    new SmartPosCertificationPayload("certification-1", "rede", "approved")
        .IsHomologatedFor("rede"),
    "only an approved certification for the exact provider may authorize a claim");
Assert(
    !new SmartPosCertificationPayload("certification-1", "rede", "suspended")
        .IsHomologatedFor("rede"),
    "a suspended certification must fail closed");
var capabilityFixture = JsonSerializer.Deserialize<SmartPosBackendCapabilities>(
    $$"""
    {
      "installationId":"{{Guid.NewGuid()}}",
      "available":true,
      "status":"homologated",
      "provider":"generic_intent",
      "methods":["credit_card"],
      "maxInstallments":12,
      "supports":{"cancel":true,"recover":true,"reversal":false},
      "reason":null,
      "certificationId":"certification-1",
      "diagnosticsMatch":true,
      "killSwitch":{"enabled":false,"reason":null}
    }
    """,
    SmartPosJson.Options);
var parsedCapability = capabilityFixture ?? throw new InvalidOperationException("capability fixture did not parse");
Assert(parsedCapability.IsHomologated, "the native capability DTO must match the backend wire");
Assert(
    parsedCapability.CanRecover && parsedCapability.CanCancel && !parsedCapability.CanReverse,
    "nested backend support flags must drive native capabilities");
var resultJson = Encoding.UTF8.GetString(SmartPosRequestSigner.CanonicalJson(new
{
    resultId = Guid.NewGuid().ToString(),
    status = "declined",
    providerReference = (string?)null,
    failureCode = "DECLINED",
}));
Assert(
    !resultJson.Contains("providerReference", StringComparison.Ordinal),
    "optional device-result fields must be omitted instead of serialized as null");
var safeProviderResult = new SmartPosResultEnvelope(
    Guid.NewGuid().ToString(),
    attemptId,
    "approved",
    "REDE-NSU-123456",
    "AUTH-123456",
    null,
    DateTimeOffset.UtcNow);
Assert(safeProviderResult.IsValid, "sanitized provider identifiers should remain valid");
Assert(
    !(safeProviderResult with { ProviderReference = "4111111111111111" }).IsValid,
    "a plain Luhn-valid PAN must never enter the result outbox");
Assert(
    !(safeProviderResult with { ProviderReference = "4111-1111-1111-1111" }).IsValid,
    "a formatted Luhn-valid PAN must never enter the result outbox");
Assert(
    !(safeProviderResult with { AuthorizationCode = "4111111111111111" }).IsValid,
    "authorization identifiers must reject Luhn-valid PAN values");

var pairingLink =
    $"giromesa://smartpos/pair?apiBaseUrl={Uri.EscapeDataString("https://api.giromesa.test")}" +
    "&code=abcd1234";
Assert(SmartPosPairingDeepLinkInbox.TryCapture(pairingLink), "the OS pairing deep link must validate");
var capturedPairing = SmartPosPairingDeepLinkInbox.Consume();
Assert(capturedPairing?.Code == "ABCD1234", "pairing codes must normalize before redemption");
Assert(SmartPosPairingDeepLinkInbox.Consume() is null, "pairing links must be consumed only once");
Assert(
    !SmartPosPairingDeepLinkInbox.TryCapture(
        "giromesa://smartpos/pair?apiBaseUrl=http%3A%2F%2Finsecure.test&code=ABCD1234"),
    "pairing deep links must reject non-HTTPS API URLs");
Assert(
    SmartPosDeviceApiClient.NormalizeApiBaseUrl("https://api.giromesa.test") is not null,
    "the signed build API origin must be accepted");
Assert(
    SmartPosDeviceApiClient.NormalizeApiBaseUrl("https://attacker.example") is null,
    "a QR code must not redirect the signed app to another API origin");

var provider = new RecordingProvider();
var service = new SmartPosPaymentService(provider, new UnavailableSmartPosPaymentAttemptResolver());
var capabilities = await service.GetCapabilitiesAsync();
Assert(!capabilities.CanStart, "payment start must remain disabled without a trusted native resolver");
Assert(
    capabilities.ErrorCode == "SMARTPOS_TRUSTED_ATTEMPT_RESOLVER_UNAVAILABLE",
    "capabilities should explain the trusted-resolver requirement");
var blockedStart = await service.StartAsync(attemptId);
Assert(!blockedStart.Success, "an unresolved attempt must not be sent to the provider");
Assert(provider.StartCalls == 0, "untrusted WebView values must never reach a payment provider");

var disabledService = new SmartPosPaymentService(
    new UnavailableProvider(),
    new UnavailableSmartPosPaymentAttemptResolver());
var disabledStart = await disabledService.StartAsync(attemptId);
Assert(
    disabledStart.ErrorCode == "SMARTPOS_NOT_CONFIGURED",
    "provider availability should be checked before resolving an attempt");

var recoverProvider = new RecordingProvider(homologated: true);
var recoverService = new SmartPosPaymentService(recoverProvider, new RecoveringResolver(attemptId));
var recovered = await recoverService.StartAsync(attemptId);
Assert(recovered.Launched, "a server-authorized recovery should reach the native recover path");
Assert(recoverProvider.StartCalls == 0, "action=recover must never start a new charge");
Assert(recoverProvider.RecoverCalls == 1, "action=recover must execute exactly one provider recovery");
var cancelProvider = new RecordingProvider(homologated: true);
var cancelService = new SmartPosPaymentService(
    cancelProvider,
    new RecoveringResolver(attemptId, SmartPosLaunchAction.Cancel));
var canceled = await cancelService.CancelAsync(attemptId);
Assert(canceled.Launched, "a server-authorized cancel should reach the provider cancel path");
Assert(cancelProvider.StartCalls == 0, "an authorized cancel must never start a charge");
Assert(cancelProvider.CancelCalls == 1, "cancel must execute only after the signed claim action");
var mismatchSink = new RecordingResultSink();
var mismatchService = new SmartPosPaymentService(
    new RecordingProvider(homologated: true, returnedAttemptId: Guid.NewGuid().ToString()),
    new RecoveringResolver(attemptId, SmartPosLaunchAction.Start),
    new SmartPosResultOutbox(),
    mismatchSink);
var mismatched = await mismatchService.StartAsync(attemptId);
Assert(
    !mismatched.Success && mismatched.Status == "unknown" && mismatched.AttemptId == attemptId &&
        mismatched.RequiresReconciliation,
    "a provider result for another attempt must become unknown for the expected attempt");
Assert(
    mismatchSink.Results.Count == 1 && mismatchSink.Results[0].AttemptId == attemptId &&
        mismatchSink.Results[0].FailureCode == "SMARTPOS_PROVIDER_ATTEMPT_MISMATCH",
    "attempt mismatches must be persisted as a sanitized durable incident");
var unsafeSink = new RecordingResultSink();
var unsafeService = new SmartPosPaymentService(
    new RecordingProvider(homologated: true, unsafeApproved: true),
    new RecoveringResolver(attemptId, SmartPosLaunchAction.Start),
    new SmartPosResultOutbox(),
    unsafeSink);
var unsafeApproved = await unsafeService.StartAsync(attemptId);
Assert(
    !unsafeApproved.Success && unsafeApproved.Status == "unknown" &&
        unsafeApproved.RequiresReconciliation,
    "an approved provider payload that cannot be sanitized must never return success");
Assert(
    unsafeSink.Results.Count == 1 && unsafeSink.Results[0].ProviderReference is null &&
        unsafeSink.Results[0].FailureCode == "SMARTPOS_PROVIDER_RESULT_UNSAFE",
    "unsafe approvals must persist only a minimal sanitized incident");
var unavailableReversal = await recoverService.ReverseAsync(Guid.NewGuid().ToString());
Assert(
    unavailableReversal.ErrorCode == "SMARTPOS_REVERSAL_PROVIDER_UNAVAILABLE",
    "reversal must remain fail-closed without a homologated native provider adapter");

var reversalId = Guid.NewGuid().ToString();
var reversalProvider = new RecordingProvider(homologated: true, canReverse: true);
var reversalService = new SmartPosPaymentService(
    reversalProvider,
    new RecoveringResolver(attemptId, canReverse: true),
    new SmartPosResultOutbox(),
    new RecordingResultSink(),
    new StaticReversalResolver(reversalId, attemptId, SmartPosReversalLaunchAction.Recover));
await reversalService.ReverseAsync(reversalId);
Assert(
    reversalProvider.ReverseCalls == 0,
    "a replayed reversal claim must never execute a second reversal");
Assert(
    reversalProvider.RecoverReversalCalls == 1,
    "action=recover must execute only the provider reversal-recovery path");

var firstPermanentResult = safeProviderResult with
{
    ResultId = Guid.NewGuid().ToString(),
    AttemptId = Guid.NewGuid().ToString(),
};
var followingAcceptedResult = safeProviderResult with
{
    ResultId = Guid.NewGuid().ToString(),
    AttemptId = Guid.NewGuid().ToString(),
};
var quarantineOutbox = new SmartPosResultOutbox();
Assert(await quarantineOutbox.EnqueueAsync(firstPermanentResult), "the first result should queue");
Assert(await quarantineOutbox.EnqueueAsync(followingAcceptedResult), "the following result should queue");
var permanentThenAcceptingSink = new PermanentThenAcceptingResultSink();
var quarantineFlush = await quarantineOutbox.FlushAsync(permanentThenAcceptingSink);
Assert(
    quarantineFlush.Submitted == 1 && quarantineFlush.Quarantined == 1 &&
        quarantineFlush.Remaining == 0 && permanentThenAcceptingSink.Calls == 2,
    "a permanent rejection must enter durable quarantine without blocking later results");
var durableQuarantine = await new SmartPosResultOutbox().FlushAsync(new RecordingResultSink());
Assert(
    durableQuarantine.Quarantined == 1 && durableQuarantine.Remaining == 0,
    "permanent result rejection must remain visible after recreating the outbox");

Console.WriteLine("SmartPOS contract self-check passed.");

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static byte[] DecodeBase64Url(string value)
{
    var padded = value.Replace('-', '+').Replace('_', '/');
    padded += new string('=', (4 - padded.Length % 4) % 4);
    return Convert.FromBase64String(padded);
}

internal sealed class RecordingProvider : ISmartPosPaymentProvider
{
    private readonly bool _homologated;
    private readonly string? _returnedAttemptId;
    private readonly bool _unsafeApproved;
    private readonly bool _canReverse;

    public RecordingProvider(
        bool homologated = false,
        string? returnedAttemptId = null,
        bool unsafeApproved = false,
        bool canReverse = false)
    {
        _homologated = homologated;
        _returnedAttemptId = returnedAttemptId;
        _unsafeApproved = unsafeApproved;
        _canReverse = canReverse;
    }

    public int StartCalls { get; private set; }
    public int RecoverCalls { get; private set; }
    public int CancelCalls { get; private set; }
    public int ReverseCalls { get; private set; }
    public int RecoverReversalCalls { get; private set; }

    public Task<SmartPosPaymentCapabilities> GetCapabilitiesAsync() =>
        Task.FromResult(new SmartPosPaymentCapabilities(
            true,
            true,
            _homologated,
            "generic_intent",
            "homologation",
            ["credit_card"],
            true,
            true,
            true,
            null,
            null,
            null,
            null,
            _canReverse));

    public Task<SmartPosPaymentResult> StartAsync(SmartPosPaymentRequest request)
    {
        StartCalls++;
        if (_unsafeApproved)
        {
            return Task.FromResult(new SmartPosPaymentResult(
                true,
                true,
                "approved",
                _returnedAttemptId ?? request.AttemptId,
                "4111-1111-1111-1111",
                null,
                false));
        }
        return Task.FromResult(new SmartPosPaymentResult(
            false,
            true,
            "unknown",
            _returnedAttemptId ?? request.AttemptId,
            null,
            "SMARTPOS_RESULT_UNVERIFIED",
            true));
    }

    public Task<SmartPosPaymentResult> RecoverAsync(string attemptId)
    {
        RecoverCalls++;
        return Task.FromResult(new SmartPosPaymentResult(
            false,
            true,
            "unknown",
            attemptId,
            null,
            "SMARTPOS_RESULT_UNVERIFIED",
            true));
    }

    public Task<SmartPosPaymentResult> CancelAsync(string attemptId)
    {
        CancelCalls++;
        return Task.FromResult(new SmartPosPaymentResult(
            false,
            true,
            "canceled",
            attemptId,
            null,
            "PAYMENT_CANCELED",
            false));
    }

    public Task<SmartPosPaymentResult> ReverseAsync(SmartPosReversalRequest request)
    {
        ReverseCalls++;
        return Task.FromResult(new SmartPosPaymentResult(
            false,
            true,
            "unknown",
            request.PaymentAttemptId,
            null,
            "SMARTPOS_RESULT_UNVERIFIED",
            true));
    }

    public Task<SmartPosPaymentResult> RecoverReversalAsync(SmartPosReversalRequest request)
    {
        RecoverReversalCalls++;
        return Task.FromResult(new SmartPosPaymentResult(
            false,
            true,
            "unknown",
            request.PaymentAttemptId,
            null,
            "SMARTPOS_RESULT_UNVERIFIED",
            true));
    }
}

internal sealed class RecordingResultSink : ISmartPosResultSink
{
    public List<SmartPosResultEnvelope> Results { get; } = [];

    public Task<SmartPosResultSubmission> SubmitAsync(
        SmartPosResultEnvelope result,
        CancellationToken cancellationToken = default)
    {
        Results.Add(result);
        return Task.FromResult(new SmartPosResultSubmission(true, false, null));
    }
}

internal sealed class PermanentThenAcceptingResultSink : ISmartPosResultSink
{
    public int Calls { get; private set; }

    public Task<SmartPosResultSubmission> SubmitAsync(
        SmartPosResultEnvelope result,
        CancellationToken cancellationToken = default)
    {
        Calls++;
        return Task.FromResult(Calls == 1
            ? new SmartPosResultSubmission(false, false, "PAYMENT_ATTEMPT_ALREADY_RESOLVED")
            : new SmartPosResultSubmission(true, false, null));
    }
}

internal sealed class RecoveringResolver : ISmartPosPaymentAttemptResolver
{
    private readonly string _attemptId;
    private readonly SmartPosLaunchAction _action;
    private readonly bool _canReverse;

    public RecoveringResolver(
        string attemptId,
        SmartPosLaunchAction action = SmartPosLaunchAction.Recover,
        bool canReverse = false)
    {
        _attemptId = attemptId;
        _action = action;
        _canReverse = canReverse;
    }

    public bool Available => true;

    public Task<SmartPosBackendCapabilities> GetAuthorizationAsync() =>
        Task.FromResult(new SmartPosBackendCapabilities(
            Guid.NewGuid().ToString(),
            true,
            "homologated",
            "generic_intent",
            ["credit_card"],
            12,
            new(true, true, _canReverse),
            null,
            "certification-1",
            true,
            new(false, null)));

    public Task<SmartPosPaymentAttemptResolution> ResolveAsync(string attemptId) =>
        Task.FromResult(new SmartPosPaymentAttemptResolution(
            attemptId == _attemptId,
            new SmartPosPaymentRequest(attemptId, 12345, "credit_card", 2),
            "generic_intent",
            _action,
            true,
            null));
}

internal sealed class StaticReversalResolver : ISmartPosReversalResolver
{
    private readonly string _reversalId;
    private readonly string _attemptId;
    private readonly SmartPosReversalLaunchAction _action;

    public StaticReversalResolver(
        string reversalId,
        string attemptId,
        SmartPosReversalLaunchAction action)
    {
        _reversalId = reversalId;
        _attemptId = attemptId;
        _action = action;
    }

    public Task<SmartPosReversalResolution> ResolveAsync(string reversalId) =>
        Task.FromResult(new SmartPosReversalResolution(
            string.Equals(reversalId, _reversalId, StringComparison.Ordinal),
            new SmartPosReversalRequest(_reversalId, _attemptId, "generic_intent"),
            _action,
            null));
}

internal sealed class UnavailableProvider : ISmartPosPaymentProvider
{
    public Task<SmartPosPaymentCapabilities> GetCapabilitiesAsync() =>
        Task.FromResult(new SmartPosPaymentCapabilities(
            false,
            false,
            false,
            "disabled",
            "disabled",
            [],
            false,
            false,
            false,
            null,
            "SMARTPOS_NOT_CONFIGURED"));

    public Task<SmartPosPaymentResult> StartAsync(SmartPosPaymentRequest request) =>
        throw new InvalidOperationException("A disabled provider must never receive a payment request.");

    public Task<SmartPosPaymentResult> RecoverAsync(string attemptId) =>
        Task.FromResult(SmartPosPaymentService.Failed(attemptId, "SMARTPOS_NOT_CONFIGURED"));

    public Task<SmartPosPaymentResult> CancelAsync(string attemptId) =>
        Task.FromResult(SmartPosPaymentService.Failed(attemptId, "SMARTPOS_NOT_CONFIGURED"));

    public Task<SmartPosPaymentResult> ReverseAsync(SmartPosReversalRequest request) =>
        Task.FromResult(SmartPosPaymentService.Failed(
            request.PaymentAttemptId,
            "SMARTPOS_REVERSAL_PROVIDER_UNAVAILABLE"));

    public Task<SmartPosPaymentResult> RecoverReversalAsync(SmartPosReversalRequest request) =>
        Task.FromResult(SmartPosPaymentService.Failed(
            request.PaymentAttemptId,
            "SMARTPOS_REVERSAL_RECOVERY_PROVIDER_UNAVAILABLE"));
}
