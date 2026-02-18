#!/bin/bash
set -e

# Gatekeeper: The immune system of the repository.
# This script ensures that no agentic entropy enters the main codebase.

echo "🛡️ Starting Gatekeeper checks..."

# 1. Linting
echo "🔍 Running Lint..."
npm run lint

# 2. Building (Type checking and compilation)
echo "🏗️ Running Build..."
npm run build

echo "✅ Gate Passed! The changes are safe to commit."
