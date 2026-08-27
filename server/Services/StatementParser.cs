using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using ExcelDataReader;

namespace FinanceManager.Api.Services;

/// <summary>One movement as it appears on the bank's own statement, before classification.</summary>
public record StatementLine
{
    public required DateOnly Date { get; init; }
    /// <summary>The description exactly as the bank wrote it.</summary>
    public required string Description { get; init; }
    /// <summary>Always positive. <see cref="IsCredit"/> carries the direction.</summary>
    public required decimal Amount { get; init; }
    /// <summary>True when money came in (a refund, salary or cashback).</summary>
    public required bool IsCredit { get; init; }
    /// <summary>Last four digits of the card, when the statement names one.</summary>
    public string? Card { get; init; }
}

public record ParsedStatement(string Format, IReadOnlyList<StatementLine> Lines);

/// <summary>
/// Reads the three statement layouts this account uses. Header positions are found by
/// looking for the header text rather than hard-coded row numbers, because the banks
/// vary the number of summary rows above the table.
/// </summary>
public class StatementParser
{
    static StatementParser()
    {
        // Legacy .xls files carry a code page that .NET does not load by default.
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    private static readonly string[] DateFormats =
        ["dd-MM-yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "d-M-yyyy", "d/M/yyyy"];

    public ParsedStatement Parse(Stream stream, string fileName)
    {
        stream.Position = 0;
        return IsLegacyXls(stream) ? ParseLegacyXls(stream) : ParseXlsx(stream);
    }

    /// <summary>Old BIFF files start with the OLE2 compound-document signature.</summary>
    private static bool IsLegacyXls(Stream s)
    {
        Span<byte> head = stackalloc byte[8];
        s.Position = 0;
        var read = s.Read(head);
        s.Position = 0;
        return read == 8 && head[0] == 0xD0 && head[1] == 0xCF && head[2] == 0x11 && head[3] == 0xE0;
    }

    // ---------------------------------------------------------------- Millennium (.xlsx)

    private ParsedStatement ParseXlsx(Stream stream)
    {
        using var wb = new XLWorkbook(stream);
        var ws = wb.Worksheets.FirstOrDefault()
                 ?? throw new InvalidDataException("The workbook has no sheets.");

        var (headerRow, columns) = FindHeader(ws);
        if (headerRow == 0)
            throw new InvalidDataException(
                "Could not find a statement table. Expected a header row containing 'Descrição' and 'Montante'.");

        // The current account statement states Crédito/Débito outright; the card
        // statement does not, and there a positive amount means a purchase.
        var hasTipo = columns.TryGetValue("tipo", out var tipoCol);
        var format = hasTipo ? "millennium-account" : "millennium-card";

        var descCol = columns["descricao"];
        var amountCol = columns["montante"];

        // Prefer the posting date — the day the purchase happened. The card statements
        // head that column "Data de lançamento" while the account statement drops the
        // "de", so both spellings have to be recognised. Falling through to the value
        // date would push purchases made in the last days of a month into the next one,
        // because the bank settles them a day or three later.
        var dateCol = columns.TryGetValue("datalancamento", out var dl) ? dl
                    : columns.TryGetValue("datadelancamento", out var ddl) ? ddl
                    : columns.TryGetValue("datavalor", out var dv) ? dv
                    : 1;

        var lines = new List<StatementLine>();

        foreach (var row in ws.RowsUsed().Where(r => r.RowNumber() > headerRow))
        {
            var description = Text(row.Cell(descCol));
            if (string.IsNullOrWhiteSpace(description)) continue;

            var date = ParseDate(row.Cell(dateCol));
            if (date is null) continue;

            var raw = ParseAmount(row.Cell(amountCol));
            if (raw == 0m) continue;

            var isCredit = hasTipo
                ? TextNormalizer.Key(Text(row.Cell(tipoCol))).StartsWith("credito")
                : raw < 0m;   // card: a negative figure is a refund or cashback

            lines.Add(new StatementLine
            {
                Date = date.Value,
                Description = description,
                Amount = Math.Abs(raw),
                IsCredit = isCredit,
                Card = ExtractCard(description),
            });
        }

        return new ParsedStatement(format, lines);
    }

    /// <summary>
    /// Locates the header row and maps the columns we care about. Scans a generous
    /// number of rows because the summary block above the table varies in height.
    /// </summary>
    private static (int Row, Dictionary<string, int> Columns) FindHeader(IXLWorksheet ws)
    {
        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 0;
        var limit = Math.Min(lastRow, 40);

        for (var r = 1; r <= limit; r++)
        {
            var map = new Dictionary<string, int>();
            var lastCol = ws.Row(r).LastCellUsed()?.Address.ColumnNumber ?? 0;

            for (var c = 1; c <= lastCol; c++)
            {
                var key = TextNormalizer.Key(Text(ws.Cell(r, c)));
                if (key.Length > 0 && !map.ContainsKey(key)) map[key] = c;
            }

            if (map.ContainsKey("descricao") && map.ContainsKey("montante")) return (r, map);
        }

        return (0, []);
    }

    // ---------------------------------------------------------------- Wizink (.xls)

    private ParsedStatement ParseLegacyXls(Stream stream)
    {
        stream.Position = 0;
        using var reader = ExcelReaderFactory.CreateReader(stream);

        var rows = new List<string?[]>();
        while (reader.Read())
        {
            var values = new string?[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var value = reader.GetValue(i);
                values[i] = value switch
                {
                    null => null,
                    DateTime dt => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    double d => d.ToString(CultureInfo.InvariantCulture),
                    _ => value.ToString(),
                };
            }
            rows.Add(values);
        }

        var headerIndex = rows.FindIndex(r =>
            r.Any(c => TextNormalizer.Key(c).StartsWith("descricao")) &&
            r.Any(c => TextNormalizer.Key(c).StartsWith("montante")));

        if (headerIndex < 0)
            throw new InvalidDataException(
                "Could not find a statement table. Expected a header row containing 'Descrição da transação'.");

        var header = rows[headerIndex];
        int Col(params string[] prefixes) =>
            Array.FindIndex(header, c => prefixes.Any(p => TextNormalizer.Key(c).StartsWith(p)));

        var dateCol = Col("datadatransacao", "data");
        var descCol = Col("descricao");
        var amountCol = Col("montantetransacao", "montante");
        var cardCol = Col("numerodocartao");

        var lines = new List<StatementLine>();

        foreach (var row in rows.Skip(headerIndex + 1))
        {
            var description = descCol >= 0 && descCol < row.Length ? row[descCol]?.Trim() : null;
            if (string.IsNullOrWhiteSpace(description)) continue;

            var date = ParseDate(dateCol >= 0 && dateCol < row.Length ? row[dateCol] : null);
            if (date is null) continue;

            var raw = ParseAmount(amountCol >= 0 && amountCol < row.Length ? row[amountCol] : null);
            if (raw == 0m) continue;

            var card = cardCol >= 0 && cardCol < row.Length ? row[cardCol]?.Trim().TrimStart('*') : null;

            lines.Add(new StatementLine
            {
                Date = date.Value,
                Description = description!,
                Amount = Math.Abs(raw),
                IsCredit = raw < 0m,   // Wizink: a negative figure credits the card
                Card = string.IsNullOrWhiteSpace(card) ? null : card,
            });
        }

        return new ParsedStatement("wizink", lines);
    }

    // ---------------------------------------------------------------- shared helpers

    private static string Text(IXLCell c) => c.IsEmpty() ? "" : c.GetFormattedString().Trim();

    private static DateOnly? ParseDate(IXLCell c)
    {
        if (c.IsEmpty()) return null;
        if (c.TryGetValue<DateTime>(out var dt)) return DateOnly.FromDateTime(dt);
        return ParseDate(c.GetFormattedString());
    }

    private static DateOnly? ParseDate(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();

        if (DateOnly.TryParseExact(s, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var exact))
            return exact;

        return DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var loose)
            ? DateOnly.FromDateTime(loose)
            : null;
    }

    private static decimal ParseAmount(IXLCell c)
    {
        if (c.IsEmpty()) return 0m;
        if (c.TryGetValue<decimal>(out var v)) return v;
        return ParseAmount(c.GetFormattedString());
    }

    /// <summary>
    /// Statements mix conventions: the account file writes "-1,461.07" while other
    /// exports use "1.461,07". Whichever separator appears last is the decimal one.
    /// </summary>
    private static decimal ParseAmount(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return 0m;

        var cleaned = new string(s.Where(ch => char.IsDigit(ch) || ch is '-' or '+' or ',' or '.').ToArray());
        if (cleaned.Length == 0) return 0m;

        var lastComma = cleaned.LastIndexOf(',');
        var lastDot = cleaned.LastIndexOf('.');

        if (lastComma >= 0 && lastDot >= 0)
        {
            cleaned = lastComma > lastDot
                ? cleaned.Replace(".", "").Replace(',', '.')   // 1.461,07
                : cleaned.Replace(",", "");                    // 1,461.07
        }
        else if (lastComma >= 0)
        {
            // A lone comma is decimal unless it is clearly grouping (e.g. "1,461").
            var decimals = cleaned.Length - lastComma - 1;
            cleaned = decimals == 3 ? cleaned.Replace(",", "") : cleaned.Replace(',', '.');
        }

        return decimal.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var result)
            ? result
            : 0m;
    }

    /// <summary>Pulls the card digits out of "COMPRA 9156 MERCHANT" style descriptions.</summary>
    private static string? ExtractCard(string description)
    {
        var parts = description.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return null;

        var prefix = TextNormalizer.Key(parts[0]);
        if (prefix is not ("compra" or "cred" or "pag" or "pagserv")) return null;

        foreach (var part in parts.Skip(1).Take(2))
            if (part.Length == 4 && part.All(char.IsDigit))
                return part;

        return null;
    }
}
