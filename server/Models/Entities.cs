namespace FinanceManager.Api.Models;

/// <summary>Common identity for every stored record.</summary>
public abstract class BaseEntity
{
    public int Id { get; set; }
}

/// <summary>A single spending transaction (sheet: "Despesas").</summary>
public class Expense : BaseEntity
{
    public DateOnly Date { get; set; }
    public string Item { get; set; } = "";
    public decimal Amount { get; set; }
    public string Category { get; set; } = "";
    public string Source { get; set; } = "";
}

/// <summary>A single income transaction (sheet: "Receitas").</summary>
public class Income : BaseEntity
{
    public DateOnly Date { get; set; }
    public string Item { get; set; } = "";
    public decimal Amount { get; set; }
    public string Category { get; set; } = "";
    public string Source { get; set; } = "";
}

/// <summary>A recurring fixed or variable monthly cost (sheet: "Gastos Fixos").</summary>
public class FixedCost : BaseEntity
{
    public string Type { get; set; } = "";      // "Conta Fixa" | "Conta Variável"
    public string Category { get; set; } = "";
    public string Item { get; set; } = "";
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
