using FinanceManager.Api.Models;

namespace FinanceManager.Api.Services;

/// <summary>
/// Keeps a fixed cost's two amounts consistent. Only one of them is ever typed in —
/// the one matching how the cost is charged — and the other is derived, exactly like
/// the white (entered) and grey (formula) cells of the original spreadsheet.
/// </summary>
public static class FixedCostCalculator
{
    public static void Apply(FixedCost cost)
    {
        if (cost.Frequency == CostFrequency.Annual)
        {
            cost.DueMonths = (cost.DueMonths ?? []).Where(m => m is >= 1 and <= 12).Distinct().Order().ToArray();
            cost.MonthlyAmount = Round(cost.AnnualAmount / 12m);
        }
        else
        {
            cost.DueMonths = [];
            cost.AnnualAmount = Round(cost.MonthlyAmount * 12m);
        }
    }

    /// <summary>
    /// Best guess for rows written before the frequency existed: a cost whose annual
    /// figure is not exactly twelve monthly ones was typed in as a yearly amount
    /// (e.g. IMI 770,00 vs 64,17 × 12 = 770,04).
    /// </summary>
    public static CostFrequency Infer(decimal monthly, decimal annual) =>
        annual > 0 && Round(monthly * 12m) != Round(annual) ? CostFrequency.Annual : CostFrequency.Monthly;

    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Prepares rows loaded from a backup or seed file. Files from before the
    /// monthly/annual split carry no frequency, so every row reads as monthly; a row
    /// whose annual figure is not twelve monthly ones can only be a yearly charge.
    /// </summary>
    public static void Normalize(IEnumerable<FixedCost> costs)
    {
        foreach (var c in costs)
        {
            if (c.Frequency == CostFrequency.Monthly) c.Frequency = Infer(c.MonthlyAmount, c.AnnualAmount);
            Apply(c);
        }
    }
}
