# 📊 Finance Manager

A personal budgeting web app built around a spreadsheet-style structure. Add and
delete records, explore interactive reports and charts, and deploy it to Azure.

- **Frontend:** React 18 + TypeScript + Vite + Recharts
- **Backend:** ASP.NET Core 8 Web API + Entity Framework Core
- **Database:** SQLite locally (zero setup) → Azure SQL in the cloud (one config flip)

---

## What it does

| Area | Feature |
|------|---------|
| **Dashboard** | KPIs (income, expenses, net, savings rate, fixed/month, net worth, total debt), monthly income-vs-expenses chart, expenses by category (donut) and by source, net-worth trend, debt trend, year filter |
| **Data pages** | Full add/delete for Expenses, Income, Fixed Costs, Debts, Net Worth, Investments, Bank Accounts — each with running totals |
| **Import / Export** | Import a bank/card statement with automatic classification, back up and restore everything as JSON, or reset |

Every table mirrors a sheet from the original workbook:

| App page | Workbook sheet | Fields |
|----------|----------------|--------|
| Expenses | Despesas | Date, Item, Amount, Category, Source |
| Income | Receitas | Date, Item, Amount, Category, Source |
| Fixed Costs | Gastos Fixos | Type, Category, Item, Monthly, Annual |
| Debts | Dívidas | Date, Item, Installment, Outstanding, Term, Interest |
| Net Worth | Patrimônio | Date, Liquidity, Asset Class, Item, Value |
| Investments | Investimentos | Date, Origin, Destination, Amount |
| Bank Accounts | Contas Bancárias | Name, IBAN, SWIFT |

---

## ⚠️ Loading your data

The app **starts empty on purpose**. There are three ways to fill it:

1. **Type it in** — every page has an add form, plus a *repeat last month* button
   for the recurring rows (Net Worth, Investments, Debts).
2. **Import a statement** — open **Import / Export** and upload a `.xls`/`.xlsx`
   statement from your bank or card. Each line is split into income or expense and
   classified from your own history, then shown for review before anything is saved.
3. **Restore a backup** — drop a previously exported `.json` file on the
   **Data backup** card. You see a table-by-table comparison of what changes
   before it is written.

**Download backup** gives you a portable snapshot you can restore later or drop
into `server/finance_seed.json` to auto-load on a fresh database.

---

## Run it locally

**Prerequisites:** [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
and [Node.js 18+](https://nodejs.org/).

Open **two terminals** in the `FinanceManager` folder.

**Terminal 1 — API** (http://localhost:5080):
```bash
cd server
dotnet run
```

**Terminal 2 — Web app** (http://localhost:5173):
```bash
cd client
npm install
npm run dev
```

Open **http://localhost:5173**. The dev server proxies `/api` to the .NET app, so
there's nothing else to configure. A `finance.db` SQLite file is created
automatically next to the API on first run.

---

## Build for production

One command bundles the React app into the API and produces a single deployable
folder (`./publish`):

```powershell
./build.ps1      # Windows
```
```bash
./build.sh       # macOS / Linux
```

Run the result locally with `dotnet ./publish/FinanceManager.Api.dll` and browse
to the printed URL — the API now serves both the app and the data.

---

## Deploy to Azure

### Option A — one-time push with the Azure CLI

```bash
# 1. Create the resources (change names/region as you like)
az group create -n finance-rg -l westeurope
az appservice plan create -g finance-rg -n finance-plan --sku B1
az webapp create -g finance-rg -p finance-plan -n your-finance-app --runtime "DOTNET|8.0"

# 2. Build and deploy
./build.sh          # or ./build.ps1
cd publish && zip -r ../app.zip . && cd ..
az webapp deploy -g finance-rg -n your-finance-app --src-path app.zip --type zip
```

Your app is live at `https://your-finance-app.azurewebsites.net`.

### Option B — automatic deploys with GitHub Actions

A workflow is included at `.github/workflows/azure-webapp.yml`:

1. Set `AZURE_WEBAPP_NAME` in the workflow to your Web App name.
2. In the Azure Portal, open your Web App → **Get publish profile**, and add the
   contents as a GitHub repo secret named `AZURE_WEBAPP_PUBLISH_PROFILE`.
3. Push to `main` — it builds the client, bundles it into the API, and deploys.

### Use Azure SQL instead of SQLite (recommended for the cloud)

SQLite is a local file and resets when the App Service restarts. For durable
cloud storage, point the app at **Azure SQL**:

```bash
# Create a SQL server + database
az sql server create -g finance-rg -n your-sql-srv -l westeurope -u sqladmin -p '<StrongP@ssw0rd!>'
az sql db create -g finance-rg -s your-sql-srv -n financedb --service-objective S0
az sql server firewall-rule create -g finance-rg -s your-sql-srv -n AllowAzure --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

Then in the Web App configuration (**Settings → Configuration**) add:

| Setting | Value |
|---------|-------|
| `DatabaseProvider` | `SqlServer` |
| `ConnectionStrings__DefaultConnection` | `Server=tcp:your-sql-srv.database.windows.net,1433;Database=financedb;User ID=sqladmin;Password=<StrongP@ssw0rd!>;Encrypt=True;` |

The app creates the tables automatically on first start. (For a managed schema
you can switch to EF Core migrations later — `EnsureCreated` is used here for
zero-friction startup.)

---

## Getting this into `C:\Source`

This folder currently lives in your **OneDrive → Documents → Cowork**. To copy it
to `C:\Source` on your PC (PowerShell):

```powershell
# Adjust the OneDrive path if yours differs (e.g. "OneDrive - Microsoft")
Copy-Item -Recurse "$env:USERPROFILE\OneDrive\Documents\Cowork\FinanceManager" "C:\Source\FinanceManager"
```

Then follow **Run it locally** above from `C:\Source\FinanceManager`.

---

## Project structure

```
FinanceManager/
├─ server/                     ASP.NET Core Web API
│  ├─ Program.cs               startup, DB provider switch, SPA hosting
│  ├─ Models/Entities.cs       the 7 data types
│  ├─ Data/                    DbContext + first-run JSON seeding
│  ├─ Controllers/             generic CRUD + Dashboard + Import/Export
│  └─ finance_seed.json        auto-loaded when the DB is empty
├─ client/                     React + Vite + TypeScript SPA
│  └─ src/
│     ├─ pages/Dashboard.tsx   charts & KPIs
│     ├─ pages/ImportExport.tsx
│     ├─ components/ResourcePage.tsx   reusable add/delete table
│     └─ resources.ts          declarative table definitions
├─ build.ps1 / build.sh        one-shot production build
└─ .github/workflows/          Azure deploy pipeline
```

---

## API reference (quick)

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST/PUT/DELETE | `/api/expenses` (and `income`, `fixedcosts`, `debts`, `networth`, `investments`, `accounts`) | CRUD per table |
| GET | `/api/dashboard/summary?year=2025` | All KPIs, series and breakdowns |
| POST | `/api/statement/preview` · `/api/statement/commit` | Classify a statement, then save the reviewed lines |
| GET | `/api/backup/summary` | Row count per table |
| POST | `/api/import/json` · GET `/api/export/json` | Restore / back up |
| POST | `/api/import/reset` | Clear all data |

In development, Swagger UI is at `http://localhost:5080/swagger`.

---

## Ideas already built in & what's next

**Built in beyond the basics:** savings-rate KPI, fixed-cost monthly load,
net-worth and debt trend lines, category/source breakdowns, year filtering,
statement import with automatic classification, JSON backup and restore with a
before/after comparison, provider-agnostic storage.

**Natural next steps** (see `IDEAS.md`): monthly budget targets with
over-budget alerts, recurring-expense auto-entry from Fixed Costs, debt-payoff
projections, multi-currency support, and Microsoft Entra ID sign-in for a
shared cloud deployment.
