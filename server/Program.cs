using FinanceManager.Api.Data;
using FinanceManager.Api.Models;
using FinanceManager.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSingleton<DebtCalculator>();
builder.Services.AddSingleton<StatementParser>();
builder.Services.AddSingleton<StatementClassifier>();

// --- Database: SQLite locally (zero-config), Azure SQL in the cloud (flip DatabaseProvider) ---
var provider = builder.Configuration.GetValue<string>("DatabaseProvider") ?? "Sqlite";
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase))
    {
        options.UseSqlServer(connectionString
            ?? throw new InvalidOperationException("DatabaseProvider is SqlServer but ConnectionStrings:DefaultConnection is not set."));
    }
    else
    {
        options.UseSqlite(connectionString ?? "Data Source=finance.db");
    }
});

// Allow the Vite dev server to call the API during local development.
const string DevCors = "dev-cors";
builder.Services.AddCors(options => options.AddPolicy(DevCors, policy =>
    policy.WithOrigins("http://localhost:5173", "http://localhost:4173")
          .AllowAnyHeader()
          .AllowAnyMethod()));

var app = builder.Build();

// Create the database if needed and load seed data on first run.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();

    // EnsureCreated only builds the schema on a brand-new database, so tables added
    // later need to be created explicitly for databases that already exist.
    await SchemaGuard.EnsureAsync(db, app.Logger);

    SeedData.Initialize(db, app.Environment.ContentRootPath);

    // Starting rules for statement classification, added only on an empty table.
    await AliasSeeder.SeedAsync(db, app.Logger);

    // Bring the calculated debt columns in line with the formulas. Rows that
    // already agree are left untouched, so this is safe to run on every start
    // and self-heals rows written before the formulas existed.
    var calculator = scope.ServiceProvider.GetRequiredService<DebtCalculator>();
    var debts = await db.Set<Debt>().ToListAsync();
    var changed = debts.Count(calculator.Apply);
    if (changed > 0)
    {
        await db.SaveChangesAsync();
        app.Logger.LogInformation("Recalculated Prazo/Juros on {Count} debt row(s).", changed);
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors(DevCors);
}

// Serve the built React SPA (client/dist copied into wwwroot for production).
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();

// Any non-API route falls back to the SPA so client-side routing works.
app.MapFallbackToFile("index.html");

app.Run();
