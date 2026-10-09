#!/bin/bash
set -euo pipefail

# InnoSage Tools Local Deployment Script (Infisical Integration)
# This script simulates the CI environment for local validation using Infisical for secrets.

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-staging}" in
  staging) secret_env=staging ;;
  production) secret_env=prod ;;
  *) echo "Usage: bash scripts/deploy-local.sh [staging|production]" >&2; exit 1 ;;
esac
# Inject the selected context BEFORE build and target resolution. Never infer
# production authorization from a local branch name.
exec infisical run --env="$secret_env" -- node scripts/deploy-pages.mjs "${1:-staging}"
