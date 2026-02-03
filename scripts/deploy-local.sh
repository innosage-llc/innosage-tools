#!/bin/bash
set -e

# InnoSage Tools Local Deployment Script
# This script simulates the CI environment for local validation.

# 1. Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "✅ Loaded .env variables"
else
  echo "❌ Error: .env file not found. Copy .env.example to .env and fill in your secrets."
  exit 1
fi

# 2. Check for required variables
if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo "❌ Error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set in .env"
  exit 1
fi

# 3. Build the project
echo "🔨 Building project..."
npm run build

# 4. Deploy to Cloudflare Pages
echo "🚀 Deploying to Cloudflare Pages (Production)..."
npx wrangler pages deploy out --project-name ${CLOUDFLARE_PAGES_PROJECT:-innosage-tools}

echo "✅ Local deployment successful!"
