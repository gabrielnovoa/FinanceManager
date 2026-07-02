using FinanceManager.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

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
    SeedData.Initialize(db, app.Environment.ContentRootPath);
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
