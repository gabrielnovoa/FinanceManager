# Deploying FinanceManager to Azure

One-time setup for the `Build and deploy to Azure` GitHub Actions workflow.
After this is done, every push to `main` builds the React client, bundles it into
the API and deploys to Azure automatically.

## Chosen configuration

| Parameter | Value |
| --- | --- |
| Azure account | `owner@example.com` |
| Tenant | `<TENANT_ID>` — Gabriel Nóvoa Personal |
| Subscription | `<SUBSCRIPTION_ID>` — **Personal** |
| Region | Spain Central (`spaincentral`) |
| Resource group | `rg-finance-tn` |
| App Service plan | `asp-finance-tn` — B1 Basic, Linux |
| Web App | `finance-tn` → <https://finance-tn.azurewebsites.net> |
| SQL server | `sql-finance-tn.database.windows.net` |
| SQL database | `financedb` — Basic DTU, 5 DTU, 2 GB |
| Database auth | System-assigned managed identity (no password anywhere) |
| Deploy auth | OIDC federated credentials (no secrets in the repo) |
| App access | Easy Auth — `owner@example.com`, `seconduser@example.com` |

Availability in Spain Central was verified for all three SKUs: B1 Linux App
Service, Basic DTU SQL, and the region itself. `Microsoft.Web` and
`Microsoft.Sql` are already registered on the subscription.

### A note on cost and the spending limit

The Personal subscription is a **Visual Studio subscription** (`MSDN_2014-09-01`)
with the **spending limit turned on**. Two consequences:

- You cannot be charged real money. Azure refuses to bill past the credit.
- If the monthly credit is exhausted, the subscription is **suspended** and the
  app goes offline until the credit resets at the start of the next month.

At list prices this deployment is roughly €17/month (App Service B1 ≈ €12.60,
SQL Basic ≈ €4.60), and Visual Studio subscriptions get discounted dev/test
rates, so the real draw is lower. Against a $50–150 monthly credit that is a
comfortable margin, but set a budget alert anyway — see step 7.

If you would rather the app never go dark, remove the spending limit in the
portal (Subscriptions → Personal → Manage). That requires a payment method and
means overage is billed to you at normal rates.

### Signing in

The tenant enforces MFA, so a plain `az login` fails with `AADSTS50076`. Always
sign in scoped to the tenant:

```bash
az login --tenant <TENANT_ID>
az account set --subscription <SUBSCRIPTION_ID>
```

---

## 1. Create the Azure resources

Run this once, in Bash (Azure Cloud Shell works well):

```bash
SUB=<SUBSCRIPTION_ID>
RG=rg-finance-tn
LOC=spaincentral
PLAN=asp-finance-tn
APP=finance-tn
SQLSRV=sql-finance-tn
SQLDB=financedb

az login --tenant <TENANT_ID>
az account set --subscription $SUB

# Resource group
az group create -n $RG -l $LOC

# App Service plan + web app
az appservice plan create -g $RG -n $PLAN -l $LOC --is-linux --sku B1
az webapp create -g $RG -p $PLAN -n $APP --runtime "DOTNETCORE:8.0"
az webapp config set -g $RG -n $APP --always-on true

# The identity that SQL will trust. Note the printed principalId.
az webapp identity assign -g $RG -n $APP

# Azure SQL with Entra-only auth - you become the server admin
ADMIN_UPN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
ADMIN_SID=$(az ad signed-in-user show --query id -o tsv)

az sql server create -g $RG -n $SQLSRV -l $LOC \
  --enable-ad-only-auth \
  --external-admin-principal-type User \
  --external-admin-name "$ADMIN_UPN" \
  --external-admin-sid "$ADMIN_SID"

# Let Azure services (the web app) reach the server
az sql server firewall-rule create -g $RG -s $SQLSRV \
  -n AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

az sql db create -g $RG -s $SQLSRV -n $SQLDB --service-objective Basic

# Point the app at SQL Server using managed identity
az webapp config appsettings set -g $RG -n $APP --settings \
  DatabaseProvider=SqlServer \
  "ConnectionStrings__DefaultConnection=Server=tcp:$SQLSRV.database.windows.net,1433;Initial Catalog=$SQLDB;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;Authentication=Active Directory Managed Identity;"
```

There is deliberately no SQL administrator password — the server is created with
`--enable-ad-only-auth`, so SQL logins are disabled entirely.

`sql-finance-tn` must be globally unique across Azure. If creation fails with a
name conflict, pick another and update the connection string to match.

## 2. Grant the web app access to the database

The managed identity exists but has no rights in `financedb` yet. In the Azure
portal go to **SQL databases → financedb → Query editor**, sign in with your
Entra account (you are the server admin), and run:

```sql
CREATE USER [finance-tn] FROM EXTERNAL PROVIDER;
ALTER ROLE db_owner ADD MEMBER [finance-tn];
```

`finance-tn` is the web app name, which is also the managed identity name.
`db_owner` is required because the app calls `EnsureCreated()` on startup and
therefore needs permission to create the schema on first run.

Run this against `financedb`, not `master`.

## 3. Set up OIDC so GitHub can deploy

```bash
REPO=gabrielnovoa/FinanceManager
RG=rg-finance-tn
SUB=<SUBSCRIPTION_ID>

APP_ID=$(az ad app create --display-name "github-finance-tn-deploy" --query appId -o tsv)
az ad sp create --id $APP_ID
SP_OID=$(az ad sp show --id $APP_ID --query id -o tsv)

# Let it deploy to the resource group, and nothing else
az role assignment create \
  --assignee-object-id $SP_OID \
  --assignee-principal-type ServicePrincipal \
  --role "Website Contributor" \
  --scope "/subscriptions/$SUB/resourceGroups/$RG"
```

Now trust GitHub's token. The workflow declares `environment: production`, so the
subject claim is the `environment:` form, **not** `ref:refs/heads/main`:

> **Run these two commands in Bash, not PowerShell.** The inline `'{ ... }'` JSON
> is Bash quoting; PowerShell mangles it before `az` sees it and the command
> fails. If you are on Windows, use the PowerShell version further below instead.

```bash
az ad app federated-credential create --id $APP_ID --parameters '{
  "name": "github-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:gabrielnovoa/FinanceManager:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

GitHub is migrating to *immutable* subject claims that embed numeric IDs. This
repository was created on 2 July 2026, before the 15 July cutover, so the
credential above is the one in use today. Add the immutable form as well so
nothing breaks when the migration reaches your account:

```bash
az ad app federated-credential create --id $APP_ID --parameters '{
  "name": "github-production-immutable",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:gabrielnovoa@17750196/FinanceManager@1287392859:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

### PowerShell equivalent

On Windows, write the JSON to a file and pass it with `@`, which avoids the
quoting problem entirely:

```powershell
$APPID = "<the appId from az ad app create>"
$tmp = Join-Path $env:TEMP "fedcred"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

@{
  name      = "github-production"
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "repo:gabrielnovoa/FinanceManager:environment:production"
  audiences = @("api://AzureADTokenExchange")
} | ConvertTo-Json | Set-Content -Encoding utf8 "$tmp\fc1.json"

@{
  name      = "github-production-immutable"
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "repo:gabrielnovoa@17750196/FinanceManager@1287392859:environment:production"
  audiences = @("api://AzureADTokenExchange")
} | ConvertTo-Json | Set-Content -Encoding utf8 "$tmp\fc2.json"

az ad app federated-credential create --id $APPID --parameters "@$tmp\fc1.json"
az ad app federated-credential create --id $APPID --parameters "@$tmp\fc2.json"
```

### Verify step 3

All three of these must succeed before the workflow can deploy:

```powershell
$APPID = "<appId>"
$SUB   = "<SUBSCRIPTION_ID>"

# a. the service principal exists - note its objectId
az ad sp show --id $APPID --query "{objectId:id,type:servicePrincipalType}" -o json

# b. Website Contributor is assigned to that objectId on the resource group
az role assignment list --scope "/subscriptions/$SUB/resourceGroups/rg-finance-tn" `
  --query "[].{role:roleDefinitionName,principalId:principalId,type:principalType}" -o table

# c. two federated credentials exist
az ad app federated-credential list --id $APPID --query "[].{name:name,subject:subject}" -o table
```

Expected: a `Website Contributor` row whose `principalId` equals the objectId
from (a), and two credentials in (c). An empty `[]` from (c) is the usual
symptom of the Bash-quoting failure described above — the role assignment can be
perfectly fine while the credentials silently never got created.

## 4. Add the repository variables

These three identifiers are not credentials, so they go in **Variables**, not
Secrets — Settings → Secrets and variables → Actions → **Variables** tab:

```bash
gh variable set AZURE_CLIENT_ID       --repo gabrielnovoa/FinanceManager --body "$APP_ID"
gh variable set AZURE_TENANT_ID       --repo gabrielnovoa/FinanceManager --body "<TENANT_ID>"
gh variable set AZURE_SUBSCRIPTION_ID --repo gabrielnovoa/FinanceManager --body "<SUBSCRIPTION_ID>"
```

If you put them under Secrets instead, the workflow fails at the Azure login step
with an empty client id.

You also need a GitHub environment named `production` (Settings → Environments →
New environment). The workflow references it, and the OIDC subject depends on it.

## 5. Lock the app down

Without this step every API route is publicly readable and writable.

You are already in the tenant, so only the second user needs inviting as a guest:

```bash
az rest --method POST --uri https://graph.microsoft.com/v1.0/invitations \
  --headers "Content-Type=application/json" \
  --body '{
    "invitedUserEmailAddress": "seconduser@example.com",
    "inviteRedirectUrl": "https://finance-tn.azurewebsites.net",
    "sendInvitationMessage": true
  }'
```

### From the portal instead

**Microsoft Entra ID → Users → All users → New user → Invite external user.**
Fill in the email, set the redirect URL to <https://finance-tn.azurewebsites.net>,
and invite.

To resend to an existing guest: **Entra ID → Users → All users**, filter
**User type = Guest**, click the user, then **Resend invitation** on the Overview
blade.

### If the invitation email never arrives

This is common with `@outlook.com` — the message tends to land in Junk, or gets
dropped silently. It does not matter much, because **the email is not required**.

Check whether the account was actually created:

```powershell
az rest --method GET --uri "https://graph.microsoft.com/v1.0/users?`$filter=userType eq 'Guest'&`$select=displayName,mail,externalUserState" -o json
```

If the user is listed with `externalUserState: PendingAcceptance`, the invitation
worked and the account exists. `PendingAcceptance` only means she has not
redeemed yet — and redemption happens automatically the first time she signs in
to the app. So once she is assigned to `finance-tn-auth` (below), she can simply
open <https://finance-tn.azurewebsites.net>, sign in with her Microsoft account,
accept the one-time consent prompt, and she is in.

If you would rather send her a link directly, re-issue the invitation and read
`inviteRedeemUrl` from the response — that URL redeems the invite without any
email involved.

**Turn on authentication** — portal → `finance-tn` → Settings → **Authentication**
→ Add identity provider:

- Identity provider: **Microsoft**
- Tenant type: **Workforce**
- App registration: **Create new**, name `finance-tn-auth`
- Supported account types: **Current tenant — single tenant**
- Restrict access: **Require authentication**
- Unauthenticated requests: **HTTP 302 Found redirect**

Single tenant is the right choice even though both of you use `@outlook.com`
addresses: guest accounts live in your directory, so this permits exactly the
people you invite and no other Microsoft account.

**Restrict to just the two of you:**

```bash
AUTH_SP=$(az ad sp list --display-name "finance-tn-auth" --query "[0].id" -o tsv)
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$AUTH_SP" \
  --headers "Content-Type=application/json" \
  --body '{"appRoleAssignmentRequired": true}'
```

Then portal → Entra ID → Enterprise applications → `finance-tn-auth` →
**Users and groups** → add both accounts below. Both get identical full access;
the app has no roles.

### Which accounts to assign

The tenant contains three principals, and two of them look like "Gabriel".
Assign the first and the third — **not** the GABN Corp guest:

| Assign? | Display name | Sign-in (UPN) | Mail | Object ID |
| --- | --- | --- | --- | --- |
| ✅ yes | Gabriel Nóvoa | `owner@contoso.onmicrosoft.com` | `owner@example.com` | `<OWNER_OBJECT_ID>` |
| ❌ no | Gabriel Nóvoa (GABN Corp) | `owner_work-tenant.onmicrosoft.com#EXT#@…` | `owner@work-tenant.onmicrosoft.com` | `<WORK_GUEST_OBJECT_ID>` |
| ✅ yes | seconduser | `seconduser_example.com#EXT#@…` | `seconduser@example.com` | `<SECOND_USER_OBJECT_ID>` |

Note that Gabriel's **UPN is not his email address**. Searching the portal picker
for `owner@example.com` will probably return nothing, because the picker
matches on UPN and display name. Search for `Gabriel Nóvoa` and choose the
**Member** entry, or paste the object ID.

The same distinction matters at sign-in: if `owner@example.com` is not
accepted at the app's login prompt, use
`owner@contoso.onmicrosoft.com` instead.

### Assigning from the command line

Once the identity provider exists, this assigns both users without the portal
picker (PowerShell, quote-safe):

```powershell
$AUTH_SP = az ad sp list --display-name "finance-tn-auth" --query "[0].id" -o tsv
$tmp = Join-Path $env:TEMP "assign"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# appRoleId all-zeros means "default access" - the app defines no roles
$users = @(
  @{ name = "owner"; oid = "<OWNER_OBJECT_ID>" },
  @{ name = "seconduser";   oid = "<SECOND_USER_OBJECT_ID>" }
)

foreach ($u in $users) {
  @{
    principalId = $u.oid
    resourceId  = $AUTH_SP
    appRoleId   = "00000000-0000-0000-0000-000000000000"
  } | ConvertTo-Json | Set-Content -Encoding utf8 "$tmp\$($u.name).json"

  az rest --method POST `
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$AUTH_SP/appRoleAssignedTo" `
    --headers "Content-Type=application/json" `
    --body "@$tmp\$($u.name).json"
}

Remove-Item $tmp -Recurse -Force
```

Verify afterwards:

```powershell
az rest --method GET `
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$AUTH_SP/appRoleAssignedTo" `
  --query "value[].principalDisplayName" -o table
```

Exactly two names should be listed.

Anyone not on that list is refused at the platform edge and never reaches the app.

## 6. Move your data across

The production database starts empty — `finance_seed.json` ships with empty
arrays, so nothing is seeded. Use the app's own backup round-trip:

1. Locally, open **Import / Export** and click **Export JSON**.
2. Push to `main` and let the deploy finish.
3. Open <https://finance-tn.azurewebsites.net>, sign in, go to
   **Import / Export** and import that file.

## 7. Add a budget alert

Because the spending limit will silently suspend the subscription, get warned
first:

```bash
az consumption budget create \
  --budget-name finance-tn-monthly \
  --amount 30 \
  --category Cost \
  --time-grain Monthly \
  --start-date "$(date -u +%Y-%m-01)" \
  --end-date "$(date -u -d '+2 years' +%Y-%m-01)" \
  --resource-group rg-finance-tn
```

Or portal → Subscriptions → Personal → **Budgets**, with alerts at 50% and 90%.

## How deploys work

Push to `main`, or run the workflow manually from the Actions tab. The job:
builds the client with `npm ci`, copies `client/dist` into `server/wwwroot`,
runs `dotnet publish`, signs in to Azure over OIDC, and deploys the folder.
Concurrent runs on the same branch cancel each other, so a rapid second push
never races the first.

`EnsureCreated()` builds the schema on the first request after deployment.
The app has no EF migrations, so changing a model means dropping and recreating
`financedb` — export your data first.

## Verify the whole setup

Every command here is read-only. Run them when something misbehaves, or after
any change, to confirm the pieces are still wired together. Several of these
steps can fail *silently* — step 3 in particular looks successful even when the
federated credentials were never created.

```powershell
# Resources exist and the app is running
az webapp show -g rg-finance-tn -n finance-tn --query "{state:state,os:kind}" -o json
az sql db show -g rg-finance-tn -s sql-finance-tn -n financedb --query "{status:status,tier:sku.tier}" -o json

# App settings point at Azure SQL over managed identity
az webapp config appsettings list -g rg-finance-tn -n finance-tn --query "[?name=='DatabaseProvider']" -o json

# The web app has a system-assigned identity
az webapp identity show -g rg-finance-tn -n finance-tn --query principalId -o tsv

# Easy Auth is on and closed to everyone but assigned users
az rest --method GET --url "https://management.azure.com/subscriptions/$sub/resourceGroups/rg-finance-tn/providers/Microsoft.Web/sites/finance-tn/config/authsettingsV2?api-version=2022-03-01" --query "properties.globalValidation" -o json
az ad sp show --id finance-tn-auth --query appRoleAssignmentRequired -o tsv   # must be true

# Exactly the intended people are assigned
az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/<AUTH_SP_OBJECT_ID>/appRoleAssignedTo" --query "value[].principalDisplayName" -o tsv
```

### Confirming the database grant

The `db_owner` grant from step 2 lives *inside* `financedb`, so no ARM command
can see it. To check it you have to connect. The server firewall only allows
Azure services, so open a temporary hole for your own address and close it
again afterwards:

```powershell
$ip = (Invoke-RestMethod 'https://api.ipify.org?format=json').ip
az sql server firewall-rule create -g rg-finance-tn -s sql-finance-tn -n TempLocalAudit --start-ip-address $ip --end-ip-address $ip -o none

$tok = az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv
Invoke-Sqlcmd -ServerInstance "sql-finance-tn.database.windows.net" -Database financedb -AccessToken $tok -Query @"
SELECT p.name, p.type_desc, r.name AS role_name
FROM sys.database_principals p
JOIN sys.database_role_members rm ON rm.member_principal_id = p.principal_id
JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
WHERE p.type = 'E';
"@

az sql server firewall-rule delete -g rg-finance-tn -s sql-finance-tn -n TempLocalAudit -o none
```

Expect one row: `finance-tn` / `EXTERNAL_USER` / `db_owner`. An access token is
used rather than `-G` because the tenant requires MFA, which `sqlcmd` cannot
complete non-interactively.

Before the first deploy `sys.tables` is empty — `EnsureCreated()` has not run
yet. That is normal, not a broken grant.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `AADSTS50076` on `az login` | Tenant requires MFA. Use `az login --tenant <TENANT_ID>`. |
| `AADSTS70021: No matching federated identity record found` | Subject mismatch. It must be the `environment:production` form, not `ref:refs/heads/main`. |
| Login step fails with an empty client id | The three identifiers were added as Secrets instead of Variables. |
| `Login failed for user '<token-identified principal>'` | Step 2 was skipped, or the user was created in `master` rather than `financedb`. |
| `403 Forbidden` from webapps-deploy | The service principal lacks **Website Contributor** on the resource group. |
| App returns 500 on first load | Check `DatabaseProvider=SqlServer` is set, and that the SQL firewall allows Azure services. |
| Everyone can reach the app | `appRoleAssignmentRequired` was not set, or Authentication is set to allow unauthenticated access. |
| Site suddenly returns 403 / resources stopped | Monthly Visual Studio credit exhausted and the spending limit kicked in. Resets next month. |
