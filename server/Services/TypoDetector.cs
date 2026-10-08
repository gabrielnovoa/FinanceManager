using System.Globalization;
using System.Text;

namespace FinanceManager.Api.Services;

/// <summary>
/// Spots category or source names that look like misspellings of one another
/// ("Millenium" / "Millennium", "Restaurente" / "Restaurante", "Saude" / "Saúde").
/// Only spelling is compared — never meaning — so "Comida" and "Mercado" are not a
/// pair. The result is a suggestion for the user; nothing is ever merged from here.
/// </summary>
public static class TypoDetector
{
    public sealed record Candidate(int Id, string Name, int Uses);

    /// <summary>A likely typo: <c>From</c> would be merged into <c>Into</c>, the more used spelling.</summary>
    public sealed record Pair(Candidate From, Candidate Into, string Reason);

    public static List<Pair> Find(IReadOnlyList<Candidate> items)
    {
        var pairs = new List<Pair>();
        for (var i = 0; i < items.Count; i++)
        for (var j = i + 1; j < items.Count; j++)
        {
            if (Reason(items[i].Name, items[j].Name) is not { } reason) continue;
            var (from, into) = Prefer(items[i], items[j]);
            pairs.Add(new Pair(from, into, reason));
        }
        return pairs.OrderBy(p => p.Into.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    /// <summary>Why two names look like the same word misspelt, or null when they do not.</summary>
    public static string? Reason(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.Ordinal)) return null;
        if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) return "case";

        var x = Fold(a);
        var y = Fold(b);
        if (x == y) return "accents";

        // One slip per word is a typo; anything more is a different word. Short names
        // ("Casa" / "Caso") are too likely to be genuinely different to flag.
        var shorter = Math.Min(x.Length, y.Length);
        var allowed = shorter >= 9 ? 2 : shorter >= 5 ? 1 : 0;
        return allowed > 0 && Distance(x, y, allowed) <= allowed ? "spelling" : null;
    }

    private static (Candidate From, Candidate Into) Prefer(Candidate a, Candidate b)
    {
        // Keep the spelling more rows already use; on a tie, the one with accents
        // (usually the correct Portuguese), then the first alphabetically.
        if (a.Uses != b.Uses) return a.Uses > b.Uses ? (b, a) : (a, b);
        var aAccents = a.Name != Fold(a.Name, keepCase: true);
        var bAccents = b.Name != Fold(b.Name, keepCase: true);
        if (aAccents != bAccents) return aAccents ? (b, a) : (a, b);
        return string.Compare(a.Name, b.Name, StringComparison.CurrentCulture) <= 0 ? (b, a) : (a, b);
    }

    /// <summary>Lowercase (optionally), accents removed, spaces collapsed.</summary>
    private static string Fold(string s, bool keepCase = false)
    {
        var decomposed = s.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                sb.Append(keepCase ? c : char.ToLowerInvariant(c));
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>Damerau–Levenshtein (optimal string alignment), stopping early past <paramref name="max"/>.</summary>
    private static int Distance(string a, string b, int max)
    {
        if (Math.Abs(a.Length - b.Length) > max) return max + 1;
        var d = new int[a.Length + 1, b.Length + 1];
        for (var i = 0; i <= a.Length; i++) d[i, 0] = i;
        for (var j = 0; j <= b.Length; j++) d[0, j] = j;
        for (var i = 1; i <= a.Length; i++)
        {
            var rowMin = int.MaxValue;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                var v = Math.Min(Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1), d[i - 1, j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1])
                    v = Math.Min(v, d[i - 2, j - 2] + 1);
                d[i, j] = v;
                rowMin = Math.Min(rowMin, v);
            }
            if (rowMin > max) return max + 1;
        }
        return d[a.Length, b.Length];
    }
}
