using System.Data.Common;
using System.Text.Json;
using System.Text.RegularExpressions;
using FinanceManager.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Services.Ai;

/// <summary>
/// Runs a single read-only SQL query on behalf of the assistant.
///
/// The model writes SQL against the app's own tables instead of searching text chunks:
/// for sums, comparisons and simulations over numbers that is far more accurate than
/// vector retrieval, and the database does the arithmetic.
///
/// Read-only is enforced by the database, not by inspecting the text: the query runs on
/// its own connection that cannot write — SQLite opened with Mode=ReadOnly, SQL Server
/// impersonating <see cref="ReaderUser"/>, a user that only has db_datareader. The text
/// screen and the always-rolled-back transaction are extra layers that turn obvious
/// mistakes into clear errors for the model.
/// </summary>
public sealed partial class FinanceSqlTool(AppDbContext db)
{
    public const int MaxRows = 200;
    private const int TimeoutSeconds = 15;
    private const int MaxCellLength = 300;

    /// <summary>Database user (no login, db_datareader only) created by <see cref="SchemaGuard"/> on SQL Server.</summary>
    public const string ReaderUser = "ai_reader";

    // Sent as its own ad-hoc batch (SQL Server rejects NO REVERT inside sp_executesql).
    // From here on the connection is the reader for good: nothing the query does can
    // switch back, and the unpooled connection is thrown away afterwards.
    private const string Impersonate = $"EXECUTE AS USER = '{ReaderUser}' WITH NO REVERT;";

    /// <summary>Every query the model ran in this request, in order — shown to the user.</summary>
    public List<ExecutedQuery> Executed { get; } = [];

    public async Task<string> RunAsync(string sql, CancellationToken ct = default)
    {
        var record = new ExecutedQuery(sql.Trim());
        Executed.Add(record);

        if (Validate(sql) is { } rejection)
        {
            record.Error = rejection;
            return $"Rejected: {rejection}";
        }

        var query = sql.Trim().TrimEnd(';');
        try
        {
            await using var conn = OpenReadOnlyConnection();
            await conn.OpenAsync(ct);
            if (conn is SqlConnection)
            {
                await using var become = conn.CreateCommand();
                become.CommandText = Impersonate;
                await become.ExecuteNonQueryAsync(ct);
            }
            await using var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandTimeout = TimeoutSeconds;
                cmd.CommandText = query;

                var result = await ReadAsync(cmd, ct);
                record.RowCount = result.RowCount;
                return JsonSerializer.Serialize(result);
            }
            finally
            {
                try { await tx.RollbackAsync(CancellationToken.None); }
                catch (Exception) { /* already ended by the server, e.g. after an error */ }
            }
        }
        catch (DbException ex)
        {
            // Hand the error back so the model can correct its SQL and try again.
            record.Error = ex.Message;
            return $"SQL error: {ex.Message}";
        }
    }

    /// <summary>A fresh connection that the database itself refuses to write through.</summary>
    private DbConnection OpenReadOnlyConnection()
    {
        var cs = db.Database.GetConnectionString()
            ?? throw new InvalidOperationException("No connection string configured.");

        if (db.Database.IsSqlite())
            return new SqliteConnection(new SqliteConnectionStringBuilder(cs) { Mode = SqliteOpenMode.ReadOnly }.ToString());

        // Unpooled: the connection is impersonating the reader with no way back, so it
        // must never be handed to the rest of the app. Closing it really closes it.
        return new SqlConnection(new SqlConnectionStringBuilder(cs)
        {
            Pooling = false,
            ApplicationName = "FinanceManager-Assistant",
        }.ConnectionString);
    }

    private static async Task<QueryResult> ReadAsync(DbCommand cmd, CancellationToken ct)
    {
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToList();
        var rows = new List<object?[]>();
        var total = 0;
        while (await reader.ReadAsync(ct))
        {
            total++;
            if (rows.Count >= MaxRows) continue; // keep counting so the model knows how much it missed
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++) row[i] = Cell(reader.IsDBNull(i) ? null : reader.GetValue(i));
            rows.Add(row);
        }
        return new QueryResult(columns, rows, total, total > rows.Count);
    }

    private static object? Cell(object? value) => value switch
    {
        null => null,
        string s when s.Length > MaxCellLength => s[..MaxCellLength] + "…",
        DateTime d => d.ToString(d.TimeOfDay == TimeSpan.Zero ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss"),
        DateOnly d => d.ToString("yyyy-MM-dd"),
        byte[] => "(binary)",
        _ => value,
    };

    /// <summary>Returns why the statement is refused, or null when it may run.</summary>
    public static string? Validate(string sql)
    {
        if (string.IsNullOrWhiteSpace(sql)) return "empty query.";

        // Judge the statement on its structure only: string literals and comments can
        // legitimately contain words like "update" or a semicolon.
        if (StripLiteralsAndComments(sql) is not { } stripped)
            return "unterminated string, identifier or comment.";
        var code = stripped.Trim();

        if (!LeadingSelect().IsMatch(code)) return "only a single SELECT (optionally starting with WITH) is allowed.";
        if (code.TrimEnd(';', ' ', '\n', '\r', '\t').Contains(';')) return "only one statement is allowed.";
        if (Forbidden().Match(code) is { Success: true } m) return $"'{m.Value}' is not allowed — this connection is read-only.";
        return null;
    }

    /// <summary>
    /// Blanks out string literals and drops comments in one left-to-right pass, following
    /// T-SQL's rules (the production database): block comments nest, and quotes inside
    /// literals and identifiers are escaped by doubling ('' "" ]]). Quoted identifiers
    /// are kept. Returns null when anything is left unterminated, rather than guessing.
    /// This is only a first screen — the read-only connection is what actually protects
    /// the data, on SQLite too, whose comment rules differ slightly.
    /// </summary>
    private static string? StripLiteralsAndComments(string sql)
    {
        var sb = new System.Text.StringBuilder(sql.Length);
        var i = 0;
        while (i < sql.Length)
        {
            var c = sql[i];
            if (c is '\'' or '"' or '[' or '`')
            {
                var close = c == '[' ? ']' : c;
                var start = i++;
                var closed = false;
                while (i < sql.Length)
                {
                    if (sql[i] != close) { i++; continue; }
                    if (i + 1 < sql.Length && sql[i + 1] == close) { i += 2; continue; } // doubled = escaped
                    i++;
                    closed = true;
                    break;
                }
                if (!closed) return null;
                if (c == '\'') sb.Append("''");
                else sb.Append(sql, start, i - start);
            }
            else if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            {
                var end = sql.IndexOf('\n', i);
                i = end < 0 ? sql.Length : end;
                sb.Append(' ');
            }
            else if (c == '/' && i + 1 < sql.Length && sql[i + 1] == '*')
            {
                var depth = 0;
                while (i < sql.Length)
                {
                    if (i + 1 < sql.Length && sql[i] == '/' && sql[i + 1] == '*') { depth++; i += 2; }
                    else if (i + 1 < sql.Length && sql[i] == '*' && sql[i + 1] == '/') { depth--; i += 2; if (depth == 0) break; }
                    else i++;
                }
                if (depth != 0) return null;
                sb.Append(' ');
            }
            else
            {
                sb.Append(c);
                i++;
            }
        }
        return sb.ToString();
    }

    [GeneratedRegex(@"^\(*\s*(select|with)\b", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingSelect();

    // T-SQL needs no semicolon between statements, so a second statement could follow a
    // SELECT unseen. Blocking every write/control keyword closes that gap.
    [GeneratedRegex(
        @"\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|deny|exec|execute|attach|detach|pragma|vacuum|reindex|analyze|into|openrowset|opendatasource|openquery|openxml|bulk|backup|restore|dbcc|waitfor|shutdown|kill|load_extension|set|declare|begin|commit|rollback|savepoint|use|go|xp_\w+|sp_\w+)\b",
        RegexOptions.IgnoreCase)]
    private static partial Regex Forbidden();

    private sealed record QueryResult(List<string> Columns, List<object?[]> Rows, int RowCount, bool Truncated);
}

public sealed class ExecutedQuery(string sql)
{
    public string Sql { get; } = sql;
    public int? RowCount { get; set; }
    public string? Error { get; set; }
}
