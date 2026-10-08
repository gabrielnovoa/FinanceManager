using FinanceManager.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Data;

/// <summary>
/// Turns the category and source names on rows about to be saved into references to
/// the <see cref="Category"/> and <see cref="Source"/> tables. Names match existing
/// entries ignoring case and extra spaces, so "casa " lands on "Casa"; a name that is
/// genuinely new creates its entry.
/// </summary>
public static class LookupResolver
{
    /// <summary>Trims and collapses inner whitespace; capped to the column length.</summary>
    public static string Normalize(string? name)
    {
        var clean = string.Join(' ', (name ?? "").Split((char[])[' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries));
        return clean.Length <= AppDbContext.LookupNameLength ? clean : clean[..AppDbContext.LookupNameLength].TrimEnd();
    }

    public static async Task ResolveAsync(AppDbContext db, bool async, CancellationToken ct)
    {
        var rows = db.ChangeTracker.Entries<CategorizedEntity>()
            .Where(e => e.State is EntityState.Added or EntityState.Modified)
            .ToList();
        if (rows.Count == 0) return;

        if (rows.Any(r => r.Entity.PendingCategory is not null))
        {
            var categories = await LoadAsync(db.Categories, async, ct);
            foreach (var row in rows)
            {
                if (row.Entity.PendingCategory is { } name)
                    row.Entity.SetCategory(Find(db.Categories, categories, name, n => new Category { Name = n }));
                else if (row.State == EntityState.Modified)
                    // A replaced row (CRUD update) that did not mention its category keeps it.
                    row.Property(x => x.CategoryId).IsModified = false;
            }
        }
        else
        {
            foreach (var row in rows.Where(r => r.State == EntityState.Modified))
                row.Property(x => x.CategoryId).IsModified = false;
        }

        var ledger = rows.Select(r => r.Entity).OfType<LedgerEntry>().ToList();
        if (ledger.Count == 0) return;

        var sources = ledger.Any(l => l.PendingSource is not null) ? await LoadAsync(db.Sources, async, ct) : null;
        foreach (var entry in ledger)
        {
            if (sources is not null && entry.PendingSource is { } name)
                entry.SetSource(Find(db.Sources, sources, name, n => new Source { Name = n }));
            else if (db.Entry(entry).State == EntityState.Modified)
                db.Entry(entry).Property(x => x.SourceId).IsModified = false;
        }
    }

    private static async Task<Dictionary<string, T>> LoadAsync<T>(DbSet<T> set, bool async, CancellationToken ct)
        where T : BaseEntity
    {
        // Loads (and tracks) the whole table: it is a few dozen names. Entries added
        // earlier in this unit of work are in Local, so the dictionary covers both.
        if (async) await set.LoadAsync(ct);
        else set.Load();
        var byName = new Dictionary<string, T>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in set.Local) byName.TryAdd(NameOf(item), item);
        return byName;
    }

    private static T? Find<T>(DbSet<T> set, Dictionary<string, T> byName, string raw, Func<string, T> create)
        where T : BaseEntity
    {
        var name = Normalize(raw);
        if (name.Length == 0) return null;
        if (byName.TryGetValue(name, out var existing)) return existing;

        var created = create(name);
        set.Add(created);
        byName[name] = created;
        return created;
    }

    private static string NameOf(BaseEntity e) => e switch
    {
        Category c => c.Name,
        Source s => s.Name,
        _ => throw new ArgumentException($"Not a lookup: {e.GetType().Name}"),
    };
}
