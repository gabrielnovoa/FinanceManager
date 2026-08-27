using FinanceManager.Api.Data;
using FinanceManager.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FinanceManager.Api.Services;

/// <summary>
/// Loads the starting set of classification rules. Every entry here was confirmed against
/// movements already in the database, not guessed. They are written to the table rather
/// than hard-coded so that any of them can be edited or deleted from the app later.
///
/// Seeding runs only while the table is empty, so it never overwrites the user's own rules.
/// </summary>
public static class AliasSeeder
{
    private record Seed(string Pattern, LineKind Kind, string Item = "", string Category = "");

    private static readonly Seed[] Seeds =
    [
        // --- internal movements: real, but not income or expense ------------------
        // Patterns are matched after the bank's leading noise words ("DD", "COMPRA",
        // "PAG BXVAL", the card digits) have been stripped, so they must not include them.
        new("pagamentocartaocredito",   LineKind.Ignore),   // paying a card off from the account
        new("pagamentocartaodecredito", LineKind.Ignore),
        new("wizinkbank",               LineKind.Ignore),
        new("pagamentopordebitodireto", LineKind.Ignore),
        new("repartida",                LineKind.Ignore),   // the ±2500 instalment split pairs
        new("interactivebrokers",       LineKind.Ignore),   // tracked under Investimentos
        new("traderepublic",            LineKind.Ignore),

        // --- loans: the account number is the only reliable identifier ------------
        new("2143547723", LineKind.Expense, "Crédito Habitação", "Crédito Habitação"),
        new("3068858852", LineKind.Expense, "Crédito Pessoal",   "Empréstimo"),

        // Longer than the loan number above, so this wins on the cashback lines that
        // quote the same account.
        new("campanhacrehab", LineKind.Income, "Cashback Crédito Habitação", "Crédito Habitação"),

        // --- direct debits --------------------------------------------------------
        // The insurer writes the policy number consistently but not the policy name, so
        // the number is the reliable half of the description.
        new("edpcomercial", LineKind.Expense, "EDP",         "Casa"),
        new("smasdealmada", LineKind.Expense, "SMAS Almada", "Casa"),
        new("meosa",        LineKind.Expense, "MEO",         "Casa"),
        new("00403161682",  LineKind.Expense, "Seguro Multirriscos - CH", "Crédito Habitação"),
        new("multirisc",    LineKind.Expense, "Seguro Multirriscos - CH", "Crédito Habitação"),
        new("00523215085",  LineKind.Expense, "Seguro de Vida - CH",      "Crédito Habitação"),
        new("segvida",      LineKind.Expense, "Seguro de Vida - CH",      "Crédito Habitação"),
        new("atitudepositi", LineKind.Expense, "Aquafitness", "Esportes"),
        new("fidelidadecom", LineKind.Expense, "Seguro Pet",  "Pet"),

        // --- bank charges ---------------------------------------------------------
        new("impostodoselo",        LineKind.Expense, "Imposto Selo",                 "Imposto"),
        new("impostoselo",          LineKind.Expense, "Imposto Selo",                 "Imposto"),
        new("servicointernacional", LineKind.Expense, "Custo Serviço Internacional",  "Banco"),
        new("debitojuros",          LineKind.Expense, "Juros Cartão",                 "Banco"),
        new("quasicash",            LineKind.Expense, "Comissão",                     "Banco"),
        new("manutencaodeconta",    LineKind.Expense, "Manutenção de conta",          "Banco"),
        new("commancontapacoteprogramaprestige", LineKind.Expense, "Manutenção de conta", "Banco"),

        // --- recurring transfers --------------------------------------------------
        new("trfpoinstitutodegestofinance", LineKind.Income,  "Segurança Social (titular 2)", "Benefício"),
        new("trfpvitorhugorodriguesbaioa",  LineKind.Expense, "Jardinagem",               "Casa"),

        // --- salary: the amount and the person vary, so only the category is safe --
        new("transferenciavencimento", LineKind.Income, "", "Ordenado"),

        // --- frequent merchants the bank writes without spaces --------------------
        new("viaverde", LineKind.Expense, "Via Verde", "Carro"),

        // "PAGSERV Cerrado Ver <ref> PPROnew" — only the name is stable, the reference
        // changes every time, so match on the shop name alone.
        new("cerradover", LineKind.Expense, "Talho Cerrado Verde", "Mercado"),

        // Recovered by cross-referencing a year of statements against movements already
        // in the database, joining on account + amount + date. Only patterns the majority
        // of their own lines agreed on were kept: matching on amount alone makes small
        // recurring values (a 0.80 vending machine coffee) collide with unrelated shops.
        // Deliberately excluded were one-off holiday merchants (anything bought in Brazil
        // is a trip purchase that will not repeat) and generic biller descriptors such as
        // "PAG-ESTADO" and "APPLE.COM/BILL", which cover several different items each and
        // so cannot be pinned to one.
        new("superboaturma",      LineKind.Expense, "Talho Boa Turma",              "Mercado"),
        new("charnecadacaparica", LineKind.Expense, "Pingo Doce",                   "Mercado"),
        new("hospitalluzlisboa",  LineKind.Expense, "Hospital da Luz",              "Saúde"),
        new("clinicadojardim",    LineKind.Expense, "Clínica Jardim das Amoreiras", "Saúde"),
        new("confeitarialimao",   LineKind.Expense, "Confeitaria Limão Papoila",    "Comida"),
        new("leonidascampopeq",   LineKind.Expense, "Café Leonidas",                "Comida"),
        new("literallyathome",    LineKind.Expense, "Revolution Food",              "Comida"),
        new("basukulisboa",       LineKind.Expense, "Cafeteria Basuku",             "Comida"),
        new("retasco",            LineKind.Expense, "Restaurante Retasco",          "Restaurante"),
        new("restblacklabely",    LineKind.Expense, "Restaurante Black Labely",     "Restaurante"),
        new("gestwashldalisboa",  LineKind.Expense, "Lavagem Carro",                "Carro"),
        new("paypalplaystation",  LineKind.Expense, "PSN Plus",                     "Subscription"),

        // Vending machine, so the description is always the operator's name and never
        // says what was bought. 22 lines in the statements, none of them ever recorded
        // by hand — this rule is what finally brings them in.
        new("asuper2000",         LineKind.Expense, "Vending Machine",              "Comida"),
    ];

    public static async Task SeedAsync(AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        try
        {
            if (await db.ClassificationAliases.AnyAsync(ct)) return;

            db.ClassificationAliases.AddRange(Seeds.Select(s => new ClassificationAlias
            {
                Pattern = s.Pattern,
                Kind = s.Kind,
                Item = s.Item,
                Category = s.Category,
                Hits = 0,
            }));

            await db.SaveChangesAsync(ct);
            logger.LogInformation("Seeded {Count} statement classification rules.", Seeds.Length);
        }
        catch (Exception ex)
        {
            // A missing table or a race with another instance must not stop the app.
            logger.LogWarning(ex, "Could not seed statement classification rules.");
        }
    }
}
