#!/bin/bash
set -e

# autonomous-ops.sh - Enforce agentic engineering flow for innosage-tools

REPO_DIR=$(cd $(dirname "$0")/.. && pwd)
cd "$REPO_DIR"

command=$1
shift

case "$command" in
  "start-task")
    TASK_NAME=$1
    if [ -z "$TASK_NAME" ]; then
      echo "Usage: $0 start-task <task-name>"
      exit 1
    fi

    echo "🔄 Master Sync Rule: Pulling latest master..."
    git checkout master
    git pull origin master

    # Sanitize task name for branch creation
    SAFE_TASK_NAME=$(echo "$TASK_NAME" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]')
    BRANCH_NAME="agent/$(date +%Y%m%d)-$SAFE_TASK_NAME"
    echo "🌿 Creating feature branch: $BRANCH_NAME"
    git checkout -b "$BRANCH_NAME"
    ;;

  "submit-pr")
    COMMIT_MSG="$@"
    if [ -z "$COMMIT_MSG" ]; then
      echo "Usage: $0 submit-pr \"<commit-message>\""
      exit 1
    fi

    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT_BRANCH" = "master" ]; then
      echo "❌ Error: Cannot submit from 'master' branch."
      exit 1
    fi

    echo "🛡️ Running local Gatekeeper checks..."
    ./scripts/gatekeeper.sh

    echo "💾 Committing changes..."
    git add -A
    git commit -m "$COMMIT_MSG"

    echo "🚀 Pushing to remote..."
    git push origin "$CURRENT_BRANCH"

    echo "📝 Creating PR via GitHub CLI..."
    gh pr create --title "$COMMIT_MSG" --body "Automated PR from agentic workflow."
    ;;

  *)
    echo "Usage: $0 {start-task|submit-pr}"
    exit 1
    ;;
esac
