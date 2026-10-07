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
        await EnsureFixedCostScheduleAsync(db, logger, ct);
        await EnsureAssistantReaderAsync(db, logger, ct);
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
            await db.Database.ExecuteSqlRawAsync($"""
                IF DATABASE_PRINCIPAL_ID(N'{Ai.FinanceSqlTool.ReaderUser}') IS NULL
                BEGIN
                    CREATE USER [{Ai.FinanceSqlTool.ReaderUser}] WITHOUT LOGIN;
                    ALTER ROLE [db_datareader] ADD MEMBER [{Ai.FinanceSqlTool.ReaderUser}];
                END
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
        // The column name is a compile-time constant from this class, never user input.
#pragma warning disable EF1002
        var exists = sqlite
            ? await db.Database.SqlQueryRaw<int>(
                $"SELECT COUNT(*) AS \"Value\" FROM pragma_table_info('FixedCosts') WHERE name = '{column}'").SingleAsync(ct)
            : await db.Database.SqlQueryRaw<int>(
                $"SELECT CASE WHEN COL_LENGTH('FixedCosts', '{column}') IS NULL THEN 0 ELSE 1 END AS [Value]").SingleAsync(ct);
#pragma warning restore EF1002
        if (exists > 0) return false;

        await db.Database.ExecuteSqlRawAsync(sqlite ? sqliteDdl : sqlServerDdl, ct);
        return true;
    }
}
