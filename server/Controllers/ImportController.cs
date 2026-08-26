using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using FinanceManager.Api.Data;
using FinanceManager.Api.Dtos;
using FinanceManager.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

[ApiController]
[Route("api")]
public class ImportController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    /// <summary>
    /// Import an unlocked Finance.xlsx. Each recognised sheet replaces the matching
    /// table; sheets that are missing are left untouched. Remove the workbook password
    /// in Excel first (File → Info → Protect Workbook → Encrypt with Password → clear).
    /// </summary>
    [HttpPost("import/excel")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<ImportResultDto>> ImportExcel(IFormFile file, [FromQuery] bool confirm = false)
    {
        if (file is null || file.Length == 0) return BadRequest("No file uploaded.");

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        stream.Position = 0;

        XLWorkbook wb;
        try
        {
            using var sanitized = RemovePivotTables(stream);
            wb = new XLWorkbook(sanitized);
        }
        catch (Exception ex)
        {
            return BadRequest($"Could not open the workbook. If it is password-protected, remove the password in Excel and try again. ({ex.Message})");
        }

        // Work out which tables this workbook would replace *before* touching the
        // database, so the overwrite guard can report what is at stake and nothing
        // is deleted when the import turns out to be unusable.
        var jobs = new List<(string Key, Func<Task<int>> Run)>();
        if (FindSheet(wb, "Despesas") is { } despesas)
            jobs.Add(("expenses", () => Replace(db.Expenses, ReadTransactions(despesas, isExpense: true).Cast<Expense>().ToList())));
        if (FindSheet(wb, "Receitas") is { } receitas)
            jobs.Add(("income", () => Replace(db.Incomes, ReadTransactions(receitas, isExpense: false).Cast<Income>().ToList())));
        if (FindSheet(wb, "Gastos Fixos", "GastosFixos") is { } gastos)
            jobs.Add(("fixedCosts", () => Replace(db.FixedCosts, ReadFixedCosts(gastos))));
        if (FindSheet(wb, "Dividas", "Dívidas") is { } dividas)
            jobs.Add(("debts", () => Replace(db.Debts, ReadDebts(dividas))));
        if (FindSheet(wb, "Patrimonio", "Patrimônio") is { } patrimonio)
            jobs.Add(("netWorth", () => Replace(db.NetWorthEntries, ReadNetWorth(patrimonio))));
        if (FindSheet(wb, "Investimentos") is { } investimentos)
            jobs.Add(("investments", () => Replace(db.Investments, ReadInvestments(investimentos))));
        if (FindSheet(wb, "Contas Bancarias", "Contas Bancárias") is { } contas)
            jobs.Add(("accounts", () => Replace(db.Accounts, ReadAccounts(contas))));

        if (jobs.Count == 0)
            return BadRequest("No recognised sheets found. Expected sheets like Despesas, Receitas, Gastos Fixos, Dívidas, Patrimônio, Investimentos, Contas Bancárias.");

        if (await GuardOverwrite(confirm, jobs.Select(j => j.Key)) is { } blocked) return blocked;

        var inserted = new Dictionary<string, int>();
        foreach (var (key, run) in jobs) inserted[key] = await run();

        await db.SaveChangesAsync();

        return new ImportResultDto("Import complete.", inserted);
    }

    /// <summary>Import a JSON backup produced by /api/export/json. Replaces all data.</summary>
    [HttpPost("import/json")]
    public async Task<ActionResult<ImportResultDto>> ImportJson([FromBody] BackupModel backup, [FromQuery] bool confirm = false)
    {
        var jobs = new List<(string Key, Func<Task<int>> Run)>();
        if (backup.Expenses is { } expenses) jobs.Add(("expenses", () => Replace(db.Expenses, expenses)));
        if (backup.Income is { } income) jobs.Add(("income", () => Replace(db.Incomes, income)));
        if (backup.FixedCosts is { } fixedCosts) jobs.Add(("fixedCosts", () => Replace(db.FixedCosts, fixedCosts)));
        if (backup.Debts is { } debts) jobs.Add(("debts", () => Replace(db.Debts, debts)));
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

    /// <summary>
    /// Strips PivotTables/PivotCaches from the uploaded workbook before ClosedXML parses it.
    /// ClosedXML has a known bug reading certain PivotCache records (throws
    /// PartStructureException: "There is a problem with element structure in XML") even when
    /// the underlying data sheets are perfectly valid. This app never reads pivot tables, so
    /// removing them first is safe and makes import work for any workbook that has them.
    /// </summary>
    private static MemoryStream RemovePivotTables(Stream input)
    {
        var output = new MemoryStream();
        input.Position = 0;
        input.CopyTo(output);
        output.Position = 0;

        using (var archive = new ZipArchive(output, ZipArchiveMode.Update, leaveOpen: true))
        {
            foreach (var entry in archive.Entries
                .Where(e => e.FullName.StartsWith("xl/pivotCache/", StringComparison.OrdinalIgnoreCase)
                         || e.FullName.StartsWith("xl/pivotTables/", StringComparison.OrdinalIgnoreCase))
                .ToList())
            {
                entry.Delete();
            }

            RewriteZipEntry(archive, "[Content_Types].xml", xml =>
                Regex.Replace(xml, "<Override[^>]*?PartName=\"/xl/(pivotCache|pivotTables)/[^\"]*\"[^>]*?/>", ""));

            RewriteZipEntry(archive, "xl/workbook.xml", xml =>
                Regex.Replace(xml, "<pivotCaches>.*?</pivotCaches>", "", RegexOptions.Singleline));

            RewriteZipEntry(archive, "xl/_rels/workbook.xml.rels", xml =>
                Regex.Replace(xml, "<Relationship\\b[^>]*?pivotCacheDefinition[^>]*?/>", ""));

            foreach (var relEntryName in archive.Entries
                .Where(e => e.FullName.StartsWith("xl/worksheets/_rels/", StringComparison.OrdinalIgnoreCase))
                .Select(e => e.FullName)
                .ToList())
            {
                RewriteZipEntry(archive, relEntryName, xml =>
                    Regex.Replace(xml, "<Relationship\\b[^>]*?/pivotTable\"[^>]*?/>", ""));
            }
        }

        output.Position = 0;
        return output;
    }

    private static void RewriteZipEntry(ZipArchive archive, string entryName, Func<string, string> transform)
    {
        var entry = archive.GetEntry(entryName);
        if (entry is null) return;

        string original;
        using (var reader = new StreamReader(entry.Open()))
            original = reader.ReadToEnd();

        var updated = transform(original);
        if (updated == original) return;

        entry.Delete();
        var replacement = archive.CreateEntry(entryName);
        using var writer = new StreamWriter(replacement.Open());
        writer.Write(updated);
    }

    private async Task<int> Replace<T>(DbSet<T> set, List<T> rows) where T : BaseEntity
    {
        set.RemoveRange(set);
        foreach (var r in rows) r.Id = 0; // force fresh identities, avoid tracker key clashes
        await set.AddRangeAsync(rows);
        return rows.Count;
    }

    private static IEnumerable<BaseEntity> ReadTransactions(IXLWorksheet ws, bool isExpense)
    {
        foreach (var row in DataRows(ws))
        {
            var date = Date(row.Cell(1));
            var amount = Dec(row.Cell(3));
            if (date is null && string.IsNullOrWhiteSpace(S(row.Cell(2)))) continue;
            if (isExpense)
                yield return new Expense { Date = date ?? default, Item = S(row.Cell(2)), Amount = amount, Category = S(row.Cell(4)), Source = S(row.Cell(5)) };
            else
                yield return new Income { Date = date ?? default, Item = S(row.Cell(2)), Amount = amount, Category = S(row.Cell(4)), Source = S(row.Cell(5)) };
        }
    }

    private static List<FixedCost> ReadFixedCosts(IXLWorksheet ws) =>
        DataRows(ws).Where(r => !string.IsNullOrWhiteSpace(S(r.Cell(3))))
            .Select(r => new FixedCost { Type = S(r.Cell(1)), Category = S(r.Cell(2)), Item = S(r.Cell(3)), MonthlyAmount = Dec(r.Cell(4)), AnnualAmount = Dec(r.Cell(5)) })
            .ToList();

    private static List<Debt> ReadDebts(IXLWorksheet ws) =>
        DataRows(ws).Where(r => !string.IsNullOrWhiteSpace(S(r.Cell(2))))
            .Select(r => new Debt { Date = Date(r.Cell(1)) ?? default, Item = S(r.Cell(2)), Installment = Dec(r.Cell(3)), Outstanding = Dec(r.Cell(4)), TermMonths = Int(r.Cell(5)), Interest = Dec(r.Cell(6)) })
            .ToList();

    private static List<NetWorthEntry> ReadNetWorth(IXLWorksheet ws) =>
        DataRows(ws).Where(r => !string.IsNullOrWhiteSpace(S(r.Cell(4))))
            .Select(r => new NetWorthEntry { Date = Date(r.Cell(1)) ?? default, Liquidity = S(r.Cell(2)), AssetClass = S(r.Cell(3)), Item = S(r.Cell(4)), Value = Dec(r.Cell(5)) })
            .ToList();

    private static List<Investment> ReadInvestments(IXLWorksheet ws) =>
        DataRows(ws).Where(r => !string.IsNullOrWhiteSpace(S(r.Cell(3))))
            .Select(r => new Investment { Date = Date(r.Cell(1)) ?? default, Origin = S(r.Cell(2)), Destination = S(r.Cell(3)), Amount = Dec(r.Cell(4)) })
            .ToList();

    private static List<BankAccount> ReadAccounts(IXLWorksheet ws) =>
        DataRows(ws).Where(r => !string.IsNullOrWhiteSpace(S(r.Cell(1))))
            .Select(r => new BankAccount { Name = S(r.Cell(1)), Iban = S(r.Cell(2)), Swift = S(r.Cell(3)) })
            .ToList();

    private static IEnumerable<IXLRangeRow> DataRows(IXLWorksheet ws)
    {
        var used = ws.RangeUsed();
        if (used is null) yield break;
        // Skip the header row.
        foreach (var row in used.RowsUsed().Skip(1))
            yield return row;
    }

    private static string S(IXLCell c) => c.IsEmpty() ? "" : c.GetString().Trim();

    private static decimal Dec(IXLCell c)
    {
        if (c.IsEmpty()) return 0m;
        if (c.TryGetValue<decimal>(out var v)) return v;
        return decimal.TryParse(c.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var p) ? p : 0m;
    }

    private static int? Int(IXLCell c)
    {
        if (c.IsEmpty()) return null;
        if (c.TryGetValue<int>(out var v)) return v;
        if (c.TryGetValue<double>(out var d)) return (int)Math.Round(d);
        return int.TryParse(c.GetString(), out var p) ? p : null;
    }

    private static DateOnly? Date(IXLCell c)
    {
        if (c.IsEmpty()) return null;
        if (c.TryGetValue<DateTime>(out var dt)) return DateOnly.FromDateTime(dt);
        return DateTime.TryParse(c.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var d2)
            ? DateOnly.FromDateTime(d2) : null;
    }

    private static IXLWorksheet? FindSheet(XLWorkbook wb, params string[] names)
    {
        foreach (var want in names)
        {
            var match = wb.Worksheets.FirstOrDefault(w => Normalize(w.Name) == Normalize(want));
            if (match is not null) return match;
        }
        return null;
    }

    private static string Normalize(string s)
    {
        var decomposed = s.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var ch in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                sb.Append(ch);
        return sb.ToString().Replace(" ", "").Normalize(NormalizationForm.FormC);
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
