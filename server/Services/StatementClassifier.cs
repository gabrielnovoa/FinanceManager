using FinanceManager.Api.Models;

namespace FinanceManager.Api.Services;

/// <summary>A statement line with the classifier's best guess attached.</summary>
public record ClassifiedLine
{
    public required DateOnly Date { get; init; }
    public required string Description { get; init; }
    public required decimal Amount { get; init; }
    public required bool IsCredit { get; init; }
    public string? Card { get; init; }

    public required LineKind Kind { get; init; }
    public string Item { get; init; } = "";
    public string Category { get; init; } = "";
    public string Source { get; init; } = "";

    /// <summary>"alias", "history" or "none" — shown in the review screen so the user knows how much to trust the guess.</summary>
    public required string MatchedBy { get; init; }

    /// <summary>A row with the same date, amount and source is already stored.</summary>
    public bool IsDuplicate { get; init; }
}

/// <summary>An item the user has filed before, with the category they usually pair it with.</summary>
public record HistoryEntry(string Item, string Category, LineKind Kind, int Uses)
{
    public string Key { get; } = TextNormalizer.Key(Item);
}

/// <summary>
/// Turns raw statement lines into proposed Expense/Income rows.
///
/// Three passes, first hit wins:
///   1. aliases  — rules stored in the database, seeded with the known ones and extended
///                 every time the user corrects a line during review;
///   2. history  — the items already filed, matched on a squashed key so "VIAVERDE"
///                 finds "Via Verde";
///   3. nothing  — direction still decides income vs expense, and the user fills the rest.
/// </summary>
public class StatementClassifier
{
    /// <summary>
    /// Bank prefixes that sit in front of the merchant name and carry no meaning for
    /// classification. Removed before matching so "COMPRA 9156 CONTINENTE" and
    /// "CONTINENTE" look the same.
    /// </summary>
    private static readonly string[] NoisePrefixes =
        ["compra", "cred", "pagbxval", "pagserv", "pag", "vis", "dd"];

    public IReadOnlyList<ClassifiedLine> Classify(
        IEnumerable<StatementLine> lines,
        IReadOnlyList<ClassificationAlias> aliases,
        IReadOnlyList<HistoryEntry> history,
        string source,
        Func<DateOnly, decimal, bool, bool> isDuplicate)
    {
        // Longer patterns are more specific: "campanhacrehab" must beat the loan number
        // that also appears in the same description.
        var ranked = aliases
            .OrderByDescending(a => a.Pattern.Length)
            .ThenByDescending(a => a.Hits)
            .ToList();

        var vocabulary = history
            .Where(h => h.Key.Length >= 4)
            .OrderByDescending(h => h.Key.Length)
            .ThenByDescending(h => h.Uses)
            .ToList();

        var result = new List<ClassifiedLine>();

        foreach (var line in lines)
        {
            var key = MatchKey(line.Description);
            var kind = line.IsCredit ? LineKind.Income : LineKind.Expense;

            var alias = ranked.FirstOrDefault(a => a.Pattern.Length > 0 && key.Contains(a.Pattern));
            var match = alias is null
                ? vocabulary.FirstOrDefault(h => key.Contains(h.Key))
                : null;

            string item = "", category = "", matchedBy = "none";

            if (alias is not null)
            {
                // An alias for a merchant applies to both a purchase and its refund, so
                // the statement's direction still decides income vs expense. Only
                // "ignore" is absolute — an internal transfer is never a real movement.
                if (alias.Kind == LineKind.Ignore) kind = LineKind.Ignore;
                item = alias.Item;
                category = alias.Category;
                matchedBy = "alias";
            }
            else if (match is not null)
            {
                item = match.Item;
                category = match.Category;
                matchedBy = "history";
            }

            result.Add(new ClassifiedLine
            {
                Date = line.Date,
                Description = line.Description,
                Amount = line.Amount,
                IsCredit = line.IsCredit,
                Card = line.Card,
                Kind = kind,
                Item = item,
                Category = category,
                Source = source,
                MatchedBy = matchedBy,
                IsDuplicate = kind != LineKind.Ignore && isDuplicate(line.Date, line.Amount, line.IsCredit),
            });
        }

        return result;
    }

    /// <summary>Strips the bank's leading noise words and card digits, then squashes the rest.</summary>
    public static string MatchKey(string description)
    {
        var words = TextNormalizer.Fold(description).Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();

        while (words.Count > 1)
        {
            var head = words[0];
            if (NoisePrefixes.Contains(head) || (head.Length == 4 && head.All(char.IsDigit)))
                words.RemoveAt(0);
            else
                break;
        }

        return string.Concat(words);
    }

    /// <summary>
    /// Picks the source from the file name — the user names each export after the account
    /// it came from. Scores by the longest recognised word so "Prestige Gold.xlsx" chooses
    /// "Crédito Prestige" over "TAP Gold", which shares only the weaker word "gold".
    /// </summary>
    public static string? DetectSource(string fileName, IEnumerable<string> knownSources)
    {
        var stem = TextNormalizer.Key(Path.GetFileNameWithoutExtension(fileName));
        if (stem.Length == 0) return null;

        string? best = null;
        var bestScore = 0;

        foreach (var candidate in knownSources.Where(s => !string.IsNullOrWhiteSpace(s)))
        {
            var score = TextNormalizer
                .Fold(candidate)
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Where(word => word.Length >= 3 && stem.Contains(word))
                .Select(word => word.Length)
                .DefaultIfEmpty(0)
                .Max();

            if (score > bestScore)
            {
                bestScore = score;
                best = candidate;
            }
        }

        return best;
    }
}
