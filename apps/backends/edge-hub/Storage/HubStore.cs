using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace GiroMesa.EdgeHub.Storage;

public sealed class HubStore(IOptions<HubOptions> options, ILogger<HubStore> logger)
{
    static HubStore() => SQLitePCL.Batteries_V2.Init();

    private readonly HubOptions _options = options.Value;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string ConnectionString
    {
        get
        {
            if (string.IsNullOrWhiteSpace(_options.DatabaseKey) || _options.DatabaseKey.Length < 32)
            {
                throw new InvalidOperationException("Hub:DatabaseKey must contain at least 32 characters.");
            }

            var directory = Path.GetFullPath(_options.DataDirectory);
            Directory.CreateDirectory(directory);
            var databasePath = Path.Combine(directory, "giromesa-edge.db").Replace('\\', '/');
            return new SqliteConnectionStringBuilder
            {
                DataSource = $"file:{databasePath}?cipher=sqlcipher&legacy=4",
                Mode = SqliteOpenMode.ReadWriteCreate,
                Password = _options.DatabaseKey,
                Pooling = false,
            }.ToString();
        }
    }

    public async Task InitializeAsync()
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var cipher = connection.CreateCommand();
        cipher.CommandText = "SELECT sqlite3mc_version();";
        if (string.IsNullOrWhiteSpace(Convert.ToString(await cipher.ExecuteScalarAsync())))
        {
            throw new InvalidOperationException("SQLCipher is unavailable; refusing to open an unencrypted database.");
        }
        var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            CREATE TABLE IF NOT EXISTS operational_events (
                id TEXT PRIMARY KEY,
                local_sequence INTEGER NOT NULL,
                organization_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                actor_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                version INTEGER NOT NULL,
                occurred_at TEXT NOT NULL,
                accepted_at TEXT NOT NULL,
                result TEXT NULL,
                synced_at TEXT NULL,
                rejected_at TEXT NULL,
                rejection_reason TEXT NULL,
                projection_blocked_at TEXT NULL,
                projection_block_reason TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_operational_events_pending
                ON operational_events (synced_at, accepted_at);
            CREATE TABLE IF NOT EXISTS paired_devices (
                token_hash TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL,
                paired_at TEXT NOT NULL,
                revoked_at TEXT NULL
            );
            CREATE TABLE IF NOT EXISTS inbound_cloud_commands (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                received_at TEXT NOT NULL,
                processed_at TEXT NULL,
                result TEXT NULL,
                error TEXT NULL,
                cloud_acknowledged_at TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_inbound_cloud_commands_ack
                ON inbound_cloud_commands (cloud_acknowledged_at, received_at);
            CREATE TABLE IF NOT EXISTS operational_snapshots (
                organization_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                payload TEXT NOT NULL,
                projected_at TEXT NOT NULL,
                cloud_captured_at TEXT NULL,
                last_successful_sync_at TEXT NULL,
                revision TEXT NULL,
                PRIMARY KEY (organization_id, unit_id)
            );
            CREATE INDEX IF NOT EXISTS ix_operational_snapshots_latest
                ON operational_snapshots (projected_at DESC);
            CREATE TABLE IF NOT EXISTS print_jobs (
                id TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                printer_id TEXT NOT NULL,
                station TEXT NOT NULL,
                content TEXT NOT NULL,
                copies INTEGER NOT NULL,
                characters_per_line INTEGER NULL,
                status TEXT NOT NULL,
                error_code TEXT NULL,
                bytes_written INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                completed_at TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_print_jobs_created
                ON print_jobs (created_at DESC);
            """;
        await command.ExecuteNonQueryAsync();
        await EnsureColumnAsync(connection, "operational_events", "idempotency_key", "TEXT");
        await EnsureColumnAsync(connection, "operational_events", "rejected_at", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "rejection_reason", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "result", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "local_sequence", "INTEGER");
        await EnsureColumnAsync(connection, "operational_events", "projection_blocked_at", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "projection_block_reason", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_snapshots", "cloud_captured_at", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_snapshots", "last_successful_sync_at", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_snapshots", "revision", "TEXT NULL");
        await EnsureColumnAsync(connection, "inbound_cloud_commands", "processed_at", "TEXT NULL");
        await EnsureColumnAsync(connection, "inbound_cloud_commands", "result", "TEXT NULL");
        await EnsureColumnAsync(connection, "inbound_cloud_commands", "error", "TEXT NULL");
        await EnsureColumnAsync(connection, "print_jobs", "request_fingerprint", "TEXT NULL");
        var backfill = connection.CreateCommand();
        backfill.CommandText = """
            UPDATE operational_events SET idempotency_key = id WHERE idempotency_key IS NULL;
            UPDATE operational_events SET local_sequence = rowid WHERE local_sequence IS NULL;
            UPDATE operational_snapshots SET cloud_captured_at = captured_at WHERE cloud_captured_at IS NULL;
            UPDATE inbound_cloud_commands
            SET error = 'LEGACY_ACK_WITHOUT_PROCESSING'
            WHERE cloud_acknowledged_at IS NOT NULL AND processed_at IS NULL AND error IS NULL;
            UPDATE print_jobs
            SET request_fingerprint = idempotency_key
            WHERE request_fingerprint IS NULL;
            """;
        await backfill.ExecuteNonQueryAsync();
        var indexes = connection.CreateCommand();
        indexes.CommandText = """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_operational_events_idempotency
                ON operational_events (unit_id, idempotency_key);
            CREATE UNIQUE INDEX IF NOT EXISTS ux_operational_events_local_sequence
                ON operational_events (local_sequence);
            """;
        await indexes.ExecuteNonQueryAsync();
        logger.LogInformation("Edge database ready at {DataDirectory}", Path.GetFullPath(_options.DataDirectory));
    }

    public async Task<bool> CheckAsync()
    {
        try
        {
            await using var connection = new SqliteConnection(ConnectionString);
            await connection.OpenAsync();
            return connection.State == System.Data.ConnectionState.Open;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Edge database health check failed");
            return false;
        }
    }

    public async Task<(StoredPrintJob Job, bool Inserted)> CreateOrGetPrintJobAsync(
        Adapters.PrintRequest request,
        string requestFingerprint)
    {
        await _gate.WaitAsync();
        try
        {
            await using var connection = new SqliteConnection(ConnectionString);
            await connection.OpenAsync();
            var id = Guid.NewGuid().ToString();
            var insert = connection.CreateCommand();
            insert.CommandText = """
                INSERT INTO print_jobs (
                    id, idempotency_key, request_fingerprint, printer_id, station, content, copies,
                    characters_per_line, status, created_at)
                VALUES (
                    $id, $idempotencyKey, $requestFingerprint, $printerId, $station, $content, $copies,
                    NULL, 'printing', $createdAt)
                ON CONFLICT (idempotency_key) DO NOTHING;
                """;
            insert.Parameters.AddWithValue("$id", id);
            insert.Parameters.AddWithValue("$idempotencyKey", request.IdempotencyKey);
            insert.Parameters.AddWithValue("$requestFingerprint", requestFingerprint);
            insert.Parameters.AddWithValue("$printerId", request.PrinterId ?? "default");
            insert.Parameters.AddWithValue("$station", request.Station);
            insert.Parameters.AddWithValue("$content", request.DocumentType);
            insert.Parameters.AddWithValue("$copies", request.Copies);
            insert.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
            var inserted = await insert.ExecuteNonQueryAsync() == 1;
            if (!inserted)
            {
                var fingerprint = connection.CreateCommand();
                fingerprint.CommandText = "SELECT request_fingerprint FROM print_jobs WHERE idempotency_key = $key";
                fingerprint.Parameters.AddWithValue("$key", request.IdempotencyKey);
                if (!string.Equals(Convert.ToString(await fingerprint.ExecuteScalarAsync()), requestFingerprint, StringComparison.Ordinal))
                    throw new InvalidOperationException("PRINT_IDEMPOTENCY_CONFLICT");
            }
            return (await ReadPrintJobByIdempotencyAsync(connection, request.IdempotencyKey), inserted);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<StoredPrintJob?> GetPrintJobAsync(string id)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, idempotency_key, printer_id, station, copies, status, error_code,
                   bytes_written, created_at, completed_at
            FROM print_jobs WHERE id = $id LIMIT 1;
            """;
        command.Parameters.AddWithValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? ReadPrintJob(reader) : null;
    }

    public async Task<StoredPrintJob> CompletePrintJobAsync(string id, Adapters.PrintResult result)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE print_jobs
            SET status = $status, error_code = $errorCode, bytes_written = $bytesWritten,
                printer_id = COALESCE($printerId, printer_id),
                completed_at = $completedAt
            WHERE id = $id AND status = 'printing';
            """;
        command.Parameters.AddWithValue("$status", result.Status);
        command.Parameters.AddWithValue("$errorCode", result.ErrorCode is null ? DBNull.Value : result.ErrorCode);
        command.Parameters.AddWithValue("$bytesWritten", result.BytesWritten);
        command.Parameters.AddWithValue("$printerId", result.PrinterId is null ? DBNull.Value : result.PrinterId);
        command.Parameters.AddWithValue("$completedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync();
        return (await GetPrintJobAsync(id))!;
    }

    private static async Task<StoredPrintJob> ReadPrintJobByIdempotencyAsync(
        SqliteConnection connection,
        string idempotencyKey)
    {
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, idempotency_key, printer_id, station, copies, status, error_code,
                   bytes_written, created_at, completed_at
            FROM print_jobs WHERE idempotency_key = $idempotencyKey LIMIT 1;
            """;
        command.Parameters.AddWithValue("$idempotencyKey", idempotencyKey);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) throw new InvalidOperationException("PRINT_JOB_NOT_FOUND");
        return ReadPrintJob(reader);
    }

    private static StoredPrintJob ReadPrintJob(SqliteDataReader reader) => new(
        reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
        reader.GetInt32(4), reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.GetInt32(7), DateTimeOffset.Parse(reader.GetString(8)),
        reader.IsDBNull(9) ? null : DateTimeOffset.Parse(reader.GetString(9)));

    public async Task<AcceptedCommand> AcceptCommandAsync(OperationalCommand command)
    {
        command = OperationalProjection.Canonicalize(command);
        await _gate.WaitAsync();
        try
        {
            await using var connection = new SqliteConnection(ConnectionString);
            await connection.OpenAsync();
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            var select = connection.CreateCommand();
            select.Transaction = transaction;
            select.CommandText = """
                SELECT id, organization_id, unit_id, actor_id, device_id, idempotency_key, type,
                       payload, version, occurred_at, accepted_at, synced_at, result
                FROM operational_events
                WHERE id = $id OR (unit_id = $unitId AND idempotency_key = $idempotencyKey)
                LIMIT 1;
                """;
            select.Parameters.AddWithValue("$id", command.Id);
            select.Parameters.AddWithValue("$unitId", command.UnitId);
            select.Parameters.AddWithValue("$idempotencyKey", command.EffectiveIdempotencyKey);
            await using (var reader = await select.ExecuteReaderAsync())
            {
                if (await reader.ReadAsync())
                {
                    using var storedPayload = JsonDocument.Parse(reader.GetString(7));
                    var matches = reader.GetString(0) == command.Id &&
                        reader.GetString(1) == command.OrganizationId &&
                        reader.GetString(2) == command.UnitId &&
                        reader.GetString(3) == command.ActorId &&
                        reader.GetString(4) == command.DeviceId &&
                        reader.GetString(5) == command.EffectiveIdempotencyKey &&
                        reader.GetString(6) == command.Type &&
                        JsonElement.DeepEquals(storedPayload.RootElement, command.Payload) &&
                        reader.GetInt32(8) == command.Version &&
                        (command.Type.StartsWith("fiscal.", StringComparison.Ordinal) ||
                         DateTimeOffset.Parse(reader.GetString(9)) == command.OccurredAt);
                    if (!matches) throw new OperationalConflictException("IDEMPOTENCY_CONFLICT");
                    var storedAcceptedAt = DateTimeOffset.Parse(reader.GetString(10));
                    DateTimeOffset? syncedAt = reader.IsDBNull(11) ? null : DateTimeOffset.Parse(reader.GetString(11));
                    JsonElement? result = reader.IsDBNull(12) ? null : ParseElement(reader.GetString(12));
                    await transaction.CommitAsync();
                    return new AcceptedCommand(command.Id, storedAcceptedAt, syncedAt, false, result);
                }
            }

            var acceptedAt = DateTimeOffset.UtcNow;
            JsonElement? localResult = null;
            if (OperationalProjection.IsPilotMutation(command.Payload))
            {
                var snapshot = await ReadSnapshotAsync(connection, transaction, command.OrganizationId, command.UnitId)
                    ?? throw new OperationalConflictException("OFFLINE_SNAPSHOT_UNAVAILABLE");
                var projection = OperationalProjection.Apply(snapshot, command, acceptedAt);
                localResult = projection.Result;
                await UpsertSnapshotAsync(connection, transaction, projection.Snapshot, acceptedAt);
            }

            var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO operational_events
                (id, local_sequence, organization_id, unit_id, actor_id, device_id, idempotency_key, type, payload,
                 version, occurred_at, accepted_at, result)
                VALUES ($id, (SELECT COALESCE(MAX(local_sequence), 0) + 1 FROM operational_events),
                        $organizationId, $unitId, $actorId, $deviceId, $idempotencyKey, $type, $payload,
                        $version, $occurredAt, $acceptedAt, $result);
                """;
            insert.Parameters.AddWithValue("$id", command.Id);
            insert.Parameters.AddWithValue("$organizationId", command.OrganizationId);
            insert.Parameters.AddWithValue("$unitId", command.UnitId);
            insert.Parameters.AddWithValue("$actorId", command.ActorId);
            insert.Parameters.AddWithValue("$deviceId", command.DeviceId);
            insert.Parameters.AddWithValue("$idempotencyKey", command.EffectiveIdempotencyKey);
            insert.Parameters.AddWithValue("$type", command.Type);
            insert.Parameters.AddWithValue("$payload", command.Payload.GetRawText());
            insert.Parameters.AddWithValue("$version", command.Version);
            insert.Parameters.AddWithValue("$occurredAt", command.OccurredAt.ToString("O"));
            insert.Parameters.AddWithValue("$acceptedAt", acceptedAt.ToString("O"));
            insert.Parameters.AddWithValue("$result", localResult is null ? DBNull.Value : localResult.Value.GetRawText());
            await insert.ExecuteNonQueryAsync();
            await transaction.CommitAsync();
            return new AcceptedCommand(command.Id, acceptedAt, null, true, localResult);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<PendingEvent>> GetPendingAsync(int limit, bool includeSecrets = false)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, organization_id, unit_id, actor_id, device_id, idempotency_key, type, payload,
                   version, occurred_at, accepted_at
            FROM operational_events
            WHERE synced_at IS NULL AND rejected_at IS NULL
            ORDER BY local_sequence
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", limit);
        var events = new List<PendingEvent>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            events.Add(new PendingEvent(
                reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5), reader.GetString(6),
                includeSecrets ? reader.GetString(7) : RedactSensitivePayload(reader.GetString(7)), reader.GetInt32(8),
                DateTimeOffset.Parse(reader.GetString(9)), DateTimeOffset.Parse(reader.GetString(10))));
        }

        return events;
    }

    public async Task<bool> AcknowledgeAsync(string eventId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE operational_events
            SET synced_at = $syncedAt, projection_blocked_at = NULL, projection_block_reason = NULL
            WHERE id = $id AND synced_at IS NULL;
            """;
        command.Parameters.AddWithValue("$syncedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", eventId);
        return await command.ExecuteNonQueryAsync() == 1;
    }

    public async Task<bool> RejectEventAsync(string eventId, string reason)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE operational_events
            SET rejected_at = $rejectedAt, rejection_reason = $reason,
                projection_blocked_at = NULL, projection_block_reason = NULL
            WHERE id = $id AND synced_at IS NULL AND rejected_at IS NULL;
            """;
        command.Parameters.AddWithValue("$rejectedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$reason", reason[..Math.Min(reason.Length, 200)]);
        command.Parameters.AddWithValue("$id", eventId);
        return await command.ExecuteNonQueryAsync() == 1;
    }

    public async Task SaveOperationalSnapshotAsync(OperationalSnapshot snapshot, string? revision = null)
    {
        snapshot.Validate();
        await _gate.WaitAsync();
        try
        {
            await using var connection = new SqliteConnection(ConnectionString);
            await connection.OpenAsync();
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            var projected = snapshot;
            var pending = connection.CreateCommand();
            pending.Transaction = transaction;
            pending.CommandText = """
                SELECT id, organization_id, unit_id, actor_id, device_id, type, payload, version,
                       occurred_at, idempotency_key, accepted_at
                FROM operational_events
                WHERE organization_id = $organizationId AND unit_id = $unitId
                  AND synced_at IS NULL AND rejected_at IS NULL
                ORDER BY local_sequence;
                """;
            pending.Parameters.AddWithValue("$organizationId", snapshot.OrganizationId);
            pending.Parameters.AddWithValue("$unitId", snapshot.UnitId);
            var commands = new List<(OperationalCommand Command, DateTimeOffset AcceptedAt)>();
            await using (var reader = await pending.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var payload = ParseElement(reader.GetString(6));
                    if (!OperationalProjection.IsPilotMutation(payload)) continue;
                    commands.Add((new OperationalCommand(
                        reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                        reader.GetString(4), reader.GetString(5), payload, reader.GetInt32(7),
                        DateTimeOffset.Parse(reader.GetString(8)), reader.GetString(9)),
                        DateTimeOffset.Parse(reader.GetString(10))));
                }
            }
            var blockedAggregates = new HashSet<string>(StringComparer.Ordinal);
            foreach (var pendingCommand in commands)
            {
                var aggregate = ProjectionAggregate(projected.Kds, pendingCommand.Command.Payload);
                if (blockedAggregates.Contains(aggregate)) continue;
                try
                {
                    projected = OperationalProjection.Apply(
                        projected,
                        pendingCommand.Command,
                        pendingCommand.AcceptedAt).Snapshot;
                    await SetProjectionBlockAsync(connection, transaction, pendingCommand.Command.Id, null);
                }
                catch (OperationalConflictException exception)
                {
                    await SetProjectionBlockAsync(connection, transaction, pendingCommand.Command.Id, exception.Code);
                    logger.LogWarning(
                        "Pending event {EventId} could not be projected over the cloud snapshot: {Code}",
                        pendingCommand.Command.Id,
                        exception.Code);
                    if (aggregate == "*") break;
                    blockedAggregates.Add(aggregate);
                }
            }
            var synchronizedAt = DateTimeOffset.UtcNow;
            await UpsertSnapshotAsync(
                connection,
                transaction,
                projected,
                synchronizedAt,
                snapshot.CapturedAt,
                synchronizedAt,
                revision);
            await transaction.CommitAsync();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<OperationalSnapshot?> GetOperationalSnapshotAsync(
        string? organizationId = null,
        string? unitId = null)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        return await ReadSnapshotAsync(connection, null, organizationId, unitId);
    }

    public async Task<string?> GetSnapshotRevisionAsync()
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT revision FROM operational_snapshots ORDER BY projected_at DESC LIMIT 1";
        return await command.ExecuteScalarAsync() as string;
    }

    public async Task MarkSyncSuccessfulAsync(DateTimeOffset synchronizedAt)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE operational_snapshots SET last_successful_sync_at = $synchronizedAt
            WHERE rowid = (SELECT rowid FROM operational_snapshots ORDER BY projected_at DESC LIMIT 1);
            """;
        command.Parameters.AddWithValue("$synchronizedAt", synchronizedAt.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    public async Task<KdsOperationalEnvelope?> GetKdsOperationalEnvelopeAsync(string? stationId = null)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT s.payload,
                   COALESCE(s.cloud_captured_at, s.captured_at),
                   s.projected_at,
                   s.last_successful_sync_at,
                   s.revision,
                   (SELECT COUNT(1) FROM operational_events e
                    WHERE e.organization_id = s.organization_id AND e.unit_id = s.unit_id
                      AND e.synced_at IS NULL AND e.rejected_at IS NULL),
                   (SELECT MIN(e.accepted_at) FROM operational_events e
                    WHERE e.organization_id = s.organization_id AND e.unit_id = s.unit_id
                      AND e.synced_at IS NULL AND e.rejected_at IS NULL),
                   (SELECT COUNT(1) FROM operational_events e
                    WHERE e.organization_id = s.organization_id AND e.unit_id = s.unit_id
                      AND e.rejected_at IS NOT NULL),
                   (SELECT e.id FROM operational_events e
                    WHERE e.organization_id = s.organization_id AND e.unit_id = s.unit_id
                      AND e.projection_blocked_at IS NOT NULL
                    ORDER BY e.local_sequence LIMIT 1),
                   (SELECT e.type FROM operational_events e
                    WHERE e.organization_id = s.organization_id AND e.unit_id = s.unit_id
                      AND e.projection_blocked_at IS NOT NULL
                    ORDER BY e.local_sequence LIMIT 1),
                   (SELECT e.projection_block_reason FROM operational_events e
                    WHERE e.organization_id = s.organization_id AND e.unit_id = s.unit_id
                      AND e.projection_blocked_at IS NOT NULL
                    ORDER BY e.local_sequence LIMIT 1),
                   (SELECT e.projection_blocked_at FROM operational_events e
                    WHERE e.organization_id = s.organization_id AND e.unit_id = s.unit_id
                      AND e.projection_blocked_at IS NOT NULL
                    ORDER BY e.local_sequence LIMIT 1)
            FROM operational_snapshots s
            ORDER BY s.projected_at DESC
            LIMIT 1;
            """;
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        var snapshot = OperationalSnapshot.Deserialize(reader.GetString(0));
        DateTimeOffset? leaseExpiresAt = null;
        if (snapshot.Approvals is { } approvals &&
            approvals.TryGetProperty("validUntil", out var validUntil) &&
            validUntil.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(validUntil.GetString(), out var parsedLease))
        {
            leaseExpiresAt = parsedLease;
        }
        ProjectionBlock? projectionBlock = null;
        if (!reader.IsDBNull(8) && !reader.IsDBNull(9) && !reader.IsDBNull(10) && !reader.IsDBNull(11))
        {
            projectionBlock = new ProjectionBlock(
                reader.GetString(8),
                reader.GetString(9),
                reader.GetString(10),
                DateTimeOffset.Parse(reader.GetString(11)));
        }
        return new KdsOperationalEnvelope(
            FilterKds(snapshot.Kds, stationId),
            DateTimeOffset.Parse(reader.GetString(1)),
            DateTimeOffset.Parse(reader.GetString(2)),
            reader.IsDBNull(3) ? null : DateTimeOffset.Parse(reader.GetString(3)),
            reader.GetInt32(5),
            reader.IsDBNull(6) ? null : DateTimeOffset.Parse(reader.GetString(6)),
            reader.GetInt32(7),
            projectionBlock,
            leaseExpiresAt,
            reader.IsDBNull(4) ? null : reader.GetString(4));
    }

    public async Task<IReadOnlyList<ReconciliationEvent>> GetReconciliationAsync(int limit)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, idempotency_key, type, payload, occurred_at, rejected_at, rejection_reason
            FROM operational_events
            WHERE rejected_at IS NOT NULL
            ORDER BY rejected_at DESC
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        var events = new List<ReconciliationEvent>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            events.Add(new ReconciliationEvent(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                ParseElement(RedactSensitivePayload(reader.GetString(3))),
                DateTimeOffset.Parse(reader.GetString(4)),
                DateTimeOffset.Parse(reader.GetString(5)),
                reader.IsDBNull(6) ? "CLOUD_REJECTED" : reader.GetString(6)));
        }
        return events;
    }

    public async Task SaveCloudCommandsAsync(IReadOnlyList<CloudCommand> commands)
    {
        if (commands.Count == 0) return;
        await _gate.WaitAsync();
        try
        {
            await using var connection = new SqliteConnection(ConnectionString);
            await connection.OpenAsync();
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            foreach (var cloudCommand in commands)
            {
                var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = """
                    INSERT OR IGNORE INTO inbound_cloud_commands
                    (id, type, payload, created_at, expires_at, received_at)
                    VALUES ($id, $type, $payload, $createdAt, $expiresAt, $receivedAt);
                    """;
                insert.Parameters.AddWithValue("$id", cloudCommand.Id);
                insert.Parameters.AddWithValue("$type", cloudCommand.Type);
                insert.Parameters.AddWithValue("$payload", cloudCommand.Payload.GetRawText());
                insert.Parameters.AddWithValue("$createdAt", cloudCommand.CreatedAt.ToString("O"));
                insert.Parameters.AddWithValue("$expiresAt", cloudCommand.ExpiresAt.ToString("O"));
                insert.Parameters.AddWithValue("$receivedAt", DateTimeOffset.UtcNow.ToString("O"));
                await insert.ExecuteNonQueryAsync();

                var select = connection.CreateCommand();
                select.Transaction = transaction;
                select.CommandText = "SELECT type, payload, created_at, expires_at FROM inbound_cloud_commands WHERE id = $id";
                select.Parameters.AddWithValue("$id", cloudCommand.Id);
                await using var reader = await select.ExecuteReaderAsync();
                await reader.ReadAsync();
                using var payload = JsonDocument.Parse(reader.GetString(1));
                if (reader.GetString(0) != cloudCommand.Type ||
                    !JsonElement.DeepEquals(payload.RootElement, cloudCommand.Payload) ||
                    DateTimeOffset.Parse(reader.GetString(2)) != cloudCommand.CreatedAt ||
                    DateTimeOffset.Parse(reader.GetString(3)) != cloudCommand.ExpiresAt)
                {
                    throw new InvalidOperationException("CLOUD_COMMAND_IDEMPOTENCY_CONFLICT");
                }
            }
            await transaction.CommitAsync();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<string>> GetPendingCloudAcknowledgementsAsync(int limit)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id FROM inbound_cloud_commands
            WHERE processed_at IS NOT NULL AND cloud_acknowledged_at IS NULL
            ORDER BY received_at
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 100));
        var ids = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) ids.Add(reader.GetString(0));
        return ids;
    }

    public async Task MarkCloudAcknowledgementsAsync(IReadOnlyList<string> commandIds)
    {
        if (commandIds.Count == 0) return;
        await _gate.WaitAsync();
        try
        {
            await using var connection = new SqliteConnection(ConnectionString);
            await connection.OpenAsync();
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            foreach (var commandId in commandIds)
            {
                var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = """
                    UPDATE inbound_cloud_commands SET cloud_acknowledged_at = $acknowledgedAt
                    WHERE id = $id AND processed_at IS NOT NULL AND cloud_acknowledged_at IS NULL;
                    """;
                update.Parameters.AddWithValue("$acknowledgedAt", DateTimeOffset.UtcNow.ToString("O"));
                update.Parameters.AddWithValue("$id", commandId);
                await update.ExecuteNonQueryAsync();
            }
            await transaction.CommitAsync();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<int> ProcessPendingCloudCommandsAsync()
    {
        await _gate.WaitAsync();
        try
        {
            await using var connection = new SqliteConnection(ConnectionString);
            await connection.OpenAsync();
            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync();
            var snapshot = await ReadSnapshotAsync(connection, transaction, null, null);
            var select = connection.CreateCommand();
            select.Transaction = transaction;
            select.CommandText = """
                SELECT id, type, payload, expires_at
                FROM inbound_cloud_commands
                WHERE processed_at IS NULL AND cloud_acknowledged_at IS NULL
                ORDER BY received_at, id;
                """;
            var pending = new List<(string Id, string Type, string Payload, DateTimeOffset ExpiresAt)>();
            await using (var reader = await select.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    pending.Add((
                        reader.GetString(0),
                        reader.GetString(1),
                        reader.GetString(2),
                        DateTimeOffset.Parse(reader.GetString(3))));
                }
            }

            var processed = 0;
            foreach (var cloudCommand in pending)
            {
                string? error = "CLOUD_COMMAND_UNSUPPORTED";
                JsonObject? result = null;
                if (cloudCommand.ExpiresAt <= DateTimeOffset.UtcNow)
                {
                    error = "CLOUD_COMMAND_EXPIRED";
                }
                else if (cloudCommand.Type == "place_order")
                {
                    using var payload = JsonDocument.Parse(cloudCommand.Payload);
                    if (snapshot is not null &&
                        TryProjectedOrder(snapshot.Kds, payload.RootElement, out var orderId, out var ticketId))
                    {
                        error = null;
                        result = new JsonObject
                        {
                            ["state"] = "projected",
                            ["orderId"] = orderId,
                            ["ticketId"] = ticketId,
                        };
                    }
                    else if (payload.RootElement.ValueKind == JsonValueKind.Object &&
                        payload.RootElement.TryGetProperty("orderId", out var orderIdProperty) &&
                        orderIdProperty.ValueKind == JsonValueKind.String)
                    {
                        error = "CLOUD_COMMAND_EFFECT_NOT_PROJECTED";
                    }
                }

                var update = connection.CreateCommand();
                update.Transaction = transaction;
                if (result is null)
                {
                    update.CommandText = """
                        UPDATE inbound_cloud_commands
                        SET error = $error
                        WHERE id = $id AND processed_at IS NULL;
                        """;
                    update.Parameters.AddWithValue("$error", error ?? "CLOUD_COMMAND_UNSUPPORTED");
                }
                else
                {
                    update.CommandText = """
                        UPDATE inbound_cloud_commands
                        SET processed_at = $processedAt, result = $result, error = NULL
                        WHERE id = $id AND processed_at IS NULL;
                        """;
                    update.Parameters.AddWithValue("$processedAt", DateTimeOffset.UtcNow.ToString("O"));
                    update.Parameters.AddWithValue("$result", result.ToJsonString());
                    processed += 1;
                }
                update.Parameters.AddWithValue("$id", cloudCommand.Id);
                await update.ExecuteNonQueryAsync();
            }
            await transaction.CommitAsync();
            return processed;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<CloudCommandState?> GetCloudCommandStateAsync(string commandId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, type, processed_at, result, error, cloud_acknowledged_at
            FROM inbound_cloud_commands
            WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$id", commandId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new CloudCommandState(
            reader.GetString(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : DateTimeOffset.Parse(reader.GetString(2)),
            reader.IsDBNull(3) ? null : ParseElement(reader.GetString(3)),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : DateTimeOffset.Parse(reader.GetString(5)));
    }

    public async Task<bool> HasCloudCommandAsync(string commandId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(1) FROM inbound_cloud_commands WHERE id = $id";
        command.Parameters.AddWithValue("$id", commandId);
        return Convert.ToInt32(await command.ExecuteScalarAsync()) == 1;
    }

    public async Task SavePairedDeviceAsync(string tokenHash, string deviceId, string deviceName)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO paired_devices (token_hash, device_id, device_name, paired_at)
            VALUES ($tokenHash, $deviceId, $deviceName, $pairedAt);
            """;
        command.Parameters.AddWithValue("$tokenHash", tokenHash);
        command.Parameters.AddWithValue("$deviceId", deviceId);
        command.Parameters.AddWithValue("$deviceName", deviceName);
        command.Parameters.AddWithValue("$pairedAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    public async Task<string?> GetActiveDeviceIdAsync(string tokenHash)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT device_id FROM paired_devices WHERE token_hash = $tokenHash AND revoked_at IS NULL";
        command.Parameters.AddWithValue("$tokenHash", tokenHash);
        return await command.ExecuteScalarAsync() as string;
    }

    private static async Task EnsureColumnAsync(
        SqliteConnection connection,
        string table,
        string column,
        string definition)
    {
        var info = connection.CreateCommand();
        info.CommandText = $"PRAGMA table_info({table})";
        await using var reader = await info.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase)) return;
        }
        await reader.DisposeAsync();
        var alter = connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE {table} ADD COLUMN {column} {definition}";
        await alter.ExecuteNonQueryAsync();
    }

    private static async Task<OperationalSnapshot?> ReadSnapshotAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        string? organizationId,
        string? unitId)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        if (organizationId is not null && unitId is not null)
        {
            command.CommandText = """
                SELECT payload FROM operational_snapshots
                WHERE organization_id = $organizationId AND unit_id = $unitId
                LIMIT 1;
                """;
            command.Parameters.AddWithValue("$organizationId", organizationId);
            command.Parameters.AddWithValue("$unitId", unitId);
        }
        else
        {
            command.CommandText = "SELECT payload FROM operational_snapshots ORDER BY projected_at DESC LIMIT 1";
        }
        var payload = await command.ExecuteScalarAsync();
        return payload is string json ? OperationalSnapshot.Deserialize(json) : null;
    }

    private static async Task UpsertSnapshotAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        OperationalSnapshot snapshot,
        DateTimeOffset projectedAt,
        DateTimeOffset? cloudCapturedAt = null,
        DateTimeOffset? lastSuccessfulSyncAt = null,
        string? revision = null)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO operational_snapshots
                (organization_id, unit_id, captured_at, payload, projected_at,
                 cloud_captured_at, last_successful_sync_at, revision)
            VALUES ($organizationId, $unitId, $capturedAt, $payload, $projectedAt,
                    $cloudCapturedAt, $lastSuccessfulSyncAt, $revision)
            ON CONFLICT (organization_id, unit_id) DO UPDATE SET
                captured_at = excluded.captured_at,
                payload = excluded.payload,
                projected_at = excluded.projected_at,
                cloud_captured_at = COALESCE(excluded.cloud_captured_at, operational_snapshots.cloud_captured_at),
                last_successful_sync_at = COALESCE(excluded.last_successful_sync_at, operational_snapshots.last_successful_sync_at),
                revision = COALESCE(excluded.revision, operational_snapshots.revision);
            """;
        command.Parameters.AddWithValue("$organizationId", snapshot.OrganizationId);
        command.Parameters.AddWithValue("$unitId", snapshot.UnitId);
        command.Parameters.AddWithValue("$capturedAt", snapshot.CapturedAt.ToString("O"));
        command.Parameters.AddWithValue("$payload", snapshot.Serialize());
        command.Parameters.AddWithValue("$projectedAt", projectedAt.ToString("O"));
        command.Parameters.AddWithValue("$cloudCapturedAt", cloudCapturedAt is null ? DBNull.Value : cloudCapturedAt.Value.ToString("O"));
        command.Parameters.AddWithValue("$lastSuccessfulSyncAt", lastSuccessfulSyncAt is null ? DBNull.Value : lastSuccessfulSyncAt.Value.ToString("O"));
        command.Parameters.AddWithValue("$revision", revision is null ? DBNull.Value : revision);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task SetProjectionBlockAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string eventId,
        string? reason)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = reason is null
            ? "UPDATE operational_events SET projection_blocked_at = NULL, projection_block_reason = NULL WHERE id = $id"
            : "UPDATE operational_events SET projection_blocked_at = $blockedAt, projection_block_reason = $reason WHERE id = $id";
        command.Parameters.AddWithValue("$id", eventId);
        if (reason is not null)
        {
            command.Parameters.AddWithValue("$blockedAt", DateTimeOffset.UtcNow.ToString("O"));
            command.Parameters.AddWithValue("$reason", reason[..Math.Min(reason.Length, 200)]);
        }
        await command.ExecuteNonQueryAsync();
    }

    private static string ProjectionAggregate(JsonElement kds, JsonElement payload)
    {
        if (payload.ValueKind == JsonValueKind.Object &&
            payload.TryGetProperty("action", out var action) &&
            payload.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            var actionName = action.GetString();
            if (actionName == "set-kds-order-priority" &&
                data.TryGetProperty("orderId", out var priorityOrderId) &&
                priorityOrderId.ValueKind == JsonValueKind.String)
            {
                return $"kds-order:{priorityOrderId.GetString()}";
            }
            if (actionName == "set-kds-priority" &&
                data.TryGetProperty("ticketId", out var priorityTicketId) &&
                priorityTicketId.ValueKind == JsonValueKind.String &&
                TryKdsOrderId(kds, priorityTicketId.GetString(), out var legacyOrderId))
            {
                return $"kds-order:{legacyOrderId}";
            }
            if ((actionName is "transition-kds" or "transition-kds-item" or "refire-kds-item" or
                "recall-kds" or "set-kds-priority" or "set-kds-course-state" or
                "block-kds-item" or "unblock-kds-item" or "acknowledge-kds-critical-note" or
                "acknowledge-kds-attention") &&
                data.TryGetProperty("ticketId", out var ticketId) &&
                ticketId.ValueKind == JsonValueKind.String)
            {
                return $"kds:{ticketId.GetString()}";
            }
            if (actionName == "handoff-kds-order" &&
                data.TryGetProperty("orderId", out var orderId) &&
                orderId.ValueKind == JsonValueKind.String)
            {
                return $"kds-order:{orderId.GetString()}";
            }
            if (actionName == "set-kds-product-availability" &&
                data.TryGetProperty("productId", out var productId) &&
                productId.ValueKind == JsonValueKind.String)
            {
                return $"kds-product:{productId.GetString()}";
            }
        }
        return "*";
    }

    private static bool TryKdsOrderId(JsonElement kds, string? ticketId, out string orderId)
    {
        orderId = "";
        if (string.IsNullOrWhiteSpace(ticketId) || kds.ValueKind != JsonValueKind.Object ||
            !kds.TryGetProperty("tickets", out var tickets) || tickets.ValueKind != JsonValueKind.Array)
        {
            return false;
        }
        foreach (var ticket in tickets.EnumerateArray())
        {
            if (ticket.ValueKind != JsonValueKind.Object ||
                !ticket.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String ||
                id.GetString() != ticketId ||
                !ticket.TryGetProperty("orderId", out var order) || order.ValueKind != JsonValueKind.String ||
                string.IsNullOrWhiteSpace(order.GetString()))
            {
                continue;
            }
            orderId = order.GetString()!;
            return true;
        }
        return false;
    }

    private static bool TryProjectedOrder(
        JsonElement kds,
        JsonElement payload,
        out string orderId,
        out string ticketId)
    {
        orderId = "";
        ticketId = "";
        if (payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty("orderId", out var orderIdProperty) ||
            orderIdProperty.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(orderIdProperty.GetString()) ||
            kds.ValueKind != JsonValueKind.Object ||
            !kds.TryGetProperty("tickets", out var tickets) ||
            tickets.ValueKind != JsonValueKind.Array)
        {
            return false;
        }
        orderId = orderIdProperty.GetString()!;
        foreach (var ticket in tickets.EnumerateArray())
        {
            if (ticket.ValueKind != JsonValueKind.Object ||
                !ticket.TryGetProperty("orderId", out var ticketOrderId) ||
                ticketOrderId.ValueKind != JsonValueKind.String ||
                ticketOrderId.GetString() != orderId)
            {
                continue;
            }
            ticketId = ticket.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
                ? id.GetString() ?? ""
                : "";
            return !string.IsNullOrWhiteSpace(ticketId);
        }
        return false;
    }

    private static JsonElement FilterKds(JsonElement kds, string? stationId)
    {
        var root = JsonNode.Parse(kds.GetRawText()) as JsonObject;
        if (root is null) return kds.Clone();
        RefreshKdsAvailabilityLifecycle(root, DateTimeOffset.UtcNow);
        if (string.IsNullOrWhiteSpace(stationId)) return ParseElement(root.ToJsonString());
        if (root["tickets"] is not JsonArray tickets || root["items"] is not JsonArray items)
            return ParseElement(root.ToJsonString());
        var ticketIds = tickets
            .OfType<JsonObject>()
            .Where(ticket => ticket["stationId"]?.GetValue<string>() == stationId)
            .Select(ticket => ticket["id"]?.GetValue<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.Ordinal);
        for (var index = tickets.Count - 1; index >= 0; index--)
        {
            if (tickets[index] is not JsonObject ticket ||
                ticket["stationId"]?.GetValue<string>() != stationId)
            {
                tickets.RemoveAt(index);
            }
        }
        for (var index = items.Count - 1; index >= 0; index--)
        {
            if (items[index] is not JsonObject item ||
                item["ticketId"]?.GetValue<string>() is not { } ticketId ||
                !ticketIds.Contains(ticketId))
            {
                items.RemoveAt(index);
            }
        }
        if (root["stations"] is JsonArray stations)
        {
            for (var index = stations.Count - 1; index >= 0; index--)
            {
                if (stations[index] is not JsonObject station ||
                    station["id"]?.GetValue<string>() != stationId)
                {
                    stations.RemoveAt(index);
                }
            }
        }
        if (root["allDay"] is JsonArray allDay)
        {
            for (var index = allDay.Count - 1; index >= 0; index--)
            {
                if (allDay[index] is not JsonObject item ||
                    item["stationId"]?.GetValue<string>() != stationId)
                {
                    allDay.RemoveAt(index);
                }
            }
        }
        if (root["batches"] is JsonArray batches)
        {
            for (var index = batches.Count - 1; index >= 0; index--)
            {
                if (batches[index] is not JsonObject batch ||
                    batch["stationId"]?.GetValue<string>() != stationId)
                {
                    batches.RemoveAt(index);
                }
            }
        }
        if (root["alerts"] is JsonArray alerts)
        {
            for (var index = alerts.Count - 1; index >= 0; index--)
            {
                if (alerts[index] is not JsonObject alert ||
                    alert["ticket"] is not JsonObject ticket ||
                    ticket["stationId"]?.GetValue<string>() != stationId)
                {
                    alerts.RemoveAt(index);
                }
            }
        }
        var scopedTickets = tickets.OfType<JsonObject>().ToArray();
        var scopedItems = items.OfType<JsonObject>().ToArray();
        var metrics = root["metrics"] as JsonObject ?? new JsonObject();
        metrics["total"] = scopedTickets.Length;
        metrics["pending"] = scopedTickets.Count(ticket => ticket["status"]?.GetValue<string>() == "pending");
        metrics["preparing"] = scopedTickets.Count(ticket => ticket["status"]?.GetValue<string>() == "preparing");
        metrics["ready"] = scopedTickets.Count(ticket => ticket["status"]?.GetValue<string>() == "ready");
        metrics["expedition"] = scopedTickets.Count(ticket =>
            ticket["status"]?.GetValue<string>() == "done" &&
            ticket["handedOffAt"] is not null &&
            ticket["servedAt"] is null);
        metrics["overdue"] = scopedTickets.Count(ticket =>
            ticket["sla"] is JsonObject sla && sla["isOverdue"]?.GetValue<bool>() == true);
        metrics["rush"] = scopedTickets.Count(ticket => ticket["rush"]?.GetValue<bool>() == true);
        metrics["blockedItems"] = scopedItems.Count(IsBlockedKdsItem);
        metrics["averageWaitMinutes"] = null;
        metrics["averagePrepMinutes"] = null;
        metrics["medianPrepMinutes"] = null;
        metrics["p90PrepMinutes"] = null;
        metrics["sampleSize"] = null;
        metrics["scope"] = "station";
        root["metrics"] = metrics;
        return ParseElement(root.ToJsonString());
    }

    private static void RefreshKdsAvailabilityLifecycle(JsonObject kds, DateTimeOffset now)
    {
        if (kds["productAvailability"] is not JsonArray availability) return;
        foreach (var row in availability.OfType<JsonObject>())
        {
            if (row["resetAt"] is JsonValue resetValue &&
                resetValue.TryGetValue<string>(out var resetAt) &&
                DateTimeOffset.TryParse(resetAt, out var parsedResetAt) &&
                parsedResetAt <= now)
            {
                row["available"] = true;
                row["reason"] = null;
                row["resetAt"] = null;
            }
            if (row["available"] is not JsonValue availableValue ||
                !availableValue.TryGetValue<bool>(out var isAvailable))
            {
                continue;
            }
            var dailyStock = ReadKdsAvailabilityCount(row["dailyStock"]);
            var soldToday = ReadKdsAvailabilityCount(row["soldToday"]) ?? 0;
            int? remaining = dailyStock is null ? null : Math.Max(0, dailyStock.Value - soldToday);
            var effectivelyAvailable = isAvailable && (remaining is null || remaining > 0);
            row["available"] = effectivelyAvailable;
            row["remainingQuantity"] = remaining;
            row["status"] = !effectivelyAvailable
                ? "unavailable"
                : dailyStock is null ? "available" : "limited";
        }
    }

    private static int? ReadKdsAvailabilityCount(JsonNode? node) =>
        node is null
            ? null
            : node is JsonValue value && value.TryGetValue<int>(out var count) && count is >= 0 and <= 1_000_000
                ? count
                : null;

    private static bool IsBlockedKdsItem(JsonObject item)
    {
        if (item["kds"] is not JsonObject production) return false;
        if (production["blocked"] is JsonObject blocked &&
            blocked["active"] is JsonValue activeValue &&
            activeValue.TryGetValue<bool>(out var active))
        {
            return active;
        }
        return production["blocked"] is JsonValue legacyValue &&
            legacyValue.TryGetValue<bool>(out var legacyActive) && legacyActive;
    }

    private static JsonElement ParseElement(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static string RedactSensitivePayload(string json)
    {
        var node = JsonNode.Parse(json);
        Redact(node);
        return node?.ToJsonString() ?? "{}";

        static void Redact(JsonNode? current)
        {
            if (current is JsonObject value)
            {
                foreach (var property in value.ToArray())
                {
                    if (property.Key.Equals("pin", StringComparison.OrdinalIgnoreCase))
                    {
                        value[property.Key] = "[redacted]";
                    }
                    else
                    {
                        Redact(property.Value);
                    }
                }
            }
            else if (current is JsonArray array)
            {
                foreach (var item in array) Redact(item);
            }
        }
    }
}


public sealed record StoredPrintJob(
    string Id,
    string IdempotencyKey,
    string PrinterId,
    string Station,
    int Copies,
    string Status,
    string? ErrorCode,
    int BytesWritten,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt);
