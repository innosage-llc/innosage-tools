#!/bin/bash

# innosage-tools Gatekeeper Script
# -------------------------------
# This script enforces the non-negotiable "Gate" for the innosage-tools repo.
# It must pass before any code is merged into the primary branch.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

usage() {
  echo "Usage: $0"
  echo
  echo "Runs the mandatory validation suite for the repository."
  exit 1
}

# Allow --help but otherwise take no arguments
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
fi

echo "🛡️  Gatekeeper: Starting Validation Phase..."

echo "🧪 Checking the offline BYOS harness..."
npm ci --prefix spikes/byos-sync --ignore-scripts --no-audit --no-fund
npm run test:byos-sync
npm run test:byos-ux
npm run test:byos-real-drive:offline
echo "🧪 Checking the native RxDB journal and offline fault fixtures..."
npm run test:byos-native-overlay
echo "🧪 Checking the offline BYOS remediation contract..."
npm ci --prefix spikes/byos-remediation --ignore-scripts --no-audit --no-fund
npm run test:byos-remediation
echo "🧪 Checking the deployment and release contract..."
npm run test:deploy
npm run test:recorder
npm run test:visual-remix
npm run test:visual-remix-bridge
npm run test:visual-remix-motion
npm run test:visual-remix-html
npm run test:meeting-fixer
npm run test:video-scissors
npm run test:video-scissors-remote
npm run test:video-scissors-mcp-e2e:offline
# Isolated Worker dependency graph; preserve the root native gate as authority.
npm ci --prefix workers/video-scissors-mcp --ignore-scripts --no-audit --no-fund
npm --prefix workers/video-scissors-mcp run check
npm run test:visual-remix-scene-store
npm run test:visual-remix-scene-auth
npm run test:visual-remix-reference
npm run test:visual-remix-transport
npm run test:visual-remix-scene-browser
npm run test:video-scissors-mcp

# 1. Syntax & Correctness Check (Oxlint + ESLint)
echo "🔍 Checking for linting errors (oxlint && eslint)..."
npm run lint

# 2. Type Check (TypeScript)
echo "🟦 Checking for TypeScript type errors..."
npx tsc --noEmit

# 3. Production Build
echo "🏗️  Starting production build (next build)..."
npm run build

# 4. SEO Contract
echo "🔎 Verifying the exported /tools SEO contract..."
npm run test:seo
npm --prefix workers/video-scissors-mcp run test:assets

echo "✅ Gatekeeper: All checks passed. The 'Gate' is open."
