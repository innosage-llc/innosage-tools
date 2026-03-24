#!/bin/bash
set -e

# InnoSage Tools Local Deployment Script (Infisical Integration)
# This script simulates the CI environment for local validation using Infisical for secrets.

# 1. Check if Infisical is logged in/available
if ! infisical user get token >/dev/null 2>&1; then
  echo "❌ Error: Infisical not found or not logged in. Run 'infisical login'."
  exit 1
fi

# 2. Build the project
echo "🔨 Building project..."
npm run build

# 3. Deploy to Cloudflare Pages via Infisical injection
BRANCH=$(git branch --show-current)
INFISICAL_ENV="staging"
if [ "$BRANCH" == "master" ] || [ "$BRANCH" == "main" ]; then
  INFISICAL_ENV="prod"
  echo "🚀 Deploying to Cloudflare Pages (Production) using Infisical ($INFISICAL_ENV)..."
else
  echo "🚀 Deploying to Cloudflare Pages (Preview - branch: $BRANCH) using Infisical ($INFISICAL_ENV)..."
fi
infisical run --env=$INFISICAL_ENV -- npx wrangler pages deploy out --project-name ${CLOUDFLARE_PAGES_PROJECT:-innosage-tools}

echo "✅ Local deployment successful!"
