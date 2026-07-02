#!/usr/bin/env bash
# Builds the React SPA, bundles it into the API's wwwroot, and publishes a
# single deployable app. Run from the FinanceManager folder: ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Building React client..."
npm --prefix client install
npm --prefix client run build

echo "==> Bundling SPA into API wwwroot..."
rm -rf server/wwwroot
mkdir -p server/wwwroot
cp -r client/dist/* server/wwwroot/

echo "==> Publishing .NET API..."
dotnet publish server/FinanceManager.Api.csproj -c Release -o publish

echo "Done. Deployable app is in ./publish"
