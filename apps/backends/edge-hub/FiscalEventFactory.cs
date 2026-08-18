using System.Text.Json;
using GiroMesa.EdgeHub.Adapters;

namespace GiroMesa.EdgeHub;

public static class FiscalEventFactory
{
    public static OperationalCommand? FromIssue(
        OperationalSnapshot snapshot,
        string deviceId,
        FiscalRequest request,
        FiscalResult result,
        DateTimeOffset occurredAt) =>
        result.ErrorCode != "FOCUS_REQUEST_INVALID" &&
        result.Status is ("authorized" or "rejected" or "processing")
            ? Create(
                snapshot,
                deviceId,
                request.ActorIdentityId,
                "issue",
                "fiscal.document.issue_result",
                request.IdempotencyKey,
                result,
                occurredAt,
                request.OrderId,
                request.TotalInCents)
            : null;

    public static OperationalCommand? FromConsult(
        OperationalSnapshot snapshot,
        string deviceId,
        FiscalConsultRequest request,
        FiscalResult result,
        DateTimeOffset occurredAt) =>
        result.ErrorCode != "FOCUS_REQUEST_INVALID" &&
        result.Status is ("authorized" or "canceled" or "rejected")
            ? Create(
                snapshot,
                deviceId,
                request.ActorIdentityId,
                "consult",
                "fiscal.document.reconciled",
                request.DocumentReference,
                result,
                occurredAt)
            : null;

    public static OperationalCommand? FromCancellation(
        OperationalSnapshot snapshot,
        string deviceId,
        string documentReference,
        FiscalCancellationRequest request,
        FiscalResult result,
        DateTimeOffset occurredAt) =>
        result.ErrorCode != "FOCUS_REQUEST_INVALID" &&
        result.Status is ("canceled" or "rejected" or "processing")
            ? Create(
                snapshot,
                deviceId,
                request.ActorIdentityId,
                "cancel",
                "fiscal.document.cancel_result",
                documentReference,
                result with { DocumentReference = documentReference },
                occurredAt)
            : null;

    public static OperationalCommand? FromInvalidation(
        OperationalSnapshot snapshot,
        string deviceId,
        FiscalNumberInvalidationRequest request,
        FiscalResult result,
        DateTimeOffset occurredAt)
    {
        if (result.ErrorCode == "FOCUS_REQUEST_INVALID" ||
            result.Status is not ("invalidated" or "rejected" or "processing"))
            return null;
        return Create(
            snapshot,
            deviceId,
            request.ActorIdentityId,
            "invalidate",
            "fiscal.number_invalidation_result",
            request.IdempotencyKey,
            result,
            occurredAt,
            extra: new Dictionary<string, object?>
            {
                ["cnpj"] = request.Cnpj.Trim().ToUpperInvariant(),
                ["series"] = request.Series.Trim(),
                ["initialNumber"] = request.InitialNumber,
                ["finalNumber"] = request.FinalNumber,
            });
    }

    private static OperationalCommand Create(
        OperationalSnapshot snapshot,
        string deviceId,
        string actorId,
        string operation,
        string eventType,
        string sourceIdempotencyKey,
        FiscalResult result,
        DateTimeOffset occurredAt,
        string? orderId = null,
        long? totalCents = null,
        IReadOnlyDictionary<string, object?>? extra = null)
    {
        snapshot.Validate();
        var payload = new Dictionary<string, object?>
        {
            ["kind"] = eventType,
            ["idempotencyKey"] = sourceIdempotencyKey,
            ["status"] = result.Status,
        };
        if (orderId is not null) payload["orderId"] = orderId;
        if (result.DocumentReference is not null)
            payload["providerReference"] = result.DocumentReference;
        if (totalCents is not null) payload["totalCents"] = totalCents;
        if (result.ErrorCode is not null) payload["errorCode"] = result.ErrorCode;
        if (extra is not null)
        {
            foreach (var item in extra) payload[item.Key] = item.Value;
        }
        var serializedPayload = JsonSerializer.SerializeToElement(payload);
        var eventId = OperationalProjection.StableId(
            serializedPayload.GetRawText(),
            eventType,
            $"{operation}|{snapshot.OrganizationId}|{snapshot.UnitId}|{actorId}|{deviceId}");
        var eventIdempotencyKey = $"fiscal:{eventId}";

        return new(
            eventId,
            snapshot.OrganizationId,
            snapshot.UnitId,
            actorId,
            deviceId,
            eventType,
            serializedPayload,
            1,
            occurredAt,
            eventIdempotencyKey);
    }
}
