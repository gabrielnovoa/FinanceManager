using FinanceManager.Api.Data;
using FinanceManager.Api.Models;
using FinanceManager.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

/// <summary>
/// Imports bank and card statements into Receitas/Despesas.
///
/// Deliberately split in two: <c>preview</c> reads the file and proposes a classification
/// without touching the database, and <c>commit</c> stores only the lines the user ticked
/// after reviewing them. Nothing is ever written straight from a file.
/// </summary>
[ApiController]
[Route("api/statement")]
public class StatementController(
    AppDbContext db,
    StatementParser parser,
    StatementClassifier classifier,
    ILogger<StatementController> logger) : ControllerBase
{
    private const long MaxUploadBytes = 10 * 1024 * 1024;

    // ------------------------------------------------------------------ preview

    [HttpPost("preview")]
    [RequestSizeLimit(MaxUploadBytes)]
    public async Task<ActionResult<StatementPreviewResponse>> Preview(
        IFormFile file,
        [FromForm] string? source,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0) return BadRequest(new { error = "No file was uploaded." });

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (extension is not (".xls" or ".xlsx"))
            return BadRequest(new { error = "Only .xls and .xlsx statements are supported." });

        ParsedStatement parsed;
        try
        {
            using var stream = new MemoryStream();
            await file.CopyToAsync(stream, ct);
            parsed = parser.Parse(stream, file.FileName);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read statement {File}.", file.FileName);
            return BadRequest(new { error = $"Could not read the statement: {ex.Message}" });
        }

        if (parsed.Lines.Count == 0)
            return BadRequest(new { error = "The statement contains no movements." });

        var sources = await KnownSourcesAsync(ct);
        var resolvedSource = !string.IsNullOrWhiteSpace(source)
            ? source.Trim()
            : StatementClassifier.DetectSource(file.FileName, sources) ?? "";

        var aliases = await db.ClassificationAliases.AsNoTracking().ToListAsync(ct);
        var history = await BuildHistoryAsync(ct);
        var existing = await ExistingKeysAsync(parsed.Lines, resolvedSource, ct);

        var classified = classifier.Classify(
            parsed.Lines, aliases, history, resolvedSource,
            (date, amount, isCredit) => existing.Contains(DuplicateKey(date, amount, isCredit, resolvedSource)));

        return Ok(new StatementPreviewResponse
        {
            FileName = file.FileName,
            Format = parsed.Format,
            Source = resolvedSource,
            SourceDetected = string.IsNullOrWhiteSpace(source) && !string.IsNullOrWhiteSpace(resolvedSource),
            KnownSources = sources,
            Items = history.Select(h => h.Item).Distinct().OrderBy(i => i).ToList(),
            Categories = history.Select(h => h.Category)
                                .Where(c => !string.IsNullOrWhiteSpace(c))
                                .Distinct().OrderBy(c => c).ToList(),
            Lines = classified.Select((line, index) => new StatementLineDto
            {
                Index = index,
                Date = line.Date,
                Description = line.Description,
                Amount = line.Amount,
                IsCredit = line.IsCredit,
                Card = line.Card,
                Kind = line.Kind.ToString(),
                Item = line.Item,
                Category = line.Category,
                MatchedBy = line.MatchedBy,
                IsDuplicate = line.IsDuplicate,
                // Everything real and new is pre-ticked; anything the user needs to look
                // at twice — a duplicate or an internal transfer — starts unticked.
                Selected = line.Kind != LineKind.Ignore && !line.IsDuplicate,
            }).ToList(),
        });
    }

    // ------------------------------------------------------------------- commit

    [HttpPost("commit")]
    public async Task<ActionResult<StatementCommitResponse>> Commit(
        [FromBody] StatementCommitRequest request,
        CancellationToken ct)
    {
        if (request.Lines is null || request.Lines.Count == 0)
            return BadRequest(new { error = "No lines were selected." });

        var source = (request.Source ?? "").Trim();
        var expenses = 0;
        var incomes = 0;

        foreach (var line in request.Lines)
        {
            var kind = ParseKind(line.Kind);
            if (kind == LineKind.Ignore) continue;

            var item = (line.Item ?? "").Trim();
            var category = (line.Category ?? "").Trim();
            if (item.Length == 0)
                return BadRequest(new { error = $"Line dated {line.Date:yyyy-MM-dd} has no item." });

            if (kind == LineKind.Income)
            {
                db.Incomes.Add(new Income
                {
                    Date = line.Date,
                    Item = item,
                    Amount = Math.Abs(line.Amount),
                    Category = category,
                    Source = source,
                });
                incomes++;
            }
            else
            {
                db.Expenses.Add(new Expense
                {
                    Date = line.Date,
                    Item = item,
                    Amount = Math.Abs(line.Amount),
                    Category = category,
                    Source = source,
                });
                expenses++;
            }
        }

        // Remember how each description was filed, including the ones marked as ignore,
        // so next month's import needs less correcting.
        var learned = await LearnAsync(request.Lines, ct);

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Statement import: {Expenses} expense(s), {Incomes} income(s), {Learned} rule(s) learned.",
            expenses, incomes, learned);

        return Ok(new StatementCommitResponse
        {
            Expenses = expenses,
            Incomes = incomes,
            AliasesLearned = learned,
        });
    }

    // ------------------------------------------------------------------- rules

    /// <summary>The rules currently driving classification, most used first.</summary>
    [HttpGet("rules")]
    public async Task<ActionResult<IEnumerable<ClassificationAlias>>> Rules(CancellationToken ct) =>
        Ok(await db.ClassificationAliases.AsNoTracking()
            .OrderByDescending(a => a.Hits).ThenBy(a => a.Pattern)
            .ToListAsync(ct));

    /// <summary>
    /// Throws away every learned rule and reloads the built-in set. Offered because a
    /// wrong correction otherwise keeps repeating itself on every future import.
    /// </summary>
    [HttpPost("rules/reset")]
    public async Task<ActionResult<StatementCommitResponse>> ResetRules(CancellationToken ct)
    {
        db.ClassificationAliases.RemoveRange(await db.ClassificationAliases.ToListAsync(ct));
        await db.SaveChangesAsync(ct);
        await AliasSeeder.SeedAsync(db, logger, ct);

        var count = await db.ClassificationAliases.CountAsync(ct);
        logger.LogInformation("Classification rules reset to the built-in set ({Count}).", count);
        return Ok(new StatementCommitResponse { AliasesLearned = count });
    }

    /// <summary>Deletes a single rule, so one bad mapping can be dropped without a full reset.</summary>
    [HttpDelete("rules/{id:int}")]
    public async Task<IActionResult> DeleteRule(int id, CancellationToken ct)
    {
        var alias = await db.ClassificationAliases.FindAsync([id], ct);
        if (alias is null) return NotFound();

        db.ClassificationAliases.Remove(alias);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>
    /// Turns reviewed lines into reusable rules. Only lines the client flags as worth
    /// learning are considered — a line the classifier already got right teaches nothing,
    /// and recording it would bury the real corrections under hundreds of one-off rules.
    /// </summary>
    private async Task<int> LearnAsync(IReadOnlyList<StatementCommitLine> lines, CancellationToken ct)
    {
        var learned = 0;
        var aliases = await db.ClassificationAliases.ToListAsync(ct);
        var byPattern = aliases.ToDictionary(a => a.Pattern, StringComparer.Ordinal);

        foreach (var line in lines)
        {
            if (!line.Learn) continue;

            var pattern = StatementClassifier.MatchKey(line.Description ?? "");
            if (pattern.Length < 4) continue;

            var kind = ParseKind(line.Kind);
            var item = (line.Item ?? "").Trim();
            var category = (line.Category ?? "").Trim();

            // A line with no item carries no lesson unless it was explicitly ignored.
            if (kind != LineKind.Ignore && item.Length == 0) continue;

            if (byPattern.TryGetValue(pattern, out var existing))
            {
                existing.Hits++;
                if (existing.Kind != kind || existing.Item != item || existing.Category != category)
                {
                    existing.Kind = kind;
                    existing.Item = item;
                    existing.Category = category;
                    learned++;
                }
                continue;
            }

            // A broader seeded rule may already cover this description (a loan number, for
            // example). Only record the narrower one when it disagrees.
            var covering = aliases.FirstOrDefault(a => a.Pattern.Length > 0 && pattern.Contains(a.Pattern));
            if (covering is not null &&
                covering.Kind == kind && covering.Item == item && covering.Category == category)
            {
                covering.Hits++;
                continue;
            }

            var alias = new ClassificationAlias
            {
                Pattern = pattern,
                Kind = kind,
                Item = item,
                Category = category,
                Hits = 1,
            };
            db.ClassificationAliases.Add(alias);
            byPattern[pattern] = alias;
            aliases.Add(alias);
            learned++;
        }

        return learned;
    }

    /// <summary>The items already in use, with the category most often paired with each.</summary>
    private async Task<List<HistoryEntry>> BuildHistoryAsync(CancellationToken ct)
    {
        var expenses = await db.Expenses.AsNoTracking()
            .Select(e => new { e.Item, e.Category }).ToListAsync(ct);
        var incomes = await db.Incomes.AsNoTracking()
            .Select(i => new { i.Item, i.Category }).ToListAsync(ct);

        static IEnumerable<HistoryEntry> Summarise<T>(IEnumerable<T> rows, LineKind kind,
            Func<T, string> item, Func<T, string> category) =>
            rows.Where(r => !string.IsNullOrWhiteSpace(item(r)))
                .GroupBy(item)
                .Select(g => new HistoryEntry(
                    g.Key,
                    g.GroupBy(category).OrderByDescending(c => c.Count()).First().Key ?? "",
                    kind,
                    g.Count()));

        return Summarise(expenses, LineKind.Expense, e => e.Item, e => e.Category)
            .Concat(Summarise(incomes, LineKind.Income, i => i.Item, i => i.Category))
            .ToList();
    }

    private async Task<List<string>> KnownSourcesAsync(CancellationToken ct)
    {
        var fromExpenses = await db.Expenses.AsNoTracking().Select(e => e.Source).Distinct().ToListAsync(ct);
        var fromIncomes = await db.Incomes.AsNoTracking().Select(i => i.Source).Distinct().ToListAsync(ct);

        return fromExpenses.Concat(fromIncomes)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s)
            .ToList();
    }

    /// <summary>
    /// Loads the movements already stored in the statement's date range so duplicates can
    /// be spotted without pulling the whole ledger into memory.
    /// </summary>
    private async Task<HashSet<string>> ExistingKeysAsync(
        IReadOnlyList<StatementLine> lines, string source, CancellationToken ct)
    {
        var from = lines.Min(l => l.Date);
        var to = lines.Max(l => l.Date);

        var expenses = await db.Expenses.AsNoTracking()
            .Where(e => e.Date >= from && e.Date <= to)
            .Select(e => new { e.Date, e.Amount, e.Source })
            .ToListAsync(ct);

        var incomes = await db.Incomes.AsNoTracking()
            .Where(i => i.Date >= from && i.Date <= to)
            .Select(i => new { i.Date, i.Amount, i.Source })
            .ToListAsync(ct);

        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in expenses) keys.Add(DuplicateKey(e.Date, e.Amount, false, e.Source));
        foreach (var i in incomes) keys.Add(DuplicateKey(i.Date, i.Amount, true, i.Source));

        return keys;
    }

    private static string DuplicateKey(DateOnly date, decimal amount, bool isCredit, string source) =>
        $"{date:yyyy-MM-dd}|{Math.Abs(amount):0.00}|{(isCredit ? "C" : "D")}|{TextNormalizer.Key(source)}";

    private static LineKind ParseKind(string? value) =>
        Enum.TryParse<LineKind>(value, ignoreCase: true, out var kind) ? kind : LineKind.Expense;
}

// ---------------------------------------------------------------------- contracts

public class StatementPreviewResponse
{
    public string FileName { get; set; } = "";
    public string Format { get; set; } = "";
    public string Source { get; set; } = "";
    /// <summary>True when the source came from the file name rather than the user.</summary>
    public bool SourceDetected { get; set; }
    public List<string> KnownSources { get; set; } = [];
    public List<string> Items { get; set; } = [];
    public List<string> Categories { get; set; } = [];
    public List<StatementLineDto> Lines { get; set; } = [];
}

public class StatementLineDto
{
    public int Index { get; set; }
    public DateOnly Date { get; set; }
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
    public bool IsCredit { get; set; }
    public string? Card { get; set; }
    public string Kind { get; set; } = "";
    public string Item { get; set; } = "";
    public string Category { get; set; } = "";
    public string MatchedBy { get; set; } = "";
    public bool IsDuplicate { get; set; }
    public bool Selected { get; set; }
}

public class StatementCommitRequest
{
    public string? Source { get; set; }
    public List<StatementCommitLine> Lines { get; set; } = [];
}

public class StatementCommitLine
{
    public DateOnly Date { get; set; }
    public string? Description { get; set; }
    public decimal Amount { get; set; }
    public string? Kind { get; set; }
    public string? Item { get; set; }
    public string? Category { get; set; }
    /// <summary>Set by the review screen when the user corrected the guess or none was offered.</summary>
    public bool Learn { get; set; }
}

public class StatementCommitResponse
{
    public int Expenses { get; set; }
    public int Incomes { get; set; }
    public int AliasesLearned { get; set; }
}
