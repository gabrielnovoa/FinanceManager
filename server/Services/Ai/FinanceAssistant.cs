using System.ClientModel;
using System.ClientModel.Primitives;
using System.ComponentModel;
using System.Globalization;
using System.Text;
using Azure.Identity;
using FinanceManager.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI.Responses;
using AiChatMessage = Microsoft.Extensions.AI.ChatMessage;
using AiChatRole = Microsoft.Extensions.AI.ChatRole;

namespace FinanceManager.Api.Services.Ai;

/// <summary>
/// Answers free-form questions about the user's finances. The model gets a description
/// of the schema plus two tools — a read-only SQL query against the app's database and,
/// optionally, Azure OpenAI's built-in web search — and decides itself which to use; the
/// function-invocation loop feeds the results back until it has an answer.
/// </summary>
public sealed class FinanceAssistant
{
    private const int MaxHistory = 20;
    private const int MaxMessageLength = 8000;

    private readonly IChatClient? _client;
    private readonly ILogger<FinanceAssistant> _logger;

    public FinanceAssistant(IOptions<AiOptions> options, ILogger<FinanceAssistant> logger)
    {
        _logger = logger;
        var o = options.Value;
        Model = o.Deployment;
        WebSearch = o.WebSearch;
        if (!o.IsConfigured) return;

        // Azure OpenAI's v1 endpoint speaks the plain OpenAI protocol, so the OpenAI SDK
        // talks to it directly — with an Entra token by default, or a key if one is set.
        // The Responses API (rather than Chat Completions) is what offers web search. Its
        // client is flagged experimental (OPENAI001); the package version is pinned, so an
        // upstream change surfaces as a build error, not at runtime.
#pragma warning disable OPENAI001
        var clientOptions = new ResponsesClientOptions { Endpoint = new Uri(o.Endpoint!.TrimEnd('/') + "/openai/v1/") };
        var credential = new DefaultAzureCredential(new DefaultAzureCredentialOptions
        {
            TenantId = string.IsNullOrWhiteSpace(o.TenantId) ? null : o.TenantId,
        });
        var responses = string.IsNullOrWhiteSpace(o.ApiKey)
            ? new ResponsesClient(new BearerTokenPolicy(credential, "https://cognitiveservices.azure.com/.default"), clientOptions)
            : new ResponsesClient(new ApiKeyCredential(o.ApiKey), clientOptions);

        _client = responses.AsIChatClient(o.Deployment)
            .AsBuilder()
            .UseFunctionInvocation(configure: f => f.MaximumIterationsPerRequest = 12)
            .Build();
#pragma warning restore OPENAI001
    }

    public bool Enabled => _client is not null;
    public string? Model { get; }
    public bool WebSearch { get; }

    public async Task<AssistantReply> AskAsync(
        AppDbContext db, IReadOnlyList<ChatTurn> history, string language, CancellationToken ct)
    {
        if (_client is null) throw new InvalidOperationException("The AI assistant is not configured.");

        var tool = new FinanceSqlTool(db);
        var query = AIFunctionFactory.Create(
            ([Description("One read-only SELECT statement in the database's SQL dialect.")] string sql, CancellationToken token)
                => tool.RunAsync(sql, token),
            name: "query_database",
            description: $"Runs one read-only SQL SELECT against the finance database and returns the columns and up to {FinanceSqlTool.MaxRows} rows as JSON.");

        var messages = new List<AiChatMessage> { new(AiChatRole.System, await BuildSystemPromptAsync(db, language, WebSearch, ct)) };
        foreach (var turn in history.TakeLast(MaxHistory))
        {
            var content = turn.Content.Length > MaxMessageLength ? turn.Content[..MaxMessageLength] : turn.Content;
            messages.Add(new AiChatMessage(turn.Role == "assistant" ? AiChatRole.Assistant : AiChatRole.User, content));
        }

        var options = new ChatOptions
        {
            Tools = WebSearch ? [query, new HostedWebSearchTool()] : [query],
            // Low effort keeps answers to a few seconds per step; the SQL does the heavy lifting.
            Reasoning = new ReasoningOptions { Effort = ReasoningEffort.Low },
        };
        var response = await _client.GetResponseAsync(messages, options, ct);

        var contents = response.Messages.SelectMany(m => m.Contents).ToList();
        var searches = contents.OfType<WebSearchToolCallContent>()
            .SelectMany(c => c.Queries ?? [])
            .Where(q => !string.IsNullOrWhiteSpace(q))
            .Distinct()
            .ToList();
        var sources = contents
            .SelectMany(c => c.Annotations ?? [])
            .OfType<CitationAnnotation>()
            .Where(a => a.Url is not null)
            .GroupBy(a => a.Url!.ToString())
            .Select(g => new WebSource(g.First().Title ?? g.First().Url!.Host, g.Key))
            .ToList();

        _logger.LogInformation("Assistant answered using {Queries} quer(ies), {Searches} web search(es), {Sources} source(s).",
            tool.Executed.Count, searches.Count, sources.Count);
        return new AssistantReply(response.Text, tool.Executed, searches, sources);
    }

    // ---- prompt ------------------------------------------------------------------

    private static async Task<string> BuildSystemPromptAsync(AppDbContext db, string language, bool webSearch, CancellationToken ct)
    {
        var sqlite = db.Database.IsSqlite();
        var today = DateOnly.FromDateTime(DateTime.Now);
        var sb = new StringBuilder();

        sb.AppendLine($"""
            You are the analyst inside "Finance Manager", a personal budgeting app for a household in Portugal.
            You answer questions about the user's own data: analyses, comparisons between periods, trends,
            projections and what-if simulations. Today is {today:yyyy-MM-dd}. All amounts are in EUR.

            How to work:
            - Never guess numbers. Fetch them with the query_database tool, as many times as you need.
            - Let SQL do the arithmetic (SUM, AVG, GROUP BY, window functions, recursive CTEs for projections
              such as loan amortisation or compound growth) instead of adding numbers up yourself.
            - Prefer aggregated queries; only list individual rows when the user asks for them.
            - If a query fails, read the error, fix the SQL and try again.
            - For simulations, state your assumptions explicitly (rates, dates, what stays constant).
            - If the data cannot answer the question, say so and suggest what would be needed.
            - You can only read data. If asked to change something, explain that changes are made in the app's pages.

            {(webSearch ? WebGuidance : NoWebGuidance)}

            Answer format:
            - Reply in {(language == "pt" ? "European Portuguese (pt-PT)" : "English")}, unless the user writes in another language.
            - Use Markdown: short paragraphs, bullet points and tables for comparisons. Format money like
              {(language == "pt" ? "1 234,56 €" : "€1,234.56")}.
            - Be concise and lead with the answer. Do not show SQL unless asked.

            """);

        sb.AppendLine(sqlite ? SqliteDialect : SqlServerDialect);
        sb.AppendLine(Schema);
        sb.AppendLine(await DataOverviewAsync(db, ct));
        return sb.ToString();
    }

    private const string WebGuidance = """
        Web search:
        - You can also search the web. Use it for facts that are not in the database and may change over time:
          interest rates (Euribor, ECB), inflation, Portuguese tax rules (IRS, IMI, IUC), market and fund performance,
          current prices or offers. Combine them with the user's own figures when that answers the question better.
        - Do not search for what the database already answers.
        - Privacy: search queries leave this app. Never put the user's personal data in them — no names, amounts,
          account details, or merchants from their history. Search for the general fact instead
          (e.g. "Euribor 12 meses hoje", not "amortizar 10 000 € do crédito de Gabriel").
        - Prefer official and reputable sources (Banco de Portugal, Portal das Finanças, INE, ECB) and mention
          which source and date a figure comes from.
        """;

    private const string NoWebGuidance =
        "You have no internet access. For outside facts (rates, prices, tax rules) say you cannot check them and use clearly stated assumptions.";

    private const string SqliteDialect = """
        Database dialect: SQLite.
        - Dates are TEXT 'yyyy-MM-dd'. Use strftime('%Y', Date), strftime('%Y-%m', Date), date('now'), date(Date, '+1 month').
        - Money columns are stored as TEXT: always wrap them in CAST(x AS REAL) before comparing, ordering or doing maths
          (SUM/AVG already convert, but ORDER BY and > / < do not). Round results with ROUND(x, 2).
        - Use LIMIT n, WITH RECURSIVE for recursive CTEs, || for string concatenation.
        """;

    private const string SqlServerDialect = """
        Database dialect: Microsoft SQL Server (T-SQL).
        - Date columns are of type date. Use YEAR(Date), MONTH(Date), FORMAT(Date, 'yyyy-MM'), DATEADD, DATEDIFF, GETDATE().
        - Money columns are decimal(18,2).
        - Use SELECT TOP (n) instead of LIMIT, plain WITH for recursive CTEs (with OPTION (MAXRECURSION n) if needed).
        """;

    private const string Schema = """
        Tables (every table also has an integer Id):

        Categories(Id, Name)
          The categories, shared by Expenses, Incomes and FixedCosts.
        Sources(Id, Name)
          The accounts and cards money is paid from or received into.
        Expenses(Date, Item, Amount, CategoryId, SourceId)
          Every outgoing transaction. Amount is positive. CategoryId → Categories.Id, SourceId → Sources.Id
          (the account or card it was paid with). Both may be NULL.
        Incomes(Date, Item, Amount, CategoryId, SourceId)
          Money in: salary, refunds, cashback… Amount is positive. Same references as Expenses.
        FixedCosts(Type, CategoryId, Item, Frequency, DueMonths, MonthlyAmount, AnnualAmount)
          Recurring commitments (the budget, not actual payments). Type is 'Conta Fixa' (fixed) or 'Conta Variável' (variable estimate).
          CategoryId → Categories.Id.
          Frequency is 'Monthly' or 'Annual'. For annual costs DueMonths lists the months they are charged as text like '5,8,11'
          (the annual amount is split evenly across them) and MonthlyAmount is AnnualAmount / 12, i.e. what to set aside per month.
        Debts(Date, Item, Installment, Outstanding, TermMonths, Interest)
          Monthly snapshots per debt (usually on the 1st). Installment = monthly payment, Outstanding = balance still owed,
          TermMonths = remaining instalments, Interest = Installment × TermMonths − Outstanding (interest still to pay).
          For current debt use the latest Date per Item; never sum across snapshots.
        NetWorthEntries(Date, Liquidity, AssetClass, Item, Value)
          Monthly snapshots of every asset/account balance (usually on the 1st). Liquidity is 'Alta' (liquid) or 'Baixa'.
          Net worth at a date = SUM(Value) of the snapshot at that Date; never sum across dates.
        Investments(Date, Origin, Destination, Amount)
          Money moved into investments (contributions/transfers from Origin to Destination).
        Accounts(Name, Iban, Swift)
          Reference list of bank accounts.
        ClassificationAliases(Pattern, Kind, Item, Category, Hits)
          Internal rules used to classify bank statement lines. Rarely relevant.

        Item is free text in Portuguese; category and source names are listed below. To filter or group by
        category or source, JOIN Categories / Sources (LEFT JOIN when rows without one should count) and
        match the Name case- and accent-tolerantly with LIKE, using the names listed below.
        """;

    /// <summary>Row counts, date ranges and the category vocabulary, so the model filters on real values.</summary>
    private static async Task<string> DataOverviewAsync(AppDbContext db, CancellationToken ct)
    {
        var sb = new StringBuilder("Current data overview:\n");

        async Task Range<T>(string name, IQueryable<T> rows, System.Linq.Expressions.Expression<Func<T, DateOnly>> date)
        {
            var count = await rows.CountAsync(ct);
            if (count == 0) { sb.AppendLine($"- {name}: empty"); return; }
            var min = await rows.MinAsync(date, ct);
            var max = await rows.MaxAsync(date, ct);
            sb.AppendLine(CultureInfo.InvariantCulture, $"- {name}: {count} rows, {min:yyyy-MM-dd} to {max:yyyy-MM-dd}");
        }

        await Range("Expenses", db.Expenses, e => e.Date);
        await Range("Incomes", db.Incomes, e => e.Date);
        await Range("Debts", db.Debts, e => e.Date);
        await Range("NetWorthEntries", db.NetWorthEntries, e => e.Date);
        await Range("Investments", db.Investments, e => e.Date);
        sb.AppendLine($"- FixedCosts: {await db.FixedCosts.CountAsync(ct)} rows");

        async Task Distinct(string label, IQueryable<string> values)
        {
            var list = await values.Where(v => v != "").Distinct().OrderBy(v => v).Take(120).ToListAsync(ct);
            if (list.Count > 0) sb.AppendLine($"- {label}: {string.Join(" | ", list)}");
        }

        await Distinct("Categories", db.Categories.Select(c => c.Name));
        await Distinct("Sources", db.Sources.Select(s => s.Name));
        await Distinct("Debt items", db.Debts.Select(e => e.Item));
        await Distinct("Net worth asset classes", db.NetWorthEntries.Select(e => e.AssetClass));
        return sb.ToString();
    }
}

public sealed record ChatTurn(string Role, string Content);

public sealed record WebSource(string Title, string Url);

public sealed record AssistantReply(
    string Reply,
    IReadOnlyList<ExecutedQuery> Queries,
    IReadOnlyList<string> WebSearches,
    IReadOnlyList<WebSource> Sources);
