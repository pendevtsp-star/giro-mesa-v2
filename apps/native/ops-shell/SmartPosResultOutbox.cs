using System.Text.Json;
using System.Text.RegularExpressions;

namespace GiroMesa.OpsShell;

internal sealed record SmartPosResultEnvelope(
    string ResultId,
    string AttemptId,
    string Status,
    string? ProviderReference,
    string? AuthorizationCode,
    string? FailureCode,
    DateTimeOffset OccurredAt,
    string Operation = "payment",
    string? ReversalId = null)
{
    private static readonly Regex ReferencePattern = new(
        "^[A-Za-z0-9._:/-]{1,120}$",
        RegexOptions.CultureInvariant);
    private static readonly Regex AuthorizationPattern = new(
        "^[A-Za-z0-9._-]{1,64}$",
        RegexOptions.CultureInvariant);
    private static readonly Regex FailurePattern = new(
        "^[A-Z0-9_]{1,80}$",
        RegexOptions.CultureInvariant);
    private static readonly Regex PanCandidatePattern = new(
        "(?<![0-9])(?:[0-9][ -]*){12,18}[0-9](?![0-9])",
        RegexOptions.CultureInvariant);

    public bool IsValid =>
        Guid.TryParse(ResultId, out _) &&
        Guid.TryParse(AttemptId, out _) &&
        Operation is "payment" or "reversal" &&
        (Operation == "payment" || Guid.TryParse(ReversalId, out _)) &&
        Status is "approved" or "declined" or "canceled" or "unknown" &&
        (ProviderReference is null ||
            (ReferencePattern.IsMatch(ProviderReference) && !ContainsPotentialPan(ProviderReference))) &&
        (AuthorizationCode is null ||
            (AuthorizationPattern.IsMatch(AuthorizationCode) && !ContainsPotentialPan(AuthorizationCode))) &&
        (FailureCode is null ||
            (FailurePattern.IsMatch(FailureCode) && !ContainsPotentialPan(FailureCode))) &&
        (Status != "approved" || ProviderReference is not null) &&
        OccurredAt != default;

    public static SmartPosResultEnvelope? FromProviderResult(SmartPosPaymentResult result)
    {
        if (!Guid.TryParse(result.AttemptId, out var attemptId) ||
            result.Status is not ("approved" or "declined" or "canceled" or "unknown"))
        {
            return null;
        }
        var envelope = new SmartPosResultEnvelope(
            Guid.NewGuid().ToString(),
            attemptId.ToString(),
            result.Status,
            Sanitize(result.ProviderReference, ReferencePattern),
            null,
            SanitizeFailureCode(result.ErrorCode),
            DateTimeOffset.UtcNow);
        return envelope.IsValid ? envelope : null;
    }

    private static string? Sanitize(string? value, Regex pattern)
    {
        var normalized = value?.Trim();
        return normalized is not null && pattern.IsMatch(normalized) && !ContainsPotentialPan(normalized)
            ? normalized
            : null;
    }

    private static string? SanitizeFailureCode(string? value)
    {
        var normalized = value?.Trim().ToUpperInvariant();
        return normalized is not null && FailurePattern.IsMatch(normalized) && !ContainsPotentialPan(normalized)
            ? normalized
            : null;
    }

    private static bool ContainsPotentialPan(string value)
    {
        foreach (Match match in PanCandidatePattern.Matches(value))
        {
            var digits = match.Value.Where(char.IsAsciiDigit).Select(character => character - '0').ToArray();
            if (digits.Length is >= 13 and <= 19 && PassesLuhn(digits)) return true;
        }
        return false;
    }

    private static bool PassesLuhn(IReadOnlyList<int> digits)
    {
        var sum = 0;
        var doubleDigit = false;
        for (var index = digits.Count - 1; index >= 0; index--)
        {
            var digit = digits[index];
            if (doubleDigit)
            {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
            doubleDigit = !doubleDigit;
        }
        return sum % 10 == 0;
    }
}

internal sealed record SmartPosResultSubmission(bool Accepted, bool Retryable, string? ErrorCode);

internal interface ISmartPosResultSink
{
    Task<SmartPosResultSubmission> SubmitAsync(
        SmartPosResultEnvelope result,
        CancellationToken cancellationToken = default);
}

internal sealed record SmartPosOutboxFlushResult(
    int Submitted,
    int Quarantined,
    int Remaining,
    string? ErrorCode);

internal sealed record SmartPosResultDeadLetter(
    SmartPosResultEnvelope Result,
    string ErrorCode,
    DateTimeOffset QuarantinedAt)
{
    public bool IsValid =>
        Result.IsValid &&
        Regex.IsMatch(ErrorCode, "^[A-Z0-9_]{1,80}$", RegexOptions.CultureInvariant) &&
        QuarantinedAt != default;
}

internal sealed class SmartPosResultOutbox
{
    private const string OutboxKey = "smartpos_result_outbox_v1";
    private const string DeadLetterKey = "smartpos_result_dead_letter_v1";
    private const int MaximumEntries = 100;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<bool> CanAcceptAsync()
    {
        await _gate.WaitAsync();
        try
        {
            var entries = await LoadUnsafeAsync();
            var deadLetters = await LoadDeadLettersUnsafeAsync();
            return entries is not null && deadLetters is not null &&
                entries.Count + deadLetters.Count < MaximumEntries;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> EnqueueAsync(SmartPosResultEnvelope result)
    {
        if (!result.IsValid) return false;
        await _gate.WaitAsync();
        try
        {
            var entries = await LoadUnsafeAsync();
            var deadLetters = await LoadDeadLettersUnsafeAsync();
            if (entries is null || deadLetters is null) return false;
            if (entries.Any(entry => entry.ResultId == result.ResultId)) return true;
            if (deadLetters.Any(entry => entry.Result.ResultId == result.ResultId)) return true;
            if (entries.Count + deadLetters.Count >= MaximumEntries) return false;
            entries.Add(result);
            return await SaveUnsafeAsync(entries);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<SmartPosOutboxFlushResult> FlushAsync(
        ISmartPosResultSink sink,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var entries = await LoadUnsafeAsync();
            var deadLetters = await LoadDeadLettersUnsafeAsync();
            if (entries is null || deadLetters is null)
                return new(0, 0, 0, "SMARTPOS_OUTBOX_UNAVAILABLE");
            var submitted = 0;
            string? quarantineCode = deadLetters.LastOrDefault()?.ErrorCode;
            while (entries.Count > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var pending = entries[0];
                var result = await sink.SubmitAsync(pending, cancellationToken);
                if (!result.Accepted)
                {
                    var errorCode = SanitizeErrorCode(result.ErrorCode);
                    if (result.Retryable)
                        return new(submitted, deadLetters.Count, entries.Count, errorCode);
                    if (!deadLetters.Any(entry => entry.Result.ResultId == pending.ResultId))
                    {
                        if (entries.Count + deadLetters.Count > MaximumEntries)
                            return new(
                                submitted,
                                deadLetters.Count,
                                entries.Count,
                                "SMARTPOS_DEAD_LETTER_FULL");
                        deadLetters.Add(new(pending, errorCode, DateTimeOffset.UtcNow));
                        if (!await SaveDeadLettersUnsafeAsync(deadLetters))
                            return new(
                                submitted,
                                deadLetters.Count - 1,
                                entries.Count,
                                "SMARTPOS_DEAD_LETTER_UNAVAILABLE");
                    }
                    quarantineCode = errorCode;
                    entries.RemoveAt(0);
                    if (!await SaveUnsafeAsync(entries))
                        return new(
                            submitted,
                            deadLetters.Count,
                            entries.Count + 1,
                            "SMARTPOS_OUTBOX_UNAVAILABLE");
                    continue;
                }
                entries.RemoveAt(0);
                submitted++;
                if (!await SaveUnsafeAsync(entries))
                    return new(
                        submitted,
                        deadLetters.Count,
                        entries.Count + 1,
                        "SMARTPOS_OUTBOX_UNAVAILABLE");
            }
            return new(submitted, deadLetters.Count, 0, quarantineCode);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task<List<SmartPosResultEnvelope>?> LoadUnsafeAsync()
    {
        try
        {
            var value = await SecureStorage.Default.GetAsync(OutboxKey);
            if (string.IsNullOrWhiteSpace(value)) return [];
            var entries = JsonSerializer.Deserialize<List<SmartPosResultEnvelope>>(value);
            return entries is not null && entries.All(entry => entry.IsValid) ? entries : null;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return null;
        }
    }

    private static async Task<bool> SaveUnsafeAsync(IReadOnlyList<SmartPosResultEnvelope> entries)
    {
        try
        {
            await SecureStorage.Default.SetAsync(OutboxKey, JsonSerializer.Serialize(entries));
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return false;
        }
    }

    private static async Task<List<SmartPosResultDeadLetter>?> LoadDeadLettersUnsafeAsync()
    {
        try
        {
            var value = await SecureStorage.Default.GetAsync(DeadLetterKey);
            if (string.IsNullOrWhiteSpace(value)) return [];
            var entries = JsonSerializer.Deserialize<List<SmartPosResultDeadLetter>>(value);
            return entries is not null && entries.Count <= MaximumEntries &&
                entries.All(entry => entry.IsValid)
                ? entries
                : null;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return null;
        }
    }

    private static async Task<bool> SaveDeadLettersUnsafeAsync(
        IReadOnlyList<SmartPosResultDeadLetter> entries)
    {
        try
        {
            await SecureStorage.Default.SetAsync(DeadLetterKey, JsonSerializer.Serialize(entries));
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return false;
        }
    }

    private static string SanitizeErrorCode(string? value)
    {
        var normalized = value?.Trim().ToUpperInvariant();
        return normalized is not null &&
            Regex.IsMatch(normalized, "^[A-Z0-9_]{1,80}$", RegexOptions.CultureInvariant)
            ? normalized
            : "SMARTPOS_RESULT_NOT_ACCEPTED";
    }
}
