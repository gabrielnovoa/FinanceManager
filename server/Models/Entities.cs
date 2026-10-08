using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace FinanceManager.Api.Models;

/// <summary>Common identity for every stored record.</summary>
public abstract class BaseEntity
{
    public int Id { get; set; }
}

/// <summary>A category shared by expenses, income and fixed costs.</summary>
public class Category : BaseEntity
{
    public string Name { get; set; } = "";
}

/// <summary>An account or card money comes from or goes to (Millenium, Prestige Gold, Wizink…).</summary>
public class Source : BaseEntity
{
    public string Name { get; set; } = "";
}

/// <summary>
/// A row whose category is stored as a reference to <see cref="Models.Category"/> but
/// exchanged by name. The API, the backups and the statement import all read and write
/// <see cref="Category"/> as plain text; <see cref="Data.AppDbContext"/> turns the name
/// into a reference on save — matching existing categories case-insensitively and
/// creating the ones that are new — and the reference is loaded with every query.
/// </summary>
public abstract class CategorizedEntity : BaseEntity
{
    private string? _category;

    [JsonIgnore] public int? CategoryId { get; set; }
    [JsonIgnore] public Category? CategoryRef { get; set; }

    [NotMapped]
    public string Category
    {
        get => _category ?? CategoryRef?.Name ?? "";
        set => _category = value ?? "";
    }

    /// <summary>A name assigned since the row was loaded, still to be resolved to a reference.</summary>
    internal string? PendingCategory => _category;

    internal void SetCategory(Category? category)
    {
        CategoryRef = category;
        if (category is null || category.Id > 0) CategoryId = category?.Id;
        _category = null;
    }
}

/// <summary>An expense or income line: a category plus the account or card it went through.</summary>
public abstract class LedgerEntry : CategorizedEntity
{
    private string? _source;

    public DateOnly Date { get; set; }
    public string Item { get; set; } = "";
    public decimal Amount { get; set; }

    [JsonIgnore] public int? SourceId { get; set; }
    [JsonIgnore] public Source? SourceRef { get; set; }

    /// <summary>Exchanged by name, stored as a reference — see <see cref="CategorizedEntity"/>.</summary>
    [NotMapped]
    public string Source
    {
        get => _source ?? SourceRef?.Name ?? "";
        set => _source = value ?? "";
    }

    internal string? PendingSource => _source;

    internal void SetSource(Source? source)
    {
        SourceRef = source;
        if (source is null || source.Id > 0) SourceId = source?.Id;
        _source = null;
    }
}

/// <summary>A single spending transaction (sheet: "Despesas").</summary>
public class Expense : LedgerEntry;

/// <summary>A single income transaction (sheet: "Receitas").</summary>
public class Income : LedgerEntry;

/// <summary>How often a fixed cost is actually charged.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum CostFrequency
{
    /// <summary>Charged every month; the annual figure is derived (× 12).</summary>
    Monthly,
    /// <summary>Charged once or a few times a year; the monthly figure is derived (÷ 12).</summary>
    Annual,
}

/// <summary>A recurring fixed or variable cost (sheet: "Gastos Fixos").</summary>
public class FixedCost : CategorizedEntity
{
    public string Type { get; set; } = "";      // "Conta Fixa" | "Conta Variável"
    public string Item { get; set; } = "";
    public CostFrequency Frequency { get; set; } = CostFrequency.Monthly;
    /// <summary>
    /// Months (1–12) an annual cost is charged in; the annual amount is split evenly
    /// across them (e.g. IMI in May, August and November). Always empty for monthly costs.
    /// </summary>
    public int[] DueMonths { get; set; } = [];
    public decimal MonthlyAmount { get; set; }
    public decimal AnnualAmount { get; set; }
}

/// <summary>A monthly debt snapshot (sheet: "Dívidas").</summary>
public class Debt : BaseEntity
{
    public DateOnly Date { get; set; }
    public string Item { get; set; } = "";
    public decimal Installment { get; set; }    // Prestação
    public decimal Outstanding { get; set; }    // Total em dívida
    public int? TermMonths { get; set; }         // Prazo
    public decimal Interest { get; set; }        // Juros
}

/// <summary>A net-worth line item snapshot (sheet: "Patrimônio").</summary>
public class NetWorthEntry : BaseEntity
{
    public DateOnly Date { get; set; }
    public string Liquidity { get; set; } = "";  // Líquidez: Alta | Baixa
    public string AssetClass { get; set; } = ""; // Classe de Ativos
    public string Item { get; set; } = "";
    public decimal Value { get; set; }
}

/// <summary>An investment contribution / transfer (sheet: "Investimentos").</summary>
public class Investment : BaseEntity
{
    public DateOnly Date { get; set; }
    public string Origin { get; set; } = "";
    public string Destination { get; set; } = "";
    public decimal Amount { get; set; }
}

/// <summary>Where a classified statement line ends up.</summary>
public enum LineKind
{
    Expense,
    Income,
    /// <summary>Internal movement (card payment, transfer between own accounts) that would double-count.</summary>
    Ignore,
}

/// <summary>
/// A learned mapping from a bank statement description to the item/category the user
/// actually files it under. Grows every time a line is corrected during review, so the
/// same merchant is recognised automatically next month.
/// </summary>
public class ClassificationAlias : BaseEntity
{
    /// <summary>Normalised fragment matched against the statement description (lowercase, no accents, no spaces).</summary>
    public string Pattern { get; set; } = "";
    public LineKind Kind { get; set; }
    public string Item { get; set; } = "";
    public string Category { get; set; } = "";
    /// <summary>How many times this alias has been applied — used to prefer the more established mapping.</summary>
    public int Hits { get; set; }
}

/// <summary>A bank account reference (sheet: "Contas Bancárias").</summary>
public class BankAccount : BaseEntity
{
    public string Name { get; set; } = "";
    public string Iban { get; set; } = "";
    public string Swift { get; set; } = "";
}

/// <summary>One conversation with the AI assistant. Private to the user who started it.</summary>
public class ChatConversation : BaseEntity
{
    /// <summary>Easy Auth principal id of the user, or "local" when running without sign-in.</summary>
    public string Owner { get; set; } = "";
    public string Title { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<ChatMessageEntry> Messages { get; set; } = [];
}

/// <summary>A single question or answer within a <see cref="ChatConversation"/>.</summary>
public class ChatMessageEntry : BaseEntity
{
    public int ConversationId { get; set; }
    /// <summary>"user" or "assistant".</summary>
    public string Role { get; set; } = "";
    public string Content { get; set; } = "";
    /// <summary>JSON with what the answer was based on: SQL queries, web searches, sources.</summary>
    public string? Details { get; set; }
    public DateTime CreatedAt { get; set; }
}
