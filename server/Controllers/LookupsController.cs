using FinanceManager.Api.Data;
using FinanceManager.Api.Models;
using FinanceManager.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

/// <summary>
/// The category and source lists: what each is used by, renaming, merging duplicates
/// into one, and deleting entries nothing refers to any more.
/// </summary>
[ApiController]
[Route("api/lookups")]
public class LookupsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<LookupsDto> Get(CancellationToken ct)
    {
        var expenseCats = await CountBy(db.Expenses.Select(e => e.CategoryId), ct);
        var incomeCats = await CountBy(db.Incomes.Select(e => e.CategoryId), ct);
        var fixedCats = await CountBy(db.FixedCosts.Select(e => e.CategoryId), ct);
        var expenseSrc = await CountBy(db.Expenses.Select(e => e.SourceId), ct);
        var incomeSrc = await CountBy(db.Incomes.Select(e => e.SourceId), ct);

        var categories = await db.Categories.AsNoTracking().OrderBy(c => c.Name).ToListAsync(ct);
        var sources = await db.Sources.AsNoTracking().OrderBy(s => s.Name).ToListAsync(ct);

        var categoryDtos = categories.Select(c => new LookupDto(c.Id, c.Name,
            expenseCats.GetValueOrDefault(c.Id), incomeCats.GetValueOrDefault(c.Id), fixedCats.GetValueOrDefault(c.Id))).ToList();
        var sourceDtos = sources.Select(s => new LookupDto(s.Id, s.Name,
            expenseSrc.GetValueOrDefault(s.Id), incomeSrc.GetValueOrDefault(s.Id), 0)).ToList();

        return new LookupsDto(categoryDtos, sourceDtos, Typos("categories", categoryDtos).Concat(Typos("sources", sourceDtos)).ToList());
    }

    /// <summary>Names that look like misspellings of each other. Suggestions only — merging is the user's call.</summary>
    private static IEnumerable<TypoDto> Typos(string kind, List<LookupDto> items) =>
        TypoDetector.Find(items.Select(i => new TypoDetector.Candidate(i.Id, i.Name, i.Expenses + i.Incomes + i.FixedCosts)).ToList())
            .Select(p => new TypoDto(kind, p.From.Id, p.From.Name, p.From.Uses, p.Into.Id, p.Into.Name, p.Into.Uses, p.Reason));

    // ---- categories ----

    [HttpPut("categories/{id:int}")]
    public async Task<IActionResult> RenameCategory(int id, [FromBody] RenameDto body, CancellationToken ct)
    {
        var category = await db.Categories.FindAsync([id], ct);
        if (category is null) return NotFound();
        var name = LookupResolver.Normalize(body.Name);
        if (name.Length == 0) return BadRequest(new { message = "The name is empty." });
        if (await Clash(db.Categories, id, name, ct) is { } other) return Conflict(Taken(other.Id));

        var old = category.Name;
        category.Name = name;
        RenameInRules(old, name, await db.ClassificationAliases.ToListAsync(ct));
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Points everything using this category at <c>targetId</c>, then deletes it.</summary>
    [HttpPost("categories/{id:int}/merge")]
    public async Task<IActionResult> MergeCategory(int id, [FromBody] MergeDto body, CancellationToken ct)
    {
        if (id == body.TargetId) return BadRequest(new { message = "Cannot merge a category into itself." });
        var from = await db.Categories.FindAsync([id], ct);
        var into = await db.Categories.FindAsync([body.TargetId], ct);
        if (from is null || into is null) return NotFound();

        // The SQL Server retry policy only allows a transaction inside its execution strategy.
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.Expenses.Where(e => e.CategoryId == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.CategoryId, into.Id), ct);
            await db.Incomes.Where(e => e.CategoryId == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.CategoryId, into.Id), ct);
            await db.FixedCosts.Where(e => e.CategoryId == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.CategoryId, into.Id), ct);
            RenameInRules(from.Name, into.Name, await db.ClassificationAliases.ToListAsync(ct));
            db.Categories.Remove(from);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        });
        return NoContent();
    }

    [HttpDelete("categories/{id:int}")]
    public async Task<IActionResult> DeleteCategory(int id, CancellationToken ct)
    {
        var category = await db.Categories.FindAsync([id], ct);
        if (category is null) return NotFound();
        if (await db.Expenses.AnyAsync(e => e.CategoryId == id, ct)
            || await db.Incomes.AnyAsync(e => e.CategoryId == id, ct)
            || await db.FixedCosts.AnyAsync(e => e.CategoryId == id, ct))
            return Conflict(new { message = "This category is still in use. Merge it into another one instead." });

        db.Categories.Remove(category);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ---- sources ----

    [HttpPut("sources/{id:int}")]
    public async Task<IActionResult> RenameSource(int id, [FromBody] RenameDto body, CancellationToken ct)
    {
        var source = await db.Sources.FindAsync([id], ct);
        if (source is null) return NotFound();
        var name = LookupResolver.Normalize(body.Name);
        if (name.Length == 0) return BadRequest(new { message = "The name is empty." });
        if (await Clash(db.Sources, id, name, ct) is { } other) return Conflict(Taken(other.Id));

        source.Name = name;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("sources/{id:int}/merge")]
    public async Task<IActionResult> MergeSource(int id, [FromBody] MergeDto body, CancellationToken ct)
    {
        if (id == body.TargetId) return BadRequest(new { message = "Cannot merge a source into itself." });
        var from = await db.Sources.FindAsync([id], ct);
        var into = await db.Sources.FindAsync([body.TargetId], ct);
        if (from is null || into is null) return NotFound();

        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.Expenses.Where(e => e.SourceId == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.SourceId, into.Id), ct);
            await db.Incomes.Where(e => e.SourceId == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.SourceId, into.Id), ct);
            db.Sources.Remove(from);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        });
        return NoContent();
    }

    [HttpDelete("sources/{id:int}")]
    public async Task<IActionResult> DeleteSource(int id, CancellationToken ct)
    {
        var source = await db.Sources.FindAsync([id], ct);
        if (source is null) return NotFound();
        if (await db.Expenses.AnyAsync(e => e.SourceId == id, ct) || await db.Incomes.AnyAsync(e => e.SourceId == id, ct))
            return Conflict(new { message = "This source is still in use. Merge it into another one instead." });

        db.Sources.Remove(source);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // ---- helpers ----

    private static async Task<Dictionary<int, int>> CountBy(IQueryable<int?> ids, CancellationToken ct) =>
        await ids.Where(id => id != null)
            .GroupBy(id => id!.Value)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);

    /// <summary>Another entry already using this name, compared the way the resolver matches names.</summary>
    private static async Task<T?> Clash<T>(DbSet<T> set, int id, string name, CancellationToken ct) where T : BaseEntity
    {
        var all = await set.AsNoTracking().Where(x => x.Id != id).ToListAsync(ct);
        return all.FirstOrDefault(x => string.Equals(x switch { Category c => c.Name, Source s => s.Name, _ => "" },
            name, StringComparison.OrdinalIgnoreCase));
    }

    private static object Taken(int existingId) =>
        new { message = "Another entry already has this name. Merge into it instead.", existingId };

    /// <summary>
    /// Classification rules name their category as text. Keep them pointing at the same
    /// category, or the next statement import would recreate the old name.
    /// </summary>
    private static void RenameInRules(string oldName, string newName, List<ClassificationAlias> rules)
    {
        foreach (var rule in rules.Where(r => string.Equals(LookupResolver.Normalize(r.Category), oldName, StringComparison.OrdinalIgnoreCase)))
            rule.Category = newName;
    }
}

public record LookupDto(int Id, string Name, int Expenses, int Incomes, int FixedCosts);
public record TypoDto(string Kind, int FromId, string FromName, int FromUses, int IntoId, string IntoName, int IntoUses, string Reason);
public record LookupsDto(List<LookupDto> Categories, List<LookupDto> Sources, List<TypoDto> Typos);
public record RenameDto(string? Name);
public record MergeDto(int TargetId);
