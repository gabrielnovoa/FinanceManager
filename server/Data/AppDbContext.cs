using FinanceManager.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Expense> Expenses => Set<Expense>();
    public DbSet<Income> Incomes => Set<Income>();
    public DbSet<FixedCost> FixedCosts => Set<FixedCost>();
    public DbSet<Debt> Debts => Set<Debt>();
    public DbSet<NetWorthEntry> NetWorthEntries => Set<NetWorthEntry>();
    public DbSet<Investment> Investments => Set<Investment>();
    public DbSet<BankAccount> Accounts => Set<BankAccount>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Keep currency values exact on providers that care (e.g. Azure SQL).
        configurationBuilder.Properties<decimal>().HavePrecision(18, 2);
    }
}
