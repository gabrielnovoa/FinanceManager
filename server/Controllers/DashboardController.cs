using FinanceManager.Api.Data;
using FinanceManager.Api.Dtos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DashboardController(AppDbContext db) : ControllerBase
{
    /// <summary>All KPIs, series and breakdowns for the dashboard in one call.</summary>
    /// <param name="year">Optional filter. Omit for all-time.</param>
    [HttpGet("summary")]
    public async Task<ActionResult<DashboardDto>> Summary([FromQuery] int? year)
    {
        // Personal-scale data: load once and aggregate in memory for provider-agnostic correctness.
        var expenses = await db.Expenses.ToListAsync();
        var income = await db.Incomes.ToListAsync();
        var debts = await db.Debts.ToListAsync();
        var netWorth = await db.NetWorthEntries.ToListAsync();
        var fixedMonthly = db.FixedCosts.Any() ? await db.FixedCosts.SumAsync(f => f.MonthlyAmount) : 0m;

        var availableYears = expenses.Select(e => e.Date.Year)
            .Concat(income.Select(i => i.Date.Year))
            .Concat(netWorth.Select(n => n.Date.Year))
            .Concat(debts.Select(d => d.Date.Year))
            .Distinct().OrderByDescending(y => y).ToList();

        bool InYear(int y) => !year.HasValue || y == year.Value;

        var exp = expenses.Where(e => InYear(e.Date.Year)).ToList();
        var inc = income.Where(i => InYear(i.Date.Year)).ToList();
        var nw = netWorth.Where(n => InYear(n.Date.Year)).ToList();
        var dbt = debts.Where(d => InYear(d.Date.Year)).ToList();

        var totalExpenses = exp.Sum(e => e.Amount);
        var totalIncome = inc.Sum(i => i.Amount);
        var net = totalIncome - totalExpenses;
        var savingsRate = totalIncome > 0 ? Math.Round(net / totalIncome * 100m, 1) : 0m;

        // Monthly income vs expenses.
        var months = exp.Select(e => new { Key = MonthKey(e.Date), Exp = e.Amount, Inc = 0m })
            .Concat(inc.Select(i => new { Key = MonthKey(i.Date), Exp = 0m, Inc = i.Amount }))
            .GroupBy(x => x.Key)
            .Select(g => new MonthPointDto(g.Key, g.Sum(x => x.Inc), g.Sum(x => x.Exp), g.Sum(x => x.Inc) - g.Sum(x => x.Exp)))
            .OrderBy(m => m.Month)
            .ToList();

        // Net worth: sum every line item per snapshot date.
        var netWorthTrend = nw.GroupBy(n => n.Date)
            .Select(g => new DatePointDto(g.Key.ToString("yyyy-MM-dd"), g.Sum(n => n.Value)))
            .OrderBy(p => p.Date).ToList();

        // Debt: total outstanding per snapshot date.
        var debtTrend = dbt.GroupBy(d => d.Date)
            .Select(g => new DatePointDto(g.Key.ToString("yyyy-MM-dd"), g.Sum(d => d.Outstanding)))
            .OrderBy(p => p.Date).ToList();

        var dto = new DashboardDto(
            TotalIncome: totalIncome,
            TotalExpenses: totalExpenses,
            Net: net,
            SavingsRatePct: savingsRate,
            FixedMonthly: fixedMonthly,
            LatestNetWorth: netWorthTrend.LastOrDefault()?.Value ?? 0m,
            TotalDebt: debtTrend.LastOrDefault()?.Value ?? 0m,
            AvailableYears: availableYears,
            Months: months,
            ExpenseByCategory: TopBreakdown(exp.Select(e => (e.Category, e.Amount))),
            IncomeByCategory: TopBreakdown(inc.Select(i => (i.Category, i.Amount))),
            ExpenseBySource: TopBreakdown(exp.Select(e => (e.Source, e.Amount))),
            NetWorthTrend: netWorthTrend,
            DebtTrend: debtTrend);

        return dto;
    }

    private static string MonthKey(DateOnly d) => $"{d.Year:0000}-{d.Month:00}";

    private static List<NamedValueDto> TopBreakdown(IEnumerable<(string Name, decimal Amount)> rows) =>
        rows.GroupBy(r => string.IsNullOrWhiteSpace(r.Name) ? "Sem categoria" : r.Name)
            .Select(g => new NamedValueDto(g.Key, Math.Round(g.Sum(r => r.Amount), 2)))
            .OrderByDescending(n => n.Value)
            .ToList();
}
