using System.Globalization;
using System.Text;
using FinanceManager.Api.Models;

namespace FinanceManager.Api.Services;

/// <summary>
/// Recreates the two formulas the original "Dívidas" spreadsheet carried, so the
/// values are derived in exactly one place instead of being retyped by hand:
///
///   Prazo (TermMonths) = whole months from the month of <see cref="Debt.Date"/>
///                        up to and including the month the loan matures.
///                        Null for items with no maturity (credit cards).
///   Juros (Interest)   = Prestação × Prazo − Total em dívida.
///
/// Maturity dates are business data that changes when a loan is taken out or paid
/// off, so they live in configuration ("DebtMaturities") rather than in code.
/// </summary>
public sealed class DebtCalculator
{
    private readonly Dictionary<string, DateOnly> _maturities = new(StringComparer.Ordinal);

    public DebtCalculator(IConfiguration config)
    {
        foreach (var entry in config.GetSection("DebtMaturities").GetChildren())
        {
            if (DateOnly.TryParse(entry.Value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var maturity))
                _maturities[Key(entry.Key)] = maturity;
        }
    }

    /// <summary>Overwrites the calculated columns on <paramref name="debt"/>.</summary>
    /// <returns>True when a value actually changed.</returns>
    public bool Apply(Debt debt)
    {
        var term = TermMonths(debt.Item, debt.Date);
        var interest = term is > 0
            ? decimal.Round(debt.Installment * term.Value - debt.Outstanding, 2)
            : 0m;

        if (debt.TermMonths == term && debt.Interest == interest) return false;

        debt.TermMonths = term;
        debt.Interest = interest;
        return true;
    }

    /// <summary>Prazo, or null when the item has no configured maturity.</summary>
    public int? TermMonths(string item, DateOnly date)
    {
        if (!_maturities.TryGetValue(Key(item), out var maturity)) return null;

        // Inclusive: the month of `date` still owes an instalment, which is what
        // the spreadsheet counted. Verified against the imported history — e.g.
        // 2026-07 against a 2060-02 maturity gives 404, not 403.
        var months = (maturity.Year - date.Year) * 12 + (maturity.Month - date.Month) + 1;
        return months > 0 ? months : 0;
    }

    /// <summary>
    /// Match on a folded key so a stray accent or a change of casing in the
    /// spreadsheet does not silently drop a loan back to "no maturity".
    /// </summary>
    private static string Key(string s)
    {
        var decomposed = s.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                sb.Append(ch);
        }
        return sb.ToString().Replace(" ", "").Normalize(NormalizationForm.FormC);
    }
}
