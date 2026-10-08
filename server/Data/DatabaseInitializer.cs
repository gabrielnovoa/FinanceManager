using System.Data.Common;
using System.Net.Sockets;
using FinanceManager.Api.Models;
using FinanceManager.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace FinanceManager.Api.Data;

/// <summary>
/// Prepares the database on startup: creates it, brings the schema up to date, seeds
/// it and recalculates derived columns. Every step is idempotent.
///
/// Azure SQL occasionally drops a connection while the app starts (a reset during
/// login, or error 40613 "database not currently available"). Unhandled, that crashes
/// the process and App Service only recovers by restarting the container minutes
/// later, so connectivity failures are retried here with a growing delay. EF's own
/// retry policy covers the error codes it knows; this also catches resets that surface
/// as plain socket errors.
/// </summary>
public static class DatabaseInitializer
{
    private static readonly TimeSpan[] Delays =
        [TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(20), TimeSpan.FromSeconds(30)];

    public static async Task RunAsync(IServiceProvider services, string contentRoot, ILogger logger)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                // A fresh scope per attempt: a context that failed half-way may hold stale state.
                using var scope = services.CreateScope();
                await InitializeAsync(scope.ServiceProvider, contentRoot, logger);
                return;
            }
            catch (Exception ex) when (attempt < Delays.Length && IsConnectivityFailure(ex))
            {
                logger.LogWarning(ex, "Database not reachable on startup (attempt {Attempt} of {Max}); retrying in {Delay}s.",
                    attempt + 1, Delays.Length + 1, Delays[attempt].TotalSeconds);
                await Task.Delay(Delays[attempt]);
            }
        }
    }

    private static async Task InitializeAsync(IServiceProvider sp, string contentRoot, ILogger logger)
    {
        var db = sp.GetRequiredService<AppDbContext>();
        db.Database.EnsureCreated();

        // EnsureCreated only builds the schema on a brand-new database, so tables added
        // later need to be created explicitly for databases that already exist.
        await SchemaGuard.EnsureAsync(db, logger);

        SeedData.Initialize(db, contentRoot);

        // Starting rules for statement classification, added only on an empty table.
        await AliasSeeder.SeedAsync(db, logger);

        // Bring the calculated debt columns in line with the formulas. Rows that
        // already agree are left untouched, so this is safe to run on every start
        // and self-heals rows written before the formulas existed.
        var calculator = sp.GetRequiredService<DebtCalculator>();
        var debts = await db.Set<Debt>().ToListAsync();
        var changed = debts.Count(calculator.Apply);
        if (changed > 0)
        {
            await db.SaveChangesAsync();
            logger.LogInformation("Recalculated Prazo/Juros on {Count} debt row(s).", changed);
        }
    }

    private static bool IsConnectivityFailure(Exception? ex)
    {
        for (; ex is not null; ex = ex.InnerException)
        {
            if (ex is DbException or RetryLimitExceededException or SocketException or IOException or TimeoutException)
                return true;
        }
        return false;
    }
}
