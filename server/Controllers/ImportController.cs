using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using FinanceManager.Api.Data;
using FinanceManager.Api.Dtos;
using FinanceManager.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

[ApiController]
[Route("api")]
public class ImportController(AppDbContext db) : ControllerBase
{
    /// <summary>
    /// Import an unlocked Finance.xlsx. Each recognised sheet replaces the matching
    /// table; sheets that are missing are left untouched. Remove the workbook password
    /// in Excel first (File → Info → Protect Workbook → Encrypt with Password → clear).
    /// </summary>
    [HttpPost("import/excel")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<ImportResultDto>> ImportExcel(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest("No file uploaded.");

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        stream.Position = 0;

        XLWorkbook wb;
        try
        {
            wb = new XLWorkbook(stream);
        }
        catch (Exception ex)
        {
            return BadRequest($"Could not open the workbook. If it is password-protected, remove the password in Excel and try again. ({ex.Message})");
        }

        var inserted = new Dictionary<string, int>();

        if (FindSheet(wb, "Despesas") is { } despesas)
            inserted["expenses"] = await Replace(db.Expenses, ReadTransactions(despesas, isExpense: true).Cast<Expense>().ToList());
        if (FindSheet(wb, "Receitas") is { } receitas)
            inserted["income"] = await Replace(db.Incomes, ReadTransactions(receitas, isExpense: false).Cast<Income>().ToList());
        if (FindSheet(wb, "Gastos Fixos", "GastosFixos") is { } gastos)
            inserted["fixedCosts"] = await Replace(db.FixedCosts, ReadFixedCosts(gastos));
        if (FindSheet(wb, "Dividas", "Dívidas") is { } dividas)
            inserted["debts"] = await Replace(db.Debts, ReadDebts(dividas));
        if (FindSheet(wb, "Patrimonio", "Patrimônio") is { } patrimonio)
            inserted["netWorth"] = await Replace(db.NetWorthEntries, ReadNetWorth(patrimonio));
        if (FindSheet(wb, "Investimentos") is { } investimentos)
            inserted["investments"] = await Replace(db.Investments, ReadInvestments(investimentos));
        if (FindSheet(wb, "Contas Bancarias", "Contas Bancárias") is { } contas)
            inserted["accounts"] = await Replace(db.Accounts, ReadAccounts(contas));

        await db.SaveChangesAsync();

        if (inserted.Count == 0)
            return BadRequest("No recognised sheets found. Expected sheets like Despesas, Receitas, Gastos Fixos, Dívidas, Patrimônio, Investimentos, Contas Bancárias.");

        return new ImportResultDto("Import complete.", inserted);
    }

    /// <summary>Import a JSON backup produced by /api/export/json. Replaces all data.</summary>
    [HttpPost("import/json")]
    public async Task<ActionResult<ImportResultDto>> ImportJson([FromBody] BackupModel backup)
    {
        var inserted = new Dictionary<string, int>();
        if (backup.Expenses is not null) { await Replace(db.Expenses, backup.Expenses); inserted["expenses"] = backup.Expenses.Count; }
        if (backup.Income is not null) { await Replace(db.Incomes, backup.Income); inserted["income"] = backup.Income.Count; }
        if (backup.FixedCosts is not null) { await Replace(db.FixedCosts, backup.FixedCosts); inserted["fixedCosts"] = backup.FixedCosts.Count; }
        if (backup.Debts is not null) { await Replace(db.Debts, backup.Debts); inserted["debts"] = backup.Debts.Count; }
        if (backup.NetWorth is not null) { await Replace(db.NetWorthEntries, backup.NetWorth); inserted["netWorth"] = backup.NetWorth.Count; }
        if (backup.Investments is not null) { await Replace(db.Investments, backup.Investments); inserted["investments"] = backup.Investments.Count; }
        if (backup.Accounts is not null) { await Replace(db.Accounts, backup.Accounts); inserted["accounts"] = backup.Accounts.Count; }
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
    public async Task<ActionResult<ImportResultDto>> Reset()
    {
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

    // ---- helpers -------------------------------------------------------------

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
