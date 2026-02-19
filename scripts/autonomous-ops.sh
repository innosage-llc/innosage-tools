#!/bin/bash

# innosage-tools Autonomous Operations Script
# -------------------------------------------
# Enforces the Master Sync Rule and automates the PR workflow.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEKEEPER="$REPO_ROOT/scripts/gatekeeper.sh"
PRIMARY_BRANCH="master"

cd "$REPO_ROOT"

usage() {
  echo "Usage: $0 {start <branch-name>|submit <title> <body>}"
  echo
  echo "Commands:"
  echo "  start <branch-name>    Implements Master Sync Rule: pulls master and creates a new branch"
  echo "  submit <title> <body>  Runs Gatekeeper and creates a PR using gh CLI"
  exit 1
}

if [ "$#" -lt 1 ]; then
  usage
fi

COMMAND="$1"

case "$COMMAND" in
  "start")
    if [ -z "${2:-}" ]; then usage; fi
    BRANCH_NAME="$2"
    
    echo "🔄 Master Sync Rule: Pulling latest $PRIMARY_BRANCH..."
    git checkout "$PRIMARY_BRANCH"
    git pull origin "$PRIMARY_BRANCH"
    
    echo "🌿 Creating feature branch: $BRANCH_NAME..."
    git checkout -b "$BRANCH_NAME"
    ;;

  "submit")
    if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then usage; fi
    TITLE="$2"
    BODY="$3"
    
    echo "🛡️  Running Gatekeeper before submission..."
    "$GATEKEEPER"
    
    echo "🚀 Pushing branch and creating PR..."
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git push origin "$CURRENT_BRANCH"
    
    gh pr create --title "$TITLE" --body "$BODY"
    
    echo "✅ PR Created: Once CI is green, observe the 10-minute wait before merging."
    ;;

  *)
    usage
    ;;
esac
