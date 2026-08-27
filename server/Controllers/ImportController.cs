using FinanceManager.Api.Data;
using FinanceManager.Api.Dtos;
using FinanceManager.Api.Models;
using FinanceManager.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

[ApiController]
[Route("api")]
public class ImportController(AppDbContext db, IWebHostEnvironment env, DebtCalculator calculator) : ControllerBase
{
    /// <summary>
    /// Row count per table, so the backup page can show what is about to be exported
    /// without downloading the whole payload just to count it.
    /// </summary>
    [HttpGet("backup/summary")]
    public async Task<ActionResult<Dictionary<string, int>>> Summary()
    {
        var counts = new Dictionary<string, int>();
        foreach (var key in AllTables) counts[key] = await CountRows(key);
        return counts;
    }

    /// <summary>Import a JSON backup produced by /api/export/json. Replaces all data.</summary>
    [HttpPost("import/json")]
    public async Task<ActionResult<ImportResultDto>> ImportJson([FromBody] BackupModel backup, [FromQuery] bool confirm = false)
    {
        var jobs = new List<(string Key, Func<Task<int>> Run)>();
        if (backup.Expenses is { } expenses) jobs.Add(("expenses", () => Replace(db.Expenses, expenses)));
        if (backup.Income is { } income) jobs.Add(("income", () => Replace(db.Incomes, income)));
        if (backup.FixedCosts is { } fixedCosts) jobs.Add(("fixedCosts", () => Replace(db.FixedCosts, fixedCosts)));
        if (backup.Debts is { } debts)
        {
            // Backups taken before Prazo/Juros became calculated columns carry blanks,
            // and a hand-edited file may carry stale values. Recompute on the way in so
            // restoring can never reintroduce numbers the app would not derive itself.
            foreach (var d in debts) calculator.Apply(d);
            jobs.Add(("debts", () => Replace(db.Debts, debts)));
        }
        if (backup.NetWorth is { } netWorth) jobs.Add(("netWorth", () => Replace(db.NetWorthEntries, netWorth)));
        if (backup.Investments is { } investments) jobs.Add(("investments", () => Replace(db.Investments, investments)));
        if (backup.Accounts is { } accounts) jobs.Add(("accounts", () => Replace(db.Accounts, accounts)));

        if (await GuardOverwrite(confirm, jobs.Select(j => j.Key)) is { } blocked) return blocked;

        var inserted = new Dictionary<string, int>();
        foreach (var (key, run) in jobs) inserted[key] = await run();
        await db.SaveChangesAsync();
        return new ImportResultDto("Import complete.", inserted);
    }

    /// <summary>Download all data as a JSON backup (same shape as finance_seed.json).</summary>
    [HttpGet("export/json")]
    public async Task<ActionResult<BackupModel>> ExportJson() => new BackupModel
    {
        Expenses = await db.Expenses.ToListAsync(),
        Income = await db.Incomes.ToListAsync(),
        FixedCosts = await db.FixedCosts.ToListAsync(),
        Debts = await db.Debts.ToListAsync(),
        NetWorth = await db.NetWorthEntries.ToListAsync(),
        Investments = await db.Investments.ToListAsync(),
        Accounts = await db.Accounts.ToListAsync()
    };

    /// <summary>Delete everything. Handy before a fresh import.</summary>
    [HttpPost("import/reset")]
    public async Task<ActionResult<ImportResultDto>> Reset([FromQuery] bool confirm = false)
    {
        if (await GuardOverwrite(confirm, AllTables) is { } blocked) return blocked;

        db.Expenses.RemoveRange(db.Expenses);
        db.Incomes.RemoveRange(db.Incomes);
        db.FixedCosts.RemoveRange(db.FixedCosts);
        db.Debts.RemoveRange(db.Debts);
        db.NetWorthEntries.RemoveRange(db.NetWorthEntries);
        db.Investments.RemoveRange(db.Investments);
        db.Accounts.RemoveRange(db.Accounts);
        await db.SaveChangesAsync();
        return new ImportResultDto("All data cleared.", new());
    }

    // ---- overwrite guard -----------------------------------------------------

    private static readonly string[] AllTables =
        ["expenses", "income", "fixedCosts", "debts", "netWorth", "investments", "accounts"];

    /// <summary>
    /// Active outside local development. Deliberately keyed off "not Development"
    /// rather than "is Production" so an unexpected environment name fails safe:
    /// Azure App Service sets no ASPNETCORE_ENVIRONMENT, so it lands on Production.
    /// </summary>
    private bool GuardActive => !env.IsDevelopment();

    /// <summary>
    /// Returns a 409 Conflict result when the caller is about to destroy rows that
    /// already exist and has not confirmed. Returns null when the import may proceed.
    /// </summary>
    private async Task<ActionResult?> GuardOverwrite(bool confirm, IEnumerable<string> targets)
    {
        if (confirm || !GuardActive) return null;

        var existing = new Dictionary<string, int>();
        foreach (var key in targets)
        {
            var rows = await CountRows(key);
            if (rows > 0) existing[key] = rows;
        }
        if (existing.Count == 0) return null;

        return Conflict(new OverwriteGuardDto(
            "This would permanently delete data that is already stored. Retry with confirm=true to proceed.",
            RequiresConfirmation: true,
            existing));
    }

    private Task<int> CountRows(string table) => table switch
    {
        "expenses" => db.Expenses.CountAsync(),
        "income" => db.Incomes.CountAsync(),
        "fixedCosts" => db.FixedCosts.CountAsync(),
        "debts" => db.Debts.CountAsync(),
        "netWorth" => db.NetWorthEntries.CountAsync(),
        "investments" => db.Investments.CountAsync(),
        "accounts" => db.Accounts.CountAsync(),
        _ => Task.FromResult(0),
    };

    // ---- helpers -------------------------------------------------------------

    private async Task<int> Replace<T>(DbSet<T> set, List<T> rows) where T : BaseEntity
    {
        set.RemoveRange(set);
        foreach (var r in rows) r.Id = 0; // force fresh identities, avoid tracker key clashes
        await set.AddRangeAsync(rows);
        return rows.Count;
    }

    /// <summary>Backup shape shared by JSON import and export.</summary>
    public class BackupModel
    {
        public List<Expense>? Expenses { get; set; }
        public List<Income>? Income { get; set; }
        public List<FixedCost>? FixedCosts { get; set; }
        public List<Debt>? Debts { get; set; }
        public List<NetWorthEntry>? NetWorth { get; set; }
        public List<Investment>? Investments { get; set; }
        public List<BankAccount>? Accounts { get; set; }
    }
}
