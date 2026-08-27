using FinanceManager.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Services;

/// <summary>
/// Creates tables added after a database was first provisioned.
///
/// The app builds its schema with <c>EnsureCreated()</c> rather than migrations, and
/// that call is a no-op once the database exists. A table introduced later would
/// therefore never appear on an established database — it works locally, where the
/// SQLite file is routinely deleted, and fails in Azure, where it is not. This issues
/// the missing DDL directly, is safe to run on every start, and does nothing once the
/// table is present.
/// </summary>
public static class SchemaGuard
{
    public static async Task EnsureAsync(AppDbContext db, ILogger logger, CancellationToken ct = default)
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
}
