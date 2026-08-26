namespace FinanceManager.Api.Dtos;

/// <summary>A single (name, value) breakdown row, e.g. spend per category.</summary>
public record NamedValueDto(string Name, decimal Value);

/// <summary>A single point on a date-indexed trend line (net worth, debt, ...).</summary>
public record DatePointDto(string Date, decimal Value);

/// <summary>One month of income vs expenses.</summary>
public record MonthPointDto(string Month, decimal Income, decimal Expenses, decimal Net);

/// <summary>All KPIs, series and breakdowns for the dashboard in one call.</summary>
public record DashboardDto(
    decimal TotalIncome,
    decimal TotalExpenses,
    decimal Net,
    decimal SavingsRatePct,
    decimal FixedMonthly,
    decimal LatestNetWorth,
    decimal TotalDebt,
    List<int> AvailableYears,
    List<MonthPointDto> Months,
    List<NamedValueDto> ExpenseByCategory,
    List<NamedValueDto> IncomeByCategory,
    List<NamedValueDto> ExpenseBySource,
    List<DatePointDto> NetWorthTrend,
    List<DatePointDto> DebtTrend);

/// <summary>Result of an import/reset operation: a message plus rows affected per table.</summary>
public record ImportResultDto(string Message, Dictionary<string, int> Inserted);

/// <summary>
/// Returned with 409 Conflict when a destructive import would wipe rows that already
/// exist. <see cref="Existing"/> maps each affected table to the number of rows that
/// would be deleted, so the caller can show the user exactly what is at stake before
/// retrying with confirm=true.
/// </summary>
public record OverwriteGuardDto(string Message, bool RequiresConfirmation, Dictionary<string, int> Existing);
