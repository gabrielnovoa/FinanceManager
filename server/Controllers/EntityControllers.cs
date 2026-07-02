using FinanceManager.Api.Data;
using FinanceManager.Api.Models;

namespace FinanceManager.Api.Controllers;

// Thin controllers over the generic CRUD base. Routes come from the class name:
//   Expenses -> /api/expenses, Income -> /api/income, FixedCosts -> /api/fixedcosts, etc.

public class ExpensesController(AppDbContext db) : CrudControllerBase<Expense>(db)
{
    protected override IQueryable<Expense> Query() => Set.OrderByDescending(e => e.Date).ThenByDescending(e => e.Id);
}

public class IncomeController(AppDbContext db) : CrudControllerBase<Income>(db)
{
    protected override IQueryable<Income> Query() => Set.OrderByDescending(e => e.Date).ThenByDescending(e => e.Id);
}

public class FixedCostsController(AppDbContext db) : CrudControllerBase<FixedCost>(db)
{
    protected override IQueryable<FixedCost> Query() => Set.OrderBy(e => e.Category).ThenBy(e => e.Item);
}

public class DebtsController(AppDbContext db) : CrudControllerBase<Debt>(db)
{
    protected override IQueryable<Debt> Query() => Set.OrderByDescending(e => e.Date).ThenBy(e => e.Item);
}

public class NetWorthController(AppDbContext db) : CrudControllerBase<NetWorthEntry>(db)
{
    protected override IQueryable<NetWorthEntry> Query() => Set.OrderByDescending(e => e.Date).ThenBy(e => e.AssetClass);
}

public class InvestmentsController(AppDbContext db) : CrudControllerBase<Investment>(db)
{
    protected override IQueryable<Investment> Query() => Set.OrderByDescending(e => e.Date).ThenByDescending(e => e.Id);
}

public class AccountsController(AppDbContext db) : CrudControllerBase<BankAccount>(db)
{
    protected override IQueryable<BankAccount> Query() => Set.OrderBy(e => e.Name);
}
