using FinanceManager.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace FinanceManager.Api.Data;

public class AppDbContext : DbContext
{
    public const int LookupNameLength = 100;

    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Expense> Expenses => Set<Expense>();
    public DbSet<Income> Incomes => Set<Income>();
    public DbSet<FixedCost> FixedCosts => Set<FixedCost>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Source> Sources => Set<Source>();
    public DbSet<Debt> Debts => Set<Debt>();
    public DbSet<NetWorthEntry> NetWorthEntries => Set<NetWorthEntry>();
    public DbSet<Investment> Investments => Set<Investment>();
    public DbSet<BankAccount> Accounts => Set<BankAccount>();
    public DbSet<ClassificationAlias> ClassificationAliases => Set<ClassificationAlias>();
    public DbSet<ChatConversation> ChatConversations => Set<ChatConversation>();
    public DbSet<ChatMessageEntry> ChatMessages => Set<ChatMessageEntry>();

    // Category and Source names arrive as text; turn them into references before writing.
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        LookupResolver.ResolveAsync(this, async: false, CancellationToken.None).GetAwaiter().GetResult();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        await LookupResolver.ResolveAsync(this, async: true, cancellationToken);
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Keep the lookups and their references in sync with SchemaGuard.EnsureLookupsAsync,
        // which migrates databases created before they existed.
        modelBuilder.Entity<Category>(e =>
        {
            e.ToTable("Categories");
            e.Property(x => x.Name).HasMaxLength(LookupNameLength).IsRequired();
            e.HasIndex(x => x.Name).IsUnique();
        });
        modelBuilder.Entity<Source>(e =>
        {
            e.ToTable("Sources");
            e.Property(x => x.Name).HasMaxLength(LookupNameLength).IsRequired();
            e.HasIndex(x => x.Name).IsUnique();
        });

        modelBuilder.Entity<Expense>(e => { HasCategory(e); HasSource(e); });
        modelBuilder.Entity<Income>(e => { HasCategory(e); HasSource(e); });

        modelBuilder.Entity<ClassificationAlias>(e =>
        {
            e.Property(x => x.Pattern).HasMaxLength(200).IsRequired();
            e.Property(x => x.Item).HasMaxLength(200);
            // Plain text on purpose: a rule names the category it files lines under, and
            // renaming or merging categories rewrites it (see LookupsController).
            e.Property(x => x.Category).HasMaxLength(200);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => x.Pattern).IsUnique();
        });

        modelBuilder.Entity<FixedCost>(e =>
        {
            HasCategory(e);
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

        // Keep in sync with the DDL in SchemaGuard, which creates these on existing databases.
        modelBuilder.Entity<ChatConversation>(e =>
        {
            e.Property(x => x.Owner).HasMaxLength(200);
            e.Property(x => x.Title).HasMaxLength(200);
            e.HasIndex(x => new { x.Owner, x.UpdatedAt });
            e.HasMany(x => x.Messages).WithOne().HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<ChatMessageEntry>(e =>
        {
            e.ToTable("ChatMessages");
            e.Property(x => x.Role).HasMaxLength(20);
        });
    }

    // A category or source in use cannot be deleted — merge it into another one first.
    // AutoInclude loads the name with every query, so rows always serialise with it.
    private static void HasCategory<T>(EntityTypeBuilder<T> e) where T : CategorizedEntity
    {
        e.HasOne(x => x.CategoryRef).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
        e.Navigation(x => x.CategoryRef).AutoInclude();
    }

    private static void HasSource<T>(EntityTypeBuilder<T> e) where T : LedgerEntry
    {
        e.HasOne(x => x.SourceRef).WithMany().HasForeignKey(x => x.SourceId).OnDelete(DeleteBehavior.Restrict);
        e.Navigation(x => x.SourceRef).AutoInclude();
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Keep currency values exact on providers that care (e.g. Azure SQL).
        configurationBuilder.Properties<decimal>().HavePrecision(18, 2);
    }
}
