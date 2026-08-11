using System.Text.Json;
using System.Text;
using System.Text.RegularExpressions;

namespace GiroMesa.EdgeHub;

public static class SyncEnvelopeLimits
{
    private static readonly EnvelopeContract Contract = Load();

    public static int MaximumResourcePreconditions => Contract.ResourcePreconditionsMax;
    public static int MaximumPriceReferences => Contract.PriceReferencesMax;
    public static int MaximumPayloadBytes => Contract.PayloadBytesMax;
    public static int MaximumEventBytes => Contract.EventBytesMax;
    public static int MaximumBatchBytes => Contract.BatchBytesMax;
    public static int MaximumBatchEvents => Contract.BatchEventsMax;
    public static int MaximumAcknowledgements => Contract.AcknowledgementsMax;
    public static int MinimumCommandVersion => Contract.CommandVersionMin;
    public static int MaximumCommandVersion => Contract.CommandVersionMax;
    public static int MinimumResourceVersion => Contract.ResourceVersionMin;
    public static int MaximumResourceVersion => Contract.ResourceVersionMax;
    public static int MinimumAggregateSequence => Contract.AggregateSequenceMin;
    public static int MaximumAggregateSequence => Contract.AggregateSequenceMax;
    public static int MinimumIdempotencyKeyLength => Contract.IdempotencyKeyMin;
    public static int MaximumIdempotencyKeyLength => Contract.IdempotencyKeyMax;
    public static int MinimumEventTypeLength => Contract.EventTypeMin;
    public static int MaximumEventTypeLength => Contract.EventTypeMax;
    public static int MinimumAggregateTypeLength => Contract.AggregateTypeMin;
    public static int MaximumAggregateTypeLength => Contract.AggregateTypeMax;
    public static int MinimumPriceRevisionLength => Contract.PriceRevisionMin;
    public static int MaximumPriceRevisionLength => Contract.PriceRevisionMax;
    public static int MinimumPriceTokenLength => Contract.PriceTokenMin;
    public static int MaximumPriceTokenLength => Contract.PriceTokenMax;
    public static int MaximumOfflineCommandAgeDays => Contract.OfflineCommandAgeDays;
    public static int MaximumFutureClockSkewSeconds => Contract.FutureClockSkewSeconds;
    public static IReadOnlyList<int> ProtocolVersions => Contract.ProtocolVersions;
    public static IReadOnlyList<string> PriceReferenceKinds => Contract.PriceReferenceKinds;
    public static bool IsCanonicalUuid(string? value) =>
        value is not null && CanonicalUuid.IsMatch(value);

    private static EnvelopeContract Load()
    {
        using var stream = typeof(SyncEnvelopeLimits).Assembly
            .GetManifestResourceStream("GiroMesa.SyncEnvelopeContract.json")
            ?? throw new InvalidOperationException("SYNC_ENVELOPE_CONTRACT_MISSING");
        return JsonSerializer.Deserialize<EnvelopeContract>(
            stream,
            new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("SYNC_ENVELOPE_CONTRACT_INVALID");
    }

    private static readonly Regex CanonicalUuid = new(
        Contract.UuidPattern,
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private sealed record EnvelopeContract(
        string UuidPattern,
        IReadOnlyList<int> ProtocolVersions,
        IReadOnlyList<string> PriceReferenceKinds,
        bool TimestampRequiresOffset,
        int ResourcePreconditionsMax,
        int PriceReferencesMax,
        int PayloadBytesMax,
        int EventBytesMax,
        int BatchBytesMax,
        int HttpBodyBytesMax,
        int BatchEventsMax,
        int AcknowledgementsMax,
        int CommandVersionMin,
        int CommandVersionMax,
        int ResourceVersionMin,
        int ResourceVersionMax,
        int AggregateSequenceMin,
        int AggregateSequenceMax,
        int IdempotencyKeyMin,
        int IdempotencyKeyMax,
        int EventTypeMin,
        int EventTypeMax,
        int AggregateTypeMin,
        int AggregateTypeMax,
        int PriceRevisionMin,
        int PriceRevisionMax,
        int PriceTokenMin,
        int PriceTokenMax,
        int OfflineCommandAgeDays,
        int FutureClockSkewSeconds,
        int PriceOccurredAtSkewSeconds,
        int PriceReferenceValidityDays,
        int PriceReferenceDeliveryGraceDays);
}

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
    string? IdempotencyKey = null,
    int ProtocolVersion = 1,
    IReadOnlyList<ResourcePrecondition>? ResourcePreconditions = null,
    int? AggregateSequence = null,
    IReadOnlyList<PriceReference>? PriceReferences = null,
    string? PrimaryResourceId = null)
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

        if (Version < SyncEnvelopeLimits.MinimumCommandVersion ||
            Version > SyncEnvelopeLimits.MaximumCommandVersion)
        {
            errors[nameof(Version)] = ["Version must be between 1 and 100."];
        }

        if (OccurredAt > DateTimeOffset.UtcNow.AddSeconds(SyncEnvelopeLimits.MaximumFutureClockSkewSeconds))
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
        else if (Encoding.UTF8.GetByteCount(Payload.GetRawText()) > SyncEnvelopeLimits.MaximumPayloadBytes)
        {
            errors[nameof(Payload)] = ["Payload exceeds 64 KiB."];
        }

        if (IdempotencyKey is not null &&
            (IdempotencyKey.Trim().Length < SyncEnvelopeLimits.MinimumIdempotencyKeyLength ||
             IdempotencyKey.Trim().Length > SyncEnvelopeLimits.MaximumIdempotencyKeyLength))
        {
            errors[nameof(IdempotencyKey)] = ["IdempotencyKey must contain between 8 and 160 characters."];
        }

        if (Type.Trim().Length < SyncEnvelopeLimits.MinimumEventTypeLength ||
            Type.Trim().Length > SyncEnvelopeLimits.MaximumEventTypeLength)
        {
            errors[nameof(Type)] = ["Type is outside the supported length."];
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
        if (!string.IsNullOrWhiteSpace(value) && !SyncEnvelopeLimits.IsCanonicalUuid(value))
        {
            errors[field] = ["Must be a canonical lowercase RFC 4122 UUID in D format."];
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
    DateTimeOffset AcceptedAt,
    int ProtocolVersion = 1,
    IReadOnlyList<ResourcePrecondition>? ResourcePreconditions = null,
    int? AggregateSequence = null,
    IReadOnlyList<PriceReference>? PriceReferences = null,
    string? PrimaryResourceId = null);

public sealed record ResourcePrecondition(
    string Type,
    string Id,
    string OccupancyEpoch,
    int ResourceVersion);

public sealed record PriceReference(string Kind, string EntityId, string PriceRevision, string Token);

public sealed record CloudCommand(
    string Id,
    string Type,
    JsonElement Payload,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt);

public sealed record ReconciliationEvent(
    string Id,
    string IdempotencyKey,
    string Type,
    JsonElement Payload,
    DateTimeOffset OccurredAt,
    DateTimeOffset RejectedAt,
    string Reason);
