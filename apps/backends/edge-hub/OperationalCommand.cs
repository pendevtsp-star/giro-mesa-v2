using System.Text.Json;
using System.Text;

namespace GiroMesa.EdgeHub;

public sealed record OperationalCommand(
    string Id,
    string OrganizationId,
    string UnitId,
    string ActorId,
    string DeviceId,
    string Type,
    JsonElement Payload,
    int Version,
    DateTimeOffset OccurredAt,
    string? IdempotencyKey = null)
{
    public string EffectiveIdempotencyKey => IdempotencyKey?.Trim() ?? Id;

    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();
        Required(errors, nameof(Id), Id);
        Required(errors, nameof(OrganizationId), OrganizationId);
        Required(errors, nameof(UnitId), UnitId);
        Required(errors, nameof(ActorId), ActorId);
        Required(errors, nameof(DeviceId), DeviceId);
        Required(errors, nameof(Type), Type);

        ValidId(errors, nameof(Id), Id);
        ValidId(errors, nameof(OrganizationId), OrganizationId);
        ValidId(errors, nameof(UnitId), UnitId);
        ValidId(errors, nameof(ActorId), ActorId);
        ValidId(errors, nameof(DeviceId), DeviceId);

        if (Version < 1)
        {
            errors[nameof(Version)] = ["Version must be greater than zero."];
        }

        if (OccurredAt > DateTimeOffset.UtcNow.AddMinutes(5))
        {
            errors[nameof(OccurredAt)] = ["OccurredAt cannot be in the future."];
        }

        if (OccurredAt < DateTimeOffset.UtcNow.AddDays(-30))
        {
            errors[nameof(OccurredAt)] = ["OccurredAt is older than the supported offline window."];
        }

        if (Payload.ValueKind != JsonValueKind.Object)
        {
            errors[nameof(Payload)] = ["Payload must be an object."];
        }
        else if (Encoding.UTF8.GetByteCount(Payload.GetRawText()) > 65_536)
        {
            errors[nameof(Payload)] = ["Payload exceeds 64 KiB."];
        }

        if (IdempotencyKey is not null && (IdempotencyKey.Trim().Length < 8 || IdempotencyKey.Length > 160))
        {
            errors[nameof(IdempotencyKey)] = ["IdempotencyKey must contain between 8 and 160 characters."];
        }

        return errors;
    }

    private static void Required(Dictionary<string, string[]> errors, string field, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            errors[field] = ["Required."];
        }
    }

    private static void ValidId(Dictionary<string, string[]> errors, string field, string value)
    {
        if (!string.IsNullOrWhiteSpace(value) && !Guid.TryParse(value, out _))
        {
            errors[field] = ["Must be a UUID."];
        }
    }
}

public sealed record AcceptedCommand(
    string Id,
    DateTimeOffset AcceptedAt,
    DateTimeOffset? SyncedAt,
    bool Inserted,
    JsonElement? Result);

public sealed record PendingEvent(
    string Id,
    string OrganizationId,
    string UnitId,
    string ActorId,
    string DeviceId,
    string IdempotencyKey,
    string Type,
    string Payload,
    int Version,
    DateTimeOffset OccurredAt,
    DateTimeOffset AcceptedAt);

public sealed record CloudCommand(
    string Id,
    string Type,
    JsonElement Payload,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt);

public sealed record CloudCommandState(
    string Id,
    string Type,
    DateTimeOffset? ProcessedAt,
    JsonElement? Result,
    string? Error,
    DateTimeOffset? CloudAcknowledgedAt);

public sealed record ReconciliationEvent(
    string Id,
    string IdempotencyKey,
    string Type,
    JsonElement Payload,
    DateTimeOffset OccurredAt,
    DateTimeOffset RejectedAt,
    string Reason);

public sealed record ProjectionBlock(
    string EventId,
    string Type,
    string Reason,
    DateTimeOffset BlockedAt);

public sealed record KdsOperationalEnvelope(
    JsonElement Data,
    DateTimeOffset CapturedAt,
    DateTimeOffset LocalProjectedAt,
    DateTimeOffset? LastSuccessfulSyncAt,
    int Pending,
    DateTimeOffset? OldestPendingAt,
    int Rejected,
    ProjectionBlock? ProjectionBlocked,
    DateTimeOffset? LeaseExpiresAt,
    string? Revision);

public static class KdsFreshnessPolicy
{
    public static string Resolve(
        bool projectionBlocked,
        string syncStatus,
        DateTimeOffset? lastSyncedAt,
        DateTimeOffset? leaseExpiresAt,
        DateTimeOffset now)
    {
        if (projectionBlocked) return "degraded";
        if (syncStatus == "offline") return "offline";
        if (lastSyncedAt is null || now - lastSyncedAt > TimeSpan.FromSeconds(30)) return "stale";
        if (leaseExpiresAt is { } expiry && expiry <= now) return "degraded";
        return "live";
    }
}
