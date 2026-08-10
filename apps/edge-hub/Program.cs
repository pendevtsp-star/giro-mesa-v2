using System.Text.Json;
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
builder.Services.AddSingleton<IPrinterGateway, DisabledPrinterGateway>();
builder.Services.AddHttpClient<CloudSyncWorker>();
builder.Services.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<CloudSyncWorker>());

var app = builder.Build();
var store = app.Services.GetRequiredService<HubStore>();
await store.InitializeAsync();

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/health") ||
        context.Request.Path.StartsWithSegments("/v1/pair"))
    {
        await next();
        return;
    }

    var authenticator = context.RequestServices.GetRequiredService<DeviceAuthenticator>();
    if (!await authenticator.IsAuthorizedAsync(context.Request.Headers["X-GiroMesa-Device-Token"]))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { code = "DEVICE_AUTH_REQUIRED" });
        return;
    }

    await next();
});

app.MapGet("/health", async (HubStore hubStore, CloudSyncWorker sync) => Results.Ok(new
{
    status = "ok",
    service = "giromesa-edge-hub",
    database = await hubStore.CheckAsync() ? "ready" : "unavailable",
    cloud = sync.Status,
    now = DateTimeOffset.UtcNow,
}));

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

app.MapPost("/v1/commands", async (OperationalCommand command, HubStore hubStore) =>
{
    var errors = command.Validate();
    if (errors.Count > 0)
    {
        return Results.ValidationProblem(errors);
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

app.MapGet("/v1/operational-state/kds", async (HubStore hubStore) =>
    SnapshotSection(await hubStore.GetOperationalSnapshotAsync(), snapshot => snapshot.Kds));

app.MapGet("/v1/operational-state/reconciliation", async (HubStore hubStore, int? limit) =>
    Results.Ok(new
    {
        rejectedEvents = await hubStore.GetReconciliationAsync(Math.Clamp(limit ?? 100, 1, 500)),
    }));

app.MapGet("/v1/events/pending", async (HubStore hubStore, int? limit) =>
    Results.Ok(await hubStore.GetPendingAsync(Math.Clamp(limit ?? 100, 1, 500))));

app.MapPost("/v1/events/{eventId}/ack", async (string eventId, HubStore hubStore) =>
    await hubStore.AcknowledgeAsync(eventId) ? Results.NoContent() : Results.NotFound());

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
    HubStore hubStore) =>
{
    var snapshot = await hubStore.GetOperationalSnapshotAsync();
    if (snapshot is null)
        return Results.Json(
            new FiscalResult(false, "unavailable", null, "OFFLINE_SNAPSHOT_UNAVAILABLE"),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    try
    {
        snapshot.RequireActorRole(
            request.ActorIdentityId,
            ["owner", "manager", "cashier"],
            DateTimeOffset.UtcNow);
    }
    catch (OperationalConflictException exception)
    {
        return Results.Json(
            new FiscalResult(false, "forbidden", null, exception.Code),
            statusCode: StatusCodes.Status403Forbidden);
    }
    var result = await gateway.IssueAsync(request);
    return result.Success
        ? Results.Ok(result)
        : Results.Json(
            result,
            statusCode: result.Status == "rejected"
                ? StatusCodes.Status422UnprocessableEntity
                : StatusCodes.Status503ServiceUnavailable);
});

app.MapPost("/v1/print-jobs", async (PrintRequest request, IPrinterGateway gateway) =>
{
    var result = await gateway.PrintAsync(request);
    return result.Success
        ? Results.Accepted(value: result)
        : Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.Run();

static IResult SnapshotSection(
    OperationalSnapshot? snapshot,
    Func<OperationalSnapshot, JsonElement> select) =>
    snapshot is null
        ? Results.NotFound(new { code = "OFFLINE_SNAPSHOT_UNAVAILABLE" })
        : Results.Ok(select(snapshot));

public partial class Program;
