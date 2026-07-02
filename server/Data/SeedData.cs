using System.Text.Json;
using FinanceManager.Api.Models;

namespace FinanceManager.Api.Data;

/// <summary>
/// Loads finance_seed.json into an empty database on first run.
/// The JSON shape matches what the /api/export/json endpoint produces,
/// so a backup can be dropped straight back in.
/// </summary>
public static class SeedData
{
    private static readonly JsonSerializerOptions Opts = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static void Initialize(AppDbContext db, string contentRoot)
    {
        // Only seed when there is nothing to preserve.
        if (db.Expenses.Any() || db.Incomes.Any() || db.NetWorthEntries.Any() ||
            db.Debts.Any() || db.FixedCosts.Any() || db.Investments.Any() || db.Accounts.Any())
            return;

        var path = Path.Combine(contentRoot, "finance_seed.json");
        if (!File.Exists(path)) return;

        SeedModel? seed;
        try
        {
            seed = JsonSerializer.Deserialize<SeedModel>(File.ReadAllText(path), Opts);
        }
        catch
        {
            return; // A malformed seed should never crash startup.
        }
        if (seed is null) return;

        if (seed.Expenses is { Count: > 0 }) db.Expenses.AddRange(seed.Expenses);
        if (seed.Income is { Count: > 0 }) db.Incomes.AddRange(seed.Income);
        if (seed.FixedCosts is { Count: > 0 }) db.FixedCosts.AddRange(seed.FixedCosts);
        if (seed.Debts is { Count: > 0 }) db.Debts.AddRange(seed.Debts);
        if (seed.NetWorth is { Count: > 0 }) db.NetWorthEntries.AddRange(seed.NetWorth);
        if (seed.Investments is { Count: > 0 }) db.Investments.AddRange(seed.Investments);
        if (seed.Accounts is { Count: > 0 }) db.Accounts.AddRange(seed.Accounts);

        db.SaveChanges();
    }

    private sealed class SeedModel
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
