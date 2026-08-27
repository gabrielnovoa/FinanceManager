using System.Globalization;
using System.Text;

namespace FinanceManager.Api.Services;

/// <summary>
/// Accent- and case-insensitive text folding used to match bank descriptions against
/// known merchants. Banks are inconsistent about spacing and punctuation — the same
/// merchant appears as "VIAVERDE", "Via Verde" and "VIA-VERDE" — so matching is done
/// on a squashed key where those differences disappear.
/// </summary>
public static class TextNormalizer
{
    /// <summary>Lowercase, accent-free, punctuation collapsed to single spaces.</summary>
    public static string Fold(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";

        var decomposed = s.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        var lastWasSpace = false;

        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;

            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(ch);
                lastWasSpace = false;
            }
            else if (!lastWasSpace)
            {
                sb.Append(' ');
                lastWasSpace = true;
            }
        }

        return sb.ToString().Trim().Normalize(NormalizationForm.FormC);
    }

    /// <summary>
    /// <see cref="Fold"/> with spaces removed. This is the alias matching key: it makes
    /// "VIAVERDE" and "Via Verde" identical, which plain substring matching does not.
    /// </summary>
    public static string Key(string? s) => Fold(s).Replace(" ", "");
}
