using FinanceManager.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

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
    public DbSet<ClassificationAlias> ClassificationAliases => Set<ClassificationAlias>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ClassificationAlias>(e =>
        {
            e.Property(x => x.Pattern).HasMaxLength(200).IsRequired();
            e.Property(x => x.Item).HasMaxLength(200);
            e.Property(x => x.Category).HasMaxLength(200);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.Pattern).IsUnique();
        });

        modelBuilder.Entity<FixedCost>(e =>
        {
            e.Property(x => x.Frequency).HasConversion<string>().HasMaxLength(20);
            // Stored as "5,8,11" so it stays a plain column on both SQLite and SQL Server.
            e.Property(x => x.DueMonths)
                .HasConversion(
                    v => string.Join(',', v),
                    v => v.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                          .Select(int.Parse).ToArray(),
                    new ValueComparer<int[]>(
                        (a, b) => a!.SequenceEqual(b!),
                        v => v.Aggregate(0, (h, x) => HashCode.Combine(h, x)),
                        v => v.ToArray()))
                .HasMaxLength(40);
        });
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Keep currency values exact on providers that care (e.g. Azure SQL).
        configurationBuilder.Properties<decimal>().HavePrecision(18, 2);
    }
}
