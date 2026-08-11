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
                rejection_reason TEXT NULL
            );
            CREATE TABLE IF NOT EXISTS aggregate_sequences (
                organization_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                aggregate_type TEXT NOT NULL,
                aggregate_id TEXT NOT NULL,
                occupancy_epoch TEXT NOT NULL,
                last_sequence INTEGER NOT NULL,
                PRIMARY KEY (organization_id, unit_id, aggregate_type, aggregate_id, occupancy_epoch)
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
                PRIMARY KEY (organization_id, unit_id)
            );
            CREATE INDEX IF NOT EXISTS ix_operational_snapshots_latest
                ON operational_snapshots (projected_at DESC);
            """;
        await command.ExecuteNonQueryAsync();
        await EnsureColumnAsync(connection, "operational_events", "idempotency_key", "TEXT");
        await EnsureColumnAsync(connection, "operational_events", "rejected_at", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "rejection_reason", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "result", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "protocol_version", "INTEGER NOT NULL DEFAULT 1");
        await EnsureColumnAsync(connection, "operational_events", "resource_preconditions", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "aggregate_sequence", "INTEGER NULL");
        await EnsureColumnAsync(connection, "operational_events", "price_references", "TEXT NULL");
        await EnsureColumnAsync(connection, "operational_events", "primary_resource_id", "TEXT NULL");
        var backfill = connection.CreateCommand();
        backfill.CommandText = "UPDATE operational_events SET idempotency_key = id WHERE idempotency_key IS NULL";
        await backfill.ExecuteNonQueryAsync();
        var indexes = connection.CreateCommand();
        indexes.CommandText = """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_operational_events_idempotency
                ON operational_events (unit_id, idempotency_key);
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

    public async Task<AcceptedCommand> AcceptCommandAsync(OperationalCommand command)
    {
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
                        DateTimeOffset.Parse(reader.GetString(9)) == command.OccurredAt;
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
            PilotSyncMetadata? syncMetadata = null;
            int? aggregateSequence = null;
            if (OperationalProjection.IsPilotMutation(command.Payload))
            {
                var snapshot = await ReadSnapshotAsync(connection, transaction, command.OrganizationId, command.UnitId)
                    ?? throw new OperationalConflictException("OFFLINE_SNAPSHOT_UNAVAILABLE");
                syncMetadata = PilotSyncMetadata.TryDerive(snapshot, command);
                if (syncMetadata is not null)
                    aggregateSequence = await NextAggregateSequenceAsync(
                        connection, transaction, command, syncMetadata.Primary);
                var projection = OperationalProjection.Apply(snapshot, command, acceptedAt);
                localResult = projection.Result;
                await UpsertSnapshotAsync(
                    connection,
                    transaction,
                    syncMetadata?.AdvanceProjection(projection.Snapshot) ?? projection.Snapshot,
                    acceptedAt);
            }

            var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO operational_events
                (id, organization_id, unit_id, actor_id, device_id, idempotency_key, type, payload,
                 version, occurred_at, accepted_at, result, protocol_version, resource_preconditions,
                 aggregate_sequence, price_references, primary_resource_id)
                VALUES ($id, $organizationId, $unitId, $actorId, $deviceId, $idempotencyKey, $type, $payload,
                        $version, $occurredAt, $acceptedAt, $result, $protocolVersion, $resources,
                        $aggregateSequence, $priceReferences, $primaryResourceId);
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
            insert.Parameters.AddWithValue("$protocolVersion", syncMetadata is null ? 1 : 2);
            insert.Parameters.AddWithValue("$resources", syncMetadata is null
                ? DBNull.Value
                : JsonSerializer.Serialize(syncMetadata.Resources, OperationalSnapshot.JsonOptions));
            insert.Parameters.AddWithValue("$aggregateSequence", aggregateSequence is null ? DBNull.Value : aggregateSequence.Value);
            insert.Parameters.AddWithValue("$priceReferences", syncMetadata is null
                ? DBNull.Value
                : JsonSerializer.Serialize(syncMetadata.PriceReferences, OperationalSnapshot.JsonOptions));
            insert.Parameters.AddWithValue("$primaryResourceId", syncMetadata is null
                ? DBNull.Value
                : syncMetadata.PrimaryResourceId);
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
                   version, occurred_at, accepted_at, protocol_version, resource_preconditions,
                   aggregate_sequence, price_references, primary_resource_id
            FROM operational_events
            WHERE synced_at IS NULL AND rejected_at IS NULL
            ORDER BY accepted_at
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
                DateTimeOffset.Parse(reader.GetString(9)), DateTimeOffset.Parse(reader.GetString(10)),
                reader.GetInt32(11),
                reader.IsDBNull(12) ? null : DeserializeList<ResourcePrecondition>(reader.GetString(12)),
                reader.IsDBNull(13) ? null : reader.GetInt32(13),
                reader.IsDBNull(14) ? null : DeserializeList<PriceReference>(reader.GetString(14)),
                reader.IsDBNull(15) ? null : reader.GetString(15)));
        }

        return events;
    }

    public async Task<bool> AcknowledgeAsync(string eventId)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "UPDATE operational_events SET synced_at = $syncedAt WHERE id = $id AND synced_at IS NULL";
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
            SET rejected_at = $rejectedAt, rejection_reason = $reason
            WHERE id = $id AND synced_at IS NULL AND rejected_at IS NULL;
            """;
        command.Parameters.AddWithValue("$rejectedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$reason", reason[..Math.Min(reason.Length, 200)]);
        command.Parameters.AddWithValue("$id", eventId);
        return await command.ExecuteNonQueryAsync() == 1;
    }

    public async Task SaveOperationalSnapshotAsync(OperationalSnapshot snapshot)
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
                       occurred_at, idempotency_key, accepted_at, protocol_version,
                       resource_preconditions, aggregate_sequence, price_references, primary_resource_id
                FROM operational_events
                WHERE organization_id = $organizationId AND unit_id = $unitId
                  AND synced_at IS NULL AND rejected_at IS NULL
                ORDER BY accepted_at;
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
                        DateTimeOffset.Parse(reader.GetString(8)), reader.GetString(9), reader.GetInt32(11),
                        reader.IsDBNull(12) ? null : DeserializeList<ResourcePrecondition>(reader.GetString(12)),
                        reader.IsDBNull(13) ? null : reader.GetInt32(13),
                        reader.IsDBNull(14) ? null : DeserializeList<PriceReference>(reader.GetString(14)),
                        reader.IsDBNull(15) ? null : reader.GetString(15)),
                        DateTimeOffset.Parse(reader.GetString(10))));
                }
            }
            foreach (var pendingCommand in commands)
            {
                try
                {
                    var projection = OperationalProjection.Apply(
                        projected,
                        pendingCommand.Command,
                        pendingCommand.AcceptedAt).Snapshot;
                    projected = pendingCommand.Command.ProtocolVersion == 2 &&
                        pendingCommand.Command.ResourcePreconditions is { Count: > 0 }
                        ? new PilotSyncMetadata(
                            pendingCommand.Command.ResourcePreconditions,
                            pendingCommand.Command.PriceReferences ?? [],
                            pendingCommand.Command.PrimaryResourceId
                                ?? throw new InvalidOperationException("ORDERED_PRIMARY_RESOURCE_MISSING")).AdvanceProjection(projection)
                        : projection;
                }
                catch (OperationalConflictException exception)
                {
                    logger.LogWarning(
                        "Pending event {EventId} could not be projected over the cloud snapshot: {Code}",
                        pendingCommand.Command.Id,
                        exception.Code);
                    break;
                }
            }
            await UpsertSnapshotAsync(connection, transaction, projected, DateTimeOffset.UtcNow);
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
            WHERE cloud_acknowledged_at IS NULL
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
                    WHERE id = $id AND cloud_acknowledged_at IS NULL;
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

    public async Task<bool> HasActiveTokenAsync(string tokenHash)
    {
        await using var connection = new SqliteConnection(ConnectionString);
        await connection.OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(1) FROM paired_devices WHERE token_hash = $tokenHash AND revoked_at IS NULL";
        command.Parameters.AddWithValue("$tokenHash", tokenHash);
        return Convert.ToInt32(await command.ExecuteScalarAsync()) == 1;
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

    private static async Task<int> NextAggregateSequenceAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        OperationalCommand command,
        ResourcePrecondition primary)
    {
        var next = connection.CreateCommand();
        next.Transaction = transaction;
        next.CommandText = """
            INSERT INTO aggregate_sequences
                (organization_id, unit_id, aggregate_type, aggregate_id, occupancy_epoch, last_sequence)
            VALUES ($organizationId, $unitId, $type, $id, $epoch, 1)
            ON CONFLICT (organization_id, unit_id, aggregate_type, aggregate_id, occupancy_epoch)
            DO UPDATE SET last_sequence = aggregate_sequences.last_sequence + 1
            RETURNING last_sequence;
            """;
        next.Parameters.AddWithValue("$organizationId", command.OrganizationId);
        next.Parameters.AddWithValue("$unitId", command.UnitId);
        next.Parameters.AddWithValue("$type", primary.Type);
        next.Parameters.AddWithValue("$id", primary.Id);
        next.Parameters.AddWithValue("$epoch", primary.OccupancyEpoch);
        return Convert.ToInt32(await next.ExecuteScalarAsync());
    }

    private static IReadOnlyList<T> DeserializeList<T>(string json) =>
        JsonSerializer.Deserialize<T[]>(json, OperationalSnapshot.JsonOptions)
        ?? throw new InvalidOperationException("INVALID_OPERATIONAL_EVENT_METADATA");

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
        DateTimeOffset projectedAt)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO operational_snapshots
                (organization_id, unit_id, captured_at, payload, projected_at)
            VALUES ($organizationId, $unitId, $capturedAt, $payload, $projectedAt)
            ON CONFLICT (organization_id, unit_id) DO UPDATE SET
                captured_at = excluded.captured_at,
                payload = excluded.payload,
                projected_at = excluded.projected_at;
            """;
        command.Parameters.AddWithValue("$organizationId", snapshot.OrganizationId);
        command.Parameters.AddWithValue("$unitId", snapshot.UnitId);
        command.Parameters.AddWithValue("$capturedAt", snapshot.CapturedAt.ToString("O"));
        command.Parameters.AddWithValue("$payload", snapshot.Serialize());
        command.Parameters.AddWithValue("$projectedAt", projectedAt.ToString("O"));
        await command.ExecuteNonQueryAsync();
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
