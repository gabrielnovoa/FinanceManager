using FinanceManager.Api.Data;
using FinanceManager.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Services;

/// <summary>
/// Creates tables and columns added after a database was first provisioned.
///
/// The app builds its schema with <c>EnsureCreated()</c> rather than migrations, and
/// that call is a no-op once the database exists. A table or column introduced later
/// would therefore never appear on an established database — it works locally, where
/// the SQLite file is routinely deleted, and fails in Azure, where it is not. This
/// issues the missing DDL directly, is safe to run on every start, and does nothing
/// once the schema is current.
/// </summary>
public static class SchemaGuard
{
    public static async Task EnsureAsync(AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        await EnsureAliasTableAsync(db, logger, ct);
        // Before anything that loads rows through EF: the model already expects the references.
        await EnsureLookupsAsync(db, logger, ct);
        await EnsureFixedCostScheduleAsync(db, logger, ct);
        await EnsureChatHistoryAsync(db, logger, ct);
        await EnsureAssistantReaderAsync(db, logger, ct);
    }

    /// <summary>Conversations with the AI assistant, kept per user.</summary>
    private static async Task EnsureChatHistoryAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        var sql = db.Database.IsSqlite()
            ? """
              CREATE TABLE IF NOT EXISTS "ChatConversations" (
                  "Id"        INTEGER NOT NULL CONSTRAINT "PK_ChatConversations" PRIMARY KEY AUTOINCREMENT,
                  "Owner"     TEXT    NOT NULL,
                  "Title"     TEXT    NOT NULL,
                  "CreatedAt" TEXT    NOT NULL,
                  "UpdatedAt" TEXT    NOT NULL
              );
              CREATE INDEX IF NOT EXISTS "IX_ChatConversations_Owner_UpdatedAt"
                  ON "ChatConversations" ("Owner", "UpdatedAt");
              CREATE TABLE IF NOT EXISTS "ChatMessages" (
                  "Id"             INTEGER NOT NULL CONSTRAINT "PK_ChatMessages" PRIMARY KEY AUTOINCREMENT,
                  "ConversationId" INTEGER NOT NULL,
                  "Role"           TEXT    NOT NULL,
                  "Content"        TEXT    NOT NULL,
                  "Details"        TEXT    NULL,
                  "CreatedAt"      TEXT    NOT NULL,
                  CONSTRAINT "FK_ChatMessages_ChatConversations_ConversationId" FOREIGN KEY ("ConversationId")
                      REFERENCES "ChatConversations" ("Id") ON DELETE CASCADE
              );
              CREATE INDEX IF NOT EXISTS "IX_ChatMessages_ConversationId" ON "ChatMessages" ("ConversationId");
              """
            : """
              IF OBJECT_ID(N'[ChatConversations]', N'U') IS NULL
              BEGIN
                  CREATE TABLE [ChatConversations] (
                      [Id]        int           NOT NULL IDENTITY,
                      [Owner]     nvarchar(200) NOT NULL,
                      [Title]     nvarchar(200) NOT NULL,
                      [CreatedAt] datetime2     NOT NULL,
                      [UpdatedAt] datetime2     NOT NULL,
                      CONSTRAINT [PK_ChatConversations] PRIMARY KEY ([Id])
                  );
                  CREATE INDEX [IX_ChatConversations_Owner_UpdatedAt] ON [ChatConversations] ([Owner], [UpdatedAt]);
              END
              IF OBJECT_ID(N'[ChatMessages]', N'U') IS NULL
              BEGIN
                  CREATE TABLE [ChatMessages] (
                      [Id]             int           NOT NULL IDENTITY,
                      [ConversationId] int           NOT NULL,
                      [Role]           nvarchar(20)  NOT NULL,
                      [Content]        nvarchar(max) NOT NULL,
                      [Details]        nvarchar(max) NULL,
                      [CreatedAt]      datetime2     NOT NULL,
                      CONSTRAINT [PK_ChatMessages] PRIMARY KEY ([Id]),
                      CONSTRAINT [FK_ChatMessages_ChatConversations_ConversationId] FOREIGN KEY ([ConversationId])
                          REFERENCES [ChatConversations] ([Id]) ON DELETE CASCADE
                  );
                  CREATE INDEX [IX_ChatMessages_ConversationId] ON [ChatMessages] ([ConversationId]);
              END
              """;

        try
        {
            await db.Database.ExecuteSqlRawAsync(sql, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not ensure the chat history tables exist.");
        }
    }

    /// <summary>
    /// On SQL Server, the AI assistant's queries run impersonating a user that can only
    /// read (see <see cref="Ai.FinanceSqlTool"/>). It has no login, so nobody can sign in
    /// as it; the app's identity (db_owner) can impersonate it. SQLite needs nothing —
    /// the assistant opens it in read-only mode.
    /// </summary>
    private static async Task EnsureAssistantReaderAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        if (db.Database.IsSqlite()) return;
        try
        {
            // DENY wins over db_datareader: the assistant must never read chat history,
            // which would let one user's questions surface in another user's answers.
            await db.Database.ExecuteSqlRawAsync($"""
                IF DATABASE_PRINCIPAL_ID(N'{Ai.FinanceSqlTool.ReaderUser}') IS NULL
                BEGIN
                    CREATE USER [{Ai.FinanceSqlTool.ReaderUser}] WITHOUT LOGIN;
                    ALTER ROLE [db_datareader] ADD MEMBER [{Ai.FinanceSqlTool.ReaderUser}];
                END
                IF OBJECT_ID(N'[ChatConversations]', N'U') IS NOT NULL
                    DENY SELECT ON [ChatConversations] TO [{Ai.FinanceSqlTool.ReaderUser}];
                IF OBJECT_ID(N'[ChatMessages]', N'U') IS NOT NULL
                    DENY SELECT ON [ChatMessages] TO [{Ai.FinanceSqlTool.ReaderUser}];
                """, ct);
        }
        catch (Exception ex)
        {
            // Without the user the assistant's queries fail with a clear error; nothing else is affected.
            logger.LogError(ex, "Could not ensure the read-only assistant user exists.");
        }
    }

    private static async Task EnsureAliasTableAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        var sqlite = db.Database.IsSqlite();

        var sql = sqlite
            ? """
              CREATE TABLE IF NOT EXISTS "ClassificationAliases" (
                  "Id"       INTEGER      NOT NULL CONSTRAINT "PK_ClassificationAliases" PRIMARY KEY AUTOINCREMENT,
                  "Pattern"  TEXT         NOT NULL,
                  "Kind"     TEXT         NOT NULL,
                  "Item"     TEXT         NOT NULL,
                  "Category" TEXT         NOT NULL,
                  "Hits"     INTEGER      NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_ClassificationAliases_Pattern"
                  ON "ClassificationAliases" ("Pattern");
              """
            : """
              IF OBJECT_ID(N'[ClassificationAliases]', N'U') IS NULL
              BEGIN
                  CREATE TABLE [ClassificationAliases] (
                      [Id]       int            NOT NULL IDENTITY,
                      [Pattern]  nvarchar(200)  NOT NULL,
                      [Kind]     nvarchar(20)   NOT NULL,
                      [Item]     nvarchar(200)  NOT NULL,
                      [Category] nvarchar(200)  NOT NULL,
                      [Hits]     int            NOT NULL,
                      CONSTRAINT [PK_ClassificationAliases] PRIMARY KEY ([Id])
                  );
                  CREATE UNIQUE INDEX [IX_ClassificationAliases_Pattern]
                      ON [ClassificationAliases] ([Pattern]);
              END
              """;

        try
        {
            await db.Database.ExecuteSqlRawAsync(sql, ct);
        }
        catch (Exception ex)
        {
            // A failure here must not stop the app: every other feature still works
            // without the alias table, and the statement import reports its own error.
            logger.LogError(ex, "Could not ensure the ClassificationAliases table exists.");
        }
    }

    /// <summary>
    /// FixedCosts.Frequency and FixedCosts.DueMonths split the costs into monthly and
    /// annual ones. When the columns are first added, existing rows are classified from
    /// their amounts so the annual ones land in the right table straight away.
    /// </summary>
    private static async Task EnsureFixedCostScheduleAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        var sqlite = db.Database.IsSqlite();
        try
        {
            var addedFrequency = await AddColumnAsync(db, sqlite, "Frequency",
                """ALTER TABLE "FixedCosts" ADD COLUMN "Frequency" TEXT NOT NULL DEFAULT 'Monthly'""",
                "ALTER TABLE [FixedCosts] ADD [Frequency] nvarchar(20) NOT NULL CONSTRAINT [DF_FixedCosts_Frequency] DEFAULT N'Monthly'",
                ct);
            await AddColumnAsync(db, sqlite, "DueMonths",
                """ALTER TABLE "FixedCosts" ADD COLUMN "DueMonths" TEXT NOT NULL DEFAULT ''""",
                "ALTER TABLE [FixedCosts] ADD [DueMonths] nvarchar(40) NOT NULL CONSTRAINT [DF_FixedCosts_DueMonths] DEFAULT N''",
                ct);

            if (!addedFrequency) return;

            var costs = await db.FixedCosts.ToListAsync(ct);
            FixedCostCalculator.Normalize(costs);
            await db.SaveChangesAsync(ct);
            logger.LogInformation(
                "Added FixedCosts frequency; classified {Annual} of {Total} existing row(s) as annual.",
                costs.Count(c => c.Frequency == CostFrequency.Annual), costs.Count);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not ensure the FixedCosts frequency columns exist.");
        }
    }

    /// <returns>True when the column was missing and has just been added.</returns>
    private static async Task<bool> AddColumnAsync(
        AppDbContext db, bool sqlite, string column, string sqliteDdl, string sqlServerDdl, CancellationToken ct)
    {
        if (await ColumnExistsAsync(db, sqlite, "FixedCosts", column, ct)) return false;

        await db.Database.ExecuteSqlRawAsync(sqlite ? sqliteDdl : sqlServerDdl, ct);
        return true;
    }

    private static async Task<bool> ColumnExistsAsync(AppDbContext db, bool sqlite, string table, string column, CancellationToken ct)
    {
        // Table and column names are compile-time constants from this class, never user input.
#pragma warning disable EF1002
        var exists = sqlite
            ? await db.Database.SqlQueryRaw<int>(
                $"SELECT COUNT(*) AS \"Value\" FROM pragma_table_info('{table}') WHERE name = '{column}'").SingleAsync(ct)
            : await db.Database.SqlQueryRaw<int>(
                $"SELECT CASE WHEN COL_LENGTH('{table}', '{column}') IS NULL THEN 0 ELSE 1 END AS [Value]").SingleAsync(ct);
#pragma warning restore EF1002
        return exists > 0;
    }

    // ---- categories and sources ----------------------------------------------

    private static readonly (string Table, string Text, string Reference, string Lookup)[] LookupColumns =
    [
        ("Expenses", "Category", "CategoryId", "Categories"),
        ("Expenses", "Source", "SourceId", "Sources"),
        ("Incomes", "Category", "CategoryId", "Categories"),
        ("Incomes", "Source", "SourceId", "Sources"),
        ("FixedCosts", "Category", "CategoryId", "Categories"),
    ];

    /// <summary>
    /// Moves categories and sources out of free-text columns into the Categories and
    /// Sources tables, leaving a reference on each row.
    ///
    /// For each text column still present: add the reference column, give every distinct
    /// text value an entry (matched like <see cref="LookupResolver"/>, so "Casa" and
    /// "casa " become one), point the rows at it, then drop the text column. Every step
    /// checks before acting, so a run interrupted half-way simply finishes on the next
    /// start. Unlike the other steps this one is not swallowed on failure: the app cannot
    /// read these tables until it has run.
    /// </summary>
    private static async Task EnsureLookupsAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        var sqlite = db.Database.IsSqlite();

        await db.Database.ExecuteSqlRawAsync(sqlite
            ? """
              CREATE TABLE IF NOT EXISTS "Categories" (
                  "Id"   INTEGER NOT NULL CONSTRAINT "PK_Categories" PRIMARY KEY AUTOINCREMENT,
                  "Name" TEXT    NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_Categories_Name" ON "Categories" ("Name");
              CREATE TABLE IF NOT EXISTS "Sources" (
                  "Id"   INTEGER NOT NULL CONSTRAINT "PK_Sources" PRIMARY KEY AUTOINCREMENT,
                  "Name" TEXT    NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_Sources_Name" ON "Sources" ("Name");
              """
            : """
              IF OBJECT_ID(N'[Categories]', N'U') IS NULL
              BEGIN
                  CREATE TABLE [Categories] (
                      [Id]   int           NOT NULL IDENTITY,
                      [Name] nvarchar(100) NOT NULL,
                      CONSTRAINT [PK_Categories] PRIMARY KEY ([Id])
                  );
                  CREATE UNIQUE INDEX [IX_Categories_Name] ON [Categories] ([Name]);
              END
              IF OBJECT_ID(N'[Sources]', N'U') IS NULL
              BEGIN
                  CREATE TABLE [Sources] (
                      [Id]   int           NOT NULL IDENTITY,
                      [Name] nvarchar(100) NOT NULL,
                      CONSTRAINT [PK_Sources] PRIMARY KEY ([Id])
                  );
                  CREATE UNIQUE INDEX [IX_Sources_Name] ON [Sources] ([Name]);
              END
              """, ct);

        var pending = new List<(string Table, string Text, string Reference, string Lookup)>();
        foreach (var column in LookupColumns)
            if (await ColumnExistsAsync(db, sqlite, column.Table, column.Text, ct)) pending.Add(column);
        if (pending.Count == 0) return;

#pragma warning disable EF1002 // identifiers come from LookupColumns above; values are parameters
        // Count every spelling in every table first, so that when several differ only in
        // case or spacing, the entry takes the one most rows use. Binary grouping on SQL
        // Server, whose default collation would otherwise fold the spellings together.
        var spellings = new Dictionary<(string Table, string Text), List<RawValue>>();
        foreach (var (table, text, _, _) in pending)
            spellings[(table, text)] = await db.Database.SqlQueryRaw<RawValue>(sqlite
                    ? $"SELECT \"{text}\" AS \"Value\", COUNT(*) AS \"Uses\" FROM \"{table}\" GROUP BY \"{text}\""
                    : $"SELECT [{text}] COLLATE Latin1_General_BIN2 AS [Value], COUNT(*) AS [Uses] FROM [{table}] GROUP BY [{text}] COLLATE Latin1_General_BIN2")
                .ToListAsync(ct);

        var ids = new Dictionary<string, Dictionary<string, int>>();
        foreach (var lookup in pending.Select(p => p.Lookup).Distinct())
        {
            var byName = lookup == "Categories"
                ? await db.Categories.ToDictionaryAsync(c => c.Name, c => c.Id, StringComparer.OrdinalIgnoreCase, ct)
                : await db.Sources.ToDictionaryAsync(s => s.Name, s => s.Id, StringComparer.OrdinalIgnoreCase, ct);

            var groups = pending.Where(p => p.Lookup == lookup)
                .SelectMany(p => spellings[(p.Table, p.Text)])
                .Where(v => LookupResolver.Normalize(v.Value).Length > 0)
                .GroupBy(v => LookupResolver.Normalize(v.Value), StringComparer.OrdinalIgnoreCase);

            foreach (var group in groups)
            {
                if (byName.ContainsKey(group.Key)) continue;
                var name = LookupResolver.Normalize(group
                    .GroupBy(v => v.Value, StringComparer.Ordinal)
                    .OrderByDescending(g => g.Sum(v => v.Uses)).ThenBy(g => g.Key, StringComparer.Ordinal)
                    .First().Key);
                BaseEntity created = lookup == "Categories" ? new Category { Name = name } : new Source { Name = name };
                db.Add(created);
                await db.SaveChangesAsync(ct);
                byName[name] = created.Id;
                if (group.Select(v => v.Value).Distinct(StringComparer.Ordinal).Count() > 1)
                    logger.LogInformation("{Lookup}: \"{Name}\" also covers {Variants}.", lookup, name,
                        string.Join(", ", group.Select(v => $"\"{v.Value}\"").Distinct()));
            }
            ids[lookup] = byName;
        }

        foreach (var (table, text, reference, lookup) in pending)
        {
            if (!await ColumnExistsAsync(db, sqlite, table, reference, ct))
            {
                await db.Database.ExecuteSqlRawAsync(sqlite
                    ? $"""
                       ALTER TABLE "{table}" ADD COLUMN "{reference}" INTEGER NULL
                           CONSTRAINT "FK_{table}_{lookup}_{reference}" REFERENCES "{lookup}" ("Id") ON DELETE RESTRICT;
                       CREATE INDEX IF NOT EXISTS "IX_{table}_{reference}" ON "{table}" ("{reference}");
                       """
                    : $"""
                       ALTER TABLE [{table}] ADD [{reference}] int NULL
                           CONSTRAINT [FK_{table}_{lookup}_{reference}] REFERENCES [{lookup}] ([Id]);
                       """, ct);
                if (!sqlite)
                    await db.Database.ExecuteSqlRawAsync($"CREATE INDEX [IX_{table}_{reference}] ON [{table}] ([{reference}]);", ct);
            }

            var mapped = 0;
            var values = spellings[(table, text)];
            foreach (var value in values)
            {
                var name = LookupResolver.Normalize(value.Value);
                if (name.Length == 0) continue; // blank stays NULL

                // Exact match on the stored text, so every spelling is pointed at its entry.
                mapped += await db.Database.ExecuteSqlRawAsync(sqlite
                    ? $"UPDATE \"{table}\" SET \"{reference}\" = {{0}} WHERE \"{text}\" = {{1}}"
                    : $"UPDATE [{table}] SET [{reference}] = {{0}} WHERE [{text}] = {{1}}",
                    [ids[lookup][name], value.Value], ct);
            }

            await db.Database.ExecuteSqlRawAsync(sqlite
                ? $"ALTER TABLE \"{table}\" DROP COLUMN \"{text}\""
                : $"ALTER TABLE [{table}] DROP COLUMN [{text}]", ct);

            logger.LogInformation("Moved {Table}.{Column} into {Lookup}: {Values} distinct value(s), {Rows} row(s) linked.",
                table, text, lookup, values.Count, mapped);
        }
#pragma warning restore EF1002
    }

    private sealed class RawValue
    {
        public string Value { get; set; } = "";
        public int Uses { get; set; }
    }
}
