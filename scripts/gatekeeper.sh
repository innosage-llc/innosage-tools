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

# 1. Syntax & Correctness Check (Oxlint + ESLint)
echo "🔍 Checking for linting errors (oxlint && eslint)..."
pnpm run lint

# 2. Type Check (TypeScript)
echo "🟦 Checking for TypeScript type errors..."
pnpm exec tsc --noEmit

# 3. Production Build
echo "🏗️  Starting production build (next build)..."
pnpm run build

echo "✅ Gatekeeper: All checks passed. The 'Gate' is open."
