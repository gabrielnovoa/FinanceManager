# Builds the React SPA, bundles it into the API's wwwroot, and publishes the
# whole thing as a single deployable app. Run from the FinanceManager folder:
#   ./build.ps1
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    Write-Host '==> Building React client...' -ForegroundColor Cyan
    npm --prefix client install
    npm --prefix client run build

    Write-Host '==> Bundling SPA into API wwwroot...' -ForegroundColor Cyan
    if (Test-Path server/wwwroot) { Remove-Item -Recurse -Force server/wwwroot }
    New-Item -ItemType Directory -Force server/wwwroot | Out-Null
    Copy-Item -Recurse -Force client/dist/* server/wwwroot/

    Write-Host '==> Publishing .NET API...' -ForegroundColor Cyan
    dotnet publish server/FinanceManager.Api.csproj -c Release -o publish

    Write-Host 'Done. Deployable app is in ./publish' -ForegroundColor Green
}
finally {
    Pop-Location
}
