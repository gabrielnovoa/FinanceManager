using FinanceManager.Api.Data;
using FinanceManager.Api.Services;
using FinanceManager.Api.Services.Ai;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSingleton<DebtCalculator>();
builder.Services.AddSingleton<StatementParser>();
builder.Services.AddSingleton<StatementClassifier>();

// AI assistant: off until AI:Endpoint and AI:Deployment are configured.
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection(AiOptions.Section));
builder.Services.AddSingleton<FinanceAssistant>();

// --- Database: SQLite locally (zero-config), Azure SQL in the cloud (flip DatabaseProvider) ---
var provider = builder.Configuration.GetValue<string>("DatabaseProvider") ?? "Sqlite";
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase))
    {
        // Azure SQL drops connections now and then (failovers, reconfiguration); retry
        // those instead of failing the request. Any explicit transaction must therefore
        // run inside db.Database.CreateExecutionStrategy() — see ChatController.Delete.
        options.UseSqlServer(
            connectionString
                ?? throw new InvalidOperationException("DatabaseProvider is SqlServer but ConnectionStrings:DefaultConnection is not set."),
            sql => sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10), errorNumbersToAdd: null));
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

// Create the database if needed, upgrade its schema and load seed data on first run.
await DatabaseInitializer.RunAsync(app.Services, app.Environment.ContentRootPath, app.Logger);

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
