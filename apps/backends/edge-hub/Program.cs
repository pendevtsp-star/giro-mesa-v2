using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using GiroMesa.EdgeHub;
using GiroMesa.EdgeHub.Adapters;
using GiroMesa.EdgeHub.Security;
using GiroMesa.EdgeHub.Storage;
using GiroMesa.EdgeHub.Sync;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(options => options.ServiceName = "GiroMesa Edge Hub");
builder.Services.Configure<HubOptions>(builder.Configuration.GetSection(HubOptions.Section));
builder.Services.AddSingleton<HubStore>();
builder.Services.AddSingleton<DeviceAuthenticator>();
builder.Services.AddSingleton<IPaymentGateway, DisabledPaymentGateway>();
builder.Services.AddHttpClient<FocusFiscalGateway>();
builder.Services.AddSingleton<DisabledFiscalGateway>();
builder.Services.AddSingleton<IFiscalGateway>(services =>
{
    var options = services.GetRequiredService<Microsoft.Extensions.Options.IOptions<HubOptions>>();
    return options.Value.Focus.Enabled
        ? services.GetRequiredService<FocusFiscalGateway>()
        : services.GetRequiredService<DisabledFiscalGateway>();
});
builder.Services.AddSingleton<DisabledPrinterGateway>();
builder.Services.AddSingleton<EscPosPrinterGateway>();
builder.Services.AddSingleton<IPrinterGateway>(services =>
{
    var options = services.GetRequiredService<Microsoft.Extensions.Options.IOptions<HubOptions>>();
    return PrinterConfiguration.IsValid(options.Value.Printer)
        ? services.GetRequiredService<EscPosPrinterGateway>()
        : services.GetRequiredService<DisabledPrinterGateway>();
});
builder.Services.AddHttpClient<CloudSyncWorker>();
builder.Services.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<CloudSyncWorker>());

var app = builder.Build();
var store = app.Services.GetRequiredService<HubStore>();
await store.InitializeAsync();
const string AuthenticatedDeviceIdKey = "giromesa.authenticated-device-id";

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/health") ||
        context.Request.Path.StartsWithSegments("/v1/pair"))
    {
        await next();
        return;
    }

    var authenticator = context.RequestServices.GetRequiredService<DeviceAuthenticator>();
    var device = await authenticator.AuthenticateAsync(context.Request.Headers["X-GiroMesa-Device-Token"]);
    if (device is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { code = "DEVICE_AUTH_REQUIRED" });
        return;
    }

    context.Items[AuthenticatedDeviceIdKey] = device.DeviceId;
    await next();
});

app.MapGet("/health/live", () => Results.Ok(new
{
    status = "ok",
    service = "giromesa-edge-hub",
    now = DateTimeOffset.UtcNow,
}));

app.MapGet("/health", Health);
app.MapGet("/health/ready", Health);

app.MapPost("/v1/pair", async (PairDeviceRequest request, DeviceAuthenticator auth) =>
{
    var result = await auth.PairAsync(request);
    return result.IsSuccess
        ? Results.Ok(new { deviceToken = result.Token, pairedAt = DateTimeOffset.UtcNow })
        : Results.Json(new { code = result.Error }, statusCode: result.StatusCode);
});

app.MapGet("/v1/capabilities", (IPaymentGateway payment, IFiscalGateway fiscal, IPrinterGateway printer) =>
    Results.Ok(new
    {
        payment = payment.Capability,
        fiscal = fiscal.Capability,
        printing = printer.Capability,
    }));

app.MapPost("/v1/commands", async (OperationalCommand command, HubStore hubStore, HttpContext context) =>
{
    if (command.Type.StartsWith("fiscal.", StringComparison.Ordinal))
    {
        return Results.Json(
            new { code = "FISCAL_COMMAND_RESERVED" },
            statusCode: StatusCodes.Status403Forbidden);
    }
    var errors = command.Validate();
    if (errors.Count > 0)
    {
        return Results.ValidationProblem(errors);
    }
    if (context.Items[AuthenticatedDeviceIdKey] is not string deviceId ||
        !DeviceAuthenticator.MatchesDeviceScope(deviceId, command.DeviceId))
    {
        return Results.Json(
            new { code = "DEVICE_SCOPE_MISMATCH" },
            statusCode: StatusCodes.Status403Forbidden);
    }

    try
    {
        var result = await hubStore.AcceptCommandAsync(command);
        return Results.Ok(new
        {
            commandId = result.Id,
            acceptedAt = result.AcceptedAt,
            duplicate = !result.Inserted,
            syncState = result.SyncedAt is null ? "pending" : "synced",
            result = result.Result,
        });
    }
    catch (OperationalConflictException exception)
    {
        return Results.Conflict(new { code = exception.Code });
    }
});

app.MapGet("/v1/operational-state/catalog", async (HubStore hubStore) =>
    SnapshotSection(await hubStore.GetOperationalSnapshotAsync(), snapshot => snapshot.Catalog));

app.MapGet("/v1/operational-state/floor", async (HubStore hubStore) =>
    SnapshotSection(await hubStore.GetOperationalSnapshotAsync(), snapshot => snapshot.Floor));

app.MapGet("/v1/operational-state/tabs", async (HubStore hubStore) =>
    SnapshotSection(await hubStore.GetOperationalSnapshotAsync(), snapshot => snapshot.Tabs));

app.MapGet("/v1/operational-state/tabs/{tabId}", async (string tabId, HubStore hubStore) =>
{
    var snapshot = await hubStore.GetOperationalSnapshotAsync();
    if (snapshot is null) return Results.NotFound(new { code = "OFFLINE_SNAPSHOT_UNAVAILABLE" });
    return snapshot.TabDetails.TryGetProperty(tabId, out var detail)
        ? Results.Ok(detail)
        : Results.NotFound(new { code = "TAB_NOT_FOUND" });
});

app.MapGet("/v1/operational-state/kds", async (
    HubStore hubStore,
    CloudSyncWorker sync,
    IPrinterGateway printer,
    string? stationId) =>
{
    if (stationId is not null && !Guid.TryParse(stationId, out _))
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(stationId)] = ["stationId must be a UUID."],
        });
    var envelope = await hubStore.GetKdsOperationalEnvelopeAsync(stationId);
    return envelope is null
        ? Results.Json(
            new { code = "OFFLINE_SNAPSHOT_UNAVAILABLE", retryable = true },
            statusCode: StatusCodes.Status503ServiceUnavailable)
        : KdsEnvelope(envelope, sync, stationId, printer.Capability.Configured);
});

app.MapGet("/v1/operational-state/reconciliation", async (HubStore hubStore, int? limit) =>
    Results.Ok(new
    {
        rejectedEvents = await hubStore.GetReconciliationAsync(Math.Clamp(limit ?? 100, 1, 500)),
    }));

app.MapGet("/v1/events/pending", async (HubStore hubStore, int? limit) =>
    Results.Ok(await hubStore.GetPendingAsync(Math.Clamp(limit ?? 100, 1, 500))));

app.MapPost("/v1/payments", async (PaymentRequest request, IPaymentGateway gateway) =>
{
    var result = await gateway.ExecuteAsync(request);
    return result.Success
        ? Results.Ok(result)
        : Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.MapPost("/v1/fiscal/documents", async (
    FiscalRequest request,
    IFiscalGateway gateway,
    HubStore hubStore,
    HttpContext context) =>
{
    var (snapshot, authorization) = await RequireFiscalActorAsync(
        hubStore,
        request.ActorIdentityId,
        ["owner", "manager", "cashier"]);
    if (authorization is not null) return authorization;
    if (context.Items[AuthenticatedDeviceIdKey] is not string deviceId)
        return Results.Unauthorized();
    var result = await gateway.IssueAsync(request);
    var fiscalEvent = FiscalEventFactory.FromIssue(
        snapshot!, deviceId, request, result, DateTimeOffset.UtcNow);
    if (fiscalEvent is not null) await hubStore.AcceptCommandAsync(fiscalEvent);
    return FiscalMutationResult(result);
});

app.MapGet("/v1/fiscal/documents/{documentReference}", async (
    string documentReference,
    string actorIdentityId,
    IFiscalGateway gateway,
    HubStore hubStore,
    HttpContext context) =>
{
    var (snapshot, authorization) = await RequireFiscalActorAsync(
        hubStore,
        actorIdentityId,
        ["owner", "manager", "cashier", "accountant"],
        documentReference);
    if (authorization is not null) return authorization;
    if (context.Items[AuthenticatedDeviceIdKey] is not string deviceId)
        return Results.Unauthorized();
    var request = new FiscalConsultRequest(actorIdentityId, documentReference);
    var result = await gateway.ConsultAsync(request);
    var fiscalEvent = FiscalEventFactory.FromConsult(
        snapshot!, deviceId, request, result, DateTimeOffset.UtcNow);
    if (fiscalEvent is not null) await hubStore.AcceptCommandAsync(fiscalEvent);
    return FiscalConsultResult(result);
});

app.MapDelete("/v1/fiscal/documents/{documentReference}", async (
    string documentReference,
    FiscalCancellationRequest request,
    IFiscalGateway gateway,
    HubStore hubStore,
    HttpContext context) =>
{
    var (snapshot, authorization) = await RequireFiscalActorAsync(
        hubStore,
        request.ActorIdentityId,
        ["owner", "manager"],
        documentReference);
    if (authorization is not null) return authorization;
    if (context.Items[AuthenticatedDeviceIdKey] is not string deviceId)
        return Results.Unauthorized();
    var result = await gateway.CancelAsync(documentReference, request);
    var fiscalEvent = FiscalEventFactory.FromCancellation(
        snapshot!, deviceId, documentReference, request, result, DateTimeOffset.UtcNow);
    if (fiscalEvent is not null) await hubStore.AcceptCommandAsync(fiscalEvent);
    return FiscalMutationResult(result);
});

app.MapPost("/v1/fiscal/number-invalidations", async (
    FiscalNumberInvalidationRequest request,
    IFiscalGateway gateway,
    HubStore hubStore,
    HttpContext context) =>
{
    var (snapshot, authorization) = await RequireFiscalActorAsync(
        hubStore,
        request.ActorIdentityId,
        ["owner", "manager"],
        request.IdempotencyKey);
    if (authorization is not null) return authorization;
    if (context.Items[AuthenticatedDeviceIdKey] is not string deviceId)
        return Results.Unauthorized();
    var result = await gateway.InvalidateNumbersAsync(request);
    var fiscalEvent = FiscalEventFactory.FromInvalidation(
        snapshot!, deviceId, request, result, DateTimeOffset.UtcNow);
    if (fiscalEvent is not null) await hubStore.AcceptCommandAsync(fiscalEvent);
    return FiscalMutationResult(result);
});

app.MapPost("/v1/print-jobs", async (
    PrintRequest request,
    IPrinterGateway gateway,
    HubStore hubStore,
    ILogger<Program> logger) =>
{
    if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || request.IdempotencyKey.Length > 180 ||
        request.PrinterId?.Length > 80 ||
        string.IsNullOrWhiteSpace(request.Station) || request.Station.Length > 120 ||
        request.DocumentType is not ("partial_statement" or "payment_statement" or "final_receipt" or "kds_ticket") ||
        request.Payload.ValueKind != JsonValueKind.Object ||
        request.Payload.GetRawText().Length > 128_000 ||
        request.Copies is < 1 or > 5)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request)] = ["Invalid print job."],
        });
    }
    var fingerprint = Convert.ToHexString(
        SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));
    StoredPrintJob job;
    bool inserted;
    try
    {
        (job, inserted) = await hubStore.CreateOrGetPrintJobAsync(request, fingerprint);
    }
    catch (InvalidOperationException exception) when (exception.Message == "PRINT_IDEMPOTENCY_CONFLICT")
    {
        return Results.Conflict(new { code = exception.Message });
    }
    if (!inserted)
    {
        if (job.Status == "printing")
            return Results.Conflict(new { code = "PRINT_ATTEMPT_IN_PROGRESS_OR_UNKNOWN" });
        return PrintMutationResult(new PrintResult(
            job.Status == "accepted",
            job.Status,
            job.ErrorCode,
            job.BytesWritten,
            job.PrinterId,
            true));
    }
    PrintResult result;
    try
    {
        result = await gateway.PrintAsync(request);
    }
    catch (Exception exception)
    {
        logger.LogError(exception, "Unexpected printer failure for {PrinterId}", request.PrinterId);
        result = new(false, "failed", "PRINTER_GATEWAY_ERROR");
    }
    await hubStore.CompletePrintJobAsync(job.Id, result);
    return PrintMutationResult(result);
});

app.MapGet("/v1/print-jobs/{jobId}", async (string jobId, HubStore hubStore) =>
    Guid.TryParse(jobId, out _)
        ? await hubStore.GetPrintJobAsync(jobId) is { } job
            ? Results.Ok(job)
            : Results.NotFound(new { code = "PRINT_JOB_NOT_FOUND" })
        : Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(jobId)] = ["jobId must be a UUID."],
        }));

app.Run();

static IResult SnapshotSection(
    OperationalSnapshot? snapshot,
    Func<OperationalSnapshot, JsonElement> select) =>
    snapshot is null
        ? Results.NotFound(new { code = "OFFLINE_SNAPSHOT_UNAVAILABLE" })
        : Results.Ok(select(snapshot));

static async Task<(OperationalSnapshot? Snapshot, IResult? Error)> RequireFiscalActorAsync(
    HubStore hubStore,
    string actorIdentityId,
    IReadOnlyCollection<string> roles,
    string? reference = null)
{
    var snapshot = await hubStore.GetOperationalSnapshotAsync();
    if (snapshot is null)
        return (null, Results.Json(
            new FiscalResult(false, "unavailable", reference, "OFFLINE_SNAPSHOT_UNAVAILABLE"),
            statusCode: StatusCodes.Status503ServiceUnavailable));
    try
    {
        snapshot.RequireActorRole(actorIdentityId, roles, DateTimeOffset.UtcNow);
        return (snapshot, null);
    }
    catch (OperationalConflictException exception)
    {
        return (null, Results.Json(
            new FiscalResult(false, "forbidden", reference, exception.Code),
            statusCode: StatusCodes.Status403Forbidden));
    }
}

static IResult FiscalMutationResult(FiscalResult result) => result.Status switch
{
    _ when result.Success => Results.Ok(result),
    "processing" => Results.Accepted(value: result),
    "not_found" => Results.NotFound(result),
    "rejected" => Results.Json(result, statusCode: StatusCodes.Status422UnprocessableEntity),
    _ => Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable),
};

static IResult FiscalConsultResult(FiscalResult result) => result.Status switch
{
    "authorized" or "canceled" or "rejected" => Results.Ok(result),
    "processing" => Results.Accepted(value: result),
    "not_found" => Results.NotFound(result),
    _ => Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable),
};

static IResult PrintMutationResult(PrintResult result) => result.Status switch
{
    _ when result.Success => Results.Accepted(value: result),
    "rejected" => Results.Json(result, statusCode: StatusCodes.Status422UnprocessableEntity),
    _ => Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable),
};

static async Task<IResult> Health(HubStore hubStore, CloudSyncWorker sync)
{
    var databaseReady = await hubStore.CheckAsync();
    var kds = databaseReady ? await hubStore.GetKdsOperationalEnvelopeAsync() : null;
    var now = DateTimeOffset.UtcNow;
    var leaseValid = kds?.LeaseExpiresAt is null || kds.LeaseExpiresAt > now;
    var ready = databaseReady && kds is not null && leaseValid;
    var status = ready
        ? sync.Status == "offline" ? "degraded" : "ok"
        : "not-ready";
    return Results.Json(new
    {
        status,
        ready,
        service = "giromesa-edge-hub",
        database = databaseReady ? "ready" : "unavailable",
        cloud = sync.Status,
        sync.LastSuccessfulSyncAt,
        sync.LastErrorCode,
        sync.NextRetryAt,
        snapshotCapturedAt = kds?.CapturedAt,
        localProjectedAt = kds?.LocalProjectedAt,
        pending = kds?.Pending ?? 0,
        oldestPendingAt = kds?.OldestPendingAt,
        rejected = kds?.Rejected ?? 0,
        projectionBlocked = kds?.ProjectionBlocked,
        leaseExpiresAt = kds?.LeaseExpiresAt,
        now,
    }, statusCode: ready ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
}

static IResult KdsEnvelope(
    KdsOperationalEnvelope envelope,
    CloudSyncWorker sync,
    string? stationId,
    bool hardwarePrinting)
{
    var payload = JsonNode.Parse(envelope.Data.GetRawText()) as JsonObject ?? new JsonObject();
    if (payload["serviceMode"] is null && payload["operationServiceMode"] is { } operationServiceMode)
    {
        payload["serviceMode"] = operationServiceMode.DeepClone();
    }
    var now = DateTimeOffset.UtcNow;
    var offlineProjectionAvailable = envelope.ProjectionBlocked is null &&
        envelope.LeaseExpiresAt is { } leaseExpiresAt &&
        leaseExpiresAt > now;
    var hasCapacity = payload["stations"] is JsonArray capacityStations &&
        capacityStations.OfType<JsonObject>().Any(station => station["capacity"] is JsonObject);
    var hasRecommendation = payload["stations"] is JsonArray recommendationStations &&
        recommendationStations.OfType<JsonObject>().Any(station =>
            station["capacity"] is JsonObject capacity && capacity["recommendation"] is JsonObject);
    var capabilities = payload["capabilities"] as JsonObject ?? new JsonObject();
    capabilities["authorizedCancellation"] = false;
    capabilities["ticketCancel"] = false;
    capabilities["cancel"] = false;
    capabilities["block"] = true;
    capabilities["attentionAcknowledgement"] = true;
    capabilities["priority"] = true;
    capabilities["orderPriority"] = true;
    capabilities["availability"] = true;
    capabilities["offlineBlock"] = offlineProjectionAvailable;
    capabilities["offlineAttentionAcknowledgement"] = offlineProjectionAvailable;
    // A KDS-only actor requires a cloud terminal profile in pass mode. That profile is deliberately
    // outside device enrollment and is not cached by the Edge, so this stays cloud-only.
    capabilities["offlineOrderPriority"] = false;
    capabilities["offlineAvailability"] = offlineProjectionAvailable;
    // The cloud replay contract currently accepts only the basic available/reason shape.
    // Stock limits and scheduled reactivation must not enter a queue that cannot be replayed.
    capabilities["offlineAvailabilityLifecycle"] = false;
    capabilities["offline"] = new JsonObject
    {
        ["block"] = offlineProjectionAvailable,
        ["itemBlock"] = offlineProjectionAvailable,
        ["attentionAcknowledgement"] = offlineProjectionAvailable,
        ["criticalNoteAcknowledgement"] = offlineProjectionAvailable,
        ["orderPriority"] = false,
        ["availability"] = offlineProjectionAvailable,
        ["availabilityLifecycle"] = false,
    };
    var offlineActions = new JsonArray();
    if (offlineProjectionAvailable)
    {
        foreach (var action in new[]
        {
            "transition-kds",
            "transition-kds-item",
            "refire-kds-item",
            "recall-kds",
            "set-kds-course-state",
            "handoff-kds-order",
            "set-kds-product-availability",
            "block-kds-item",
            "unblock-kds-item",
            "acknowledge-kds-critical-note",
        })
        {
            offlineActions.Add(action);
        }
    }
    capabilities["offlineActions"] = offlineActions;
    capabilities["reroute"] = false;
    capabilities["batches"] = false;
    capabilities["history"] = false;
    capabilities["capacity"] = hasCapacity;
    capabilities["stationCapacity"] = hasCapacity;
    capabilities["recommendation"] = hasRecommendation;
    capabilities["capacityRecommendation"] = hasRecommendation;
    capabilities["automaticThrottling"] = false;
    capabilities["terminalProfileRead"] = false;
    capabilities["terminalProfileManage"] = false;
    capabilities["printing"] = hardwarePrinting;
    capabilities["printer"] = hardwarePrinting;
    capabilities["hardwarePrinting"] = hardwarePrinting;
    capabilities["bumpBar"] = true;
    payload["capabilities"] = capabilities;
    if (payload["productAvailability"] is JsonArray) payload["productAvailabilityScope"] = "unit";
    var lastSyncedAt = envelope.LastSuccessfulSyncAt ?? sync.LastSuccessfulSyncAt;
    var freshnessStatus = KdsFreshnessPolicy.Resolve(
        envelope.ProjectionBlocked is not null,
        sync.Status,
        lastSyncedAt,
        envelope.LeaseExpiresAt,
        now);
    payload["stationId"] = stationId;
    payload["capturedAt"] = envelope.CapturedAt.ToString("O");
    payload["localProjectedAt"] = envelope.LocalProjectedAt.ToString("O");
    payload["revision"] = envelope.Revision;
    payload["freshness"] = new JsonObject
    {
        ["status"] = freshnessStatus,
        ["lastSyncedAt"] = lastSyncedAt?.ToString("O"),
        ["pendingCount"] = envelope.Pending,
        ["projectionBlocked"] = envelope.ProjectionBlocked is not null,
        ["projectionBlockedByEventId"] = envelope.ProjectionBlocked?.EventId,
        ["leaseExpiresAt"] = envelope.LeaseExpiresAt?.ToString("O"),
        ["message"] = freshnessStatus switch
        {
            "offline" => "Operando com o snapshot local; a fila será sincronizada após a reconexão.",
            "stale" => "O estado local está sem confirmação recente da nuvem.",
            "degraded" => "A projeção local exige reconciliação operacional.",
            _ => null,
        },
    };
    payload["sync"] = new JsonObject
    {
        ["oldestPendingAt"] = envelope.OldestPendingAt?.ToString("O"),
        ["rejectedCount"] = envelope.Rejected,
        ["projectionBlocked"] = JsonSerializer.SerializeToNode(envelope.ProjectionBlocked),
        ["leaseExpiresAt"] = envelope.LeaseExpiresAt?.ToString("O"),
        ["lastErrorCode"] = sync.LastErrorCode,
        ["nextRetryAt"] = sync.NextRetryAt?.ToString("O"),
    };
    return Results.Json(payload);
}

public partial class Program;
