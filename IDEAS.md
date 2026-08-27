# Ideas to improve the app & the data

You asked for suggestions — here are the ones with the best effort-to-value ratio,
grouped by whether they touch the **app** or the **data model**. Items marked ✅
are already in the build.

## App features

- ✅ **Dashboard with KPIs + interactive charts** (income vs expenses, category &
  source breakdowns, net-worth and debt trends, savings rate).
- ✅ **Statement import & JSON backup / restore** so data is never trapped.
- **Monthly budget targets + alerts.** Set a cap per category; the dashboard
  highlights categories over budget for the month. Highest-value next feature for
  a budgeting tool.
- **Recurring auto-entry from Fixed Costs.** You already track €~4k/month of fixed
  costs — generate those expense rows automatically each month instead of adding
  them by hand.
- **Debt-payoff projections.** Your Debts table has installment, outstanding,
  term, and interest — enough to chart a payoff timeline and total interest,
  and to compare snowball vs avalanche strategies (that €382k mortgage dominates,
  so highlighting principal-vs-interest over time is genuinely useful).
- **Filters, search & pagination on tables.** Expenses run into thousands of rows;
  add date-range, category and text filters (the API already returns full lists,
  so this is front-end only to start).
- **Cash-flow forecast.** Project the next 3–6 months from recurring income,
  fixed costs, and average variable spend.
- **Export to Excel** (not just JSON) for a familiar round-trip.
- **Microsoft Entra ID sign-in** before any public Azure deployment, so the app
  isn't wide open.

## Data model improvements

- **Link transactions to accounts.** Today `Source`/`Fonte` is free text
  ("Millenium", "Crédito Prestige", "Wise Gabriel"…). Making it a reference to the
  Bank Accounts table unlocks per-account balances and reconciliation.
- **Add an `owner` dimension (titular A / titular B).** Your holdings already split by
  person (Fidelity A/B, GNB A/B). A per-person tag enables
  household-vs-individual reporting.
- **Add a `currency` column.** You use several platforms (Wise, Trade Republic,
  Revolut) that can hold non-EUR balances; storing currency avoids silent mixing.
- **Consolidate categories.** There's some overlap/noise ("Comida" vs
  "Restaurante" vs "Mercado"; a stray "Ne" category). A controlled category list
  (enforced by a dropdown on import/entry) makes the charts cleaner and trends
  more reliable.
- **Flag recurring vs one-off** on transactions to separate predictable spend from
  discretionary spend in reports.

## Security / operations

- Move DB credentials to **App Service settings or Key Vault** (never commit
  connection strings).
- Switch from `EnsureCreated()` to **EF Core migrations** once the schema
  stabilises, so future changes deploy cleanly.
- Add a nightly **automated JSON backup** to blob storage.
